---
layout: post
title: "PostgreSQL Query Optimization: Applying EXPLAIN ANALYZE Knowledge"
author: prateek
categories: [ PostgreSQL, Database, Performance ]
tags: [ postgresql, query optimization, performance tuning, explain analyze, database optimization ]
excerpt: "Master PostgreSQL performance optimization patterns through practical techniques for identifying bottlenecks, fixing slow queries, and implementing database-level optimizations."
description: "Comprehensive guide to PostgreSQL performance optimization patterns. Learn to identify bottlenecks, optimize slow queries, tune configurations, and implement effective indexing strategies."
keywords: "postgresql performance optimization, database optimization patterns, query tuning, performance bottlenecks, slow query optimization, postgresql tuning, indexing strategies, database performance patterns"
---

PostgreSQL performance optimization involves recognizing patterns that indicate bottlenecks and applying targeted solutions. This guide covers practical optimization patterns from query-level improvements to database-wide configurations.

## Performance Red Flags

Understanding query plans is only half the battle. The real value comes from recognizing patterns that indicate performance problems. These red flags appear repeatedly in slow queries.

### 1. High Filter Ratios

When PostgreSQL reads many rows only to discard most of them, you have a filter ratio problem:

```sql
 Seq Scan on orders  (cost=0.00..26432.00 rows=539294 width=116)
                     (actual time=0.006..56.066 rows=538622 loops=1)
   Filter: ((created_at >= '2024-01-01 00:00:00') AND ((status)::text = 'completed'::text))
   Rows Removed by Filter: 461378
```

#### Understanding the Problem

This query:
- Read 1,000,000 rows (538,622 + 461,378)
- Kept only 538,622 rows (54%)
- Discarded 461,378 rows (46%)

That's like reading an entire phone book to find people whose last names start with A-M!

#### Solutions

1. **Add a compound index**:
   ```sql
   CREATE INDEX idx_orders_status_created ON orders(status, created_at);
   ```

2. **Or separate indexes** (if you query by each column independently):
   ```sql
   CREATE INDEX idx_orders_status ON orders(status);
   CREATE INDEX idx_orders_created_at ON orders(created_at);
   ```

3. **Consider partial indexes** for common filters:
   ```sql
   CREATE INDEX idx_completed_orders_2024 ON orders(created_at)
   WHERE status = 'completed' AND created_at >= '2024-01-01';
   ```

### 2. Lossy Bitmap Scans

When bitmap scans run out of memory, they degrade to "lossy" mode:

```sql
-- With artificially low work_mem:
SET work_mem = '64kB';

 Bitmap Heap Scan on orders
   Recheck Cond: (user_id = ANY ('{1,2,3,...,1000}'::integer[]))
   Rows Removed by Index Recheck: 15234
   Heap Blocks: exact=1205 lossy=8932
```

#### What "Lossy" Means

- **exact=1205**: PostgreSQL knows exactly which rows to check on these pages
- **lossy=8932**: PostgreSQL only knows these pages contain matches, must check every row
- **Rows Removed by Index Recheck**: Extra work from lossy blocks

When lossy, PostgreSQL must recheck conditions on entire pages, not just specific rows.

#### Solution

Increase work_mem to keep bitmaps in memory:
```sql
-- For the session:
SET work_mem = '256MB';

-- Or optimize the query to process fewer rows
```

### 3. Multiple Batch Hash Joins

The most common performance killer in hash joins:

```sql
 Hash  (cost=2819.00..2819.00 rows=100000 width=14)
       (actual time=20.349..20.349 rows=100001 loops=1)
   Buckets: 2048  Batches: 128  Memory Usage: 55kB
```

#### The Batch Problem Explained

With `Batches: 128`, PostgreSQL:
1. Splits the 100,000-row table into 128 temporary files
2. Processes each batch separately
3. Performs 128 write + 128 read operations

That's 256 disk I/O operations instead of zero!

#### Calculating Required Memory

Rough formula: `rows × average_width × 1.5 / 1024 / 1024 = MB needed`

For our example: `100000 × 14 × 1.5 / 1024 / 1024 ≈ 2MB`

But with only 64kB work_mem, we got 128 batches!

#### Solution

```sql
-- Increase work_mem to fit the hash table
SET work_mem = '10MB';  -- Should result in Batches: 1
```

### 4. Nested Loops on Large Sets

Nested loops can be catastrophically slow without proper indexes:

```sql
-- BAD: Nested loop without index (hypothetical)
 Nested Loop  (cost=0.00..50000000.00 rows=1000000 width=229)
   ->  Seq Scan on users u  (cost=0.00..2819.00 rows=100000 width=113)
   ->  Seq Scan on orders o  (cost=0.00..26432.00 rows=10 width=116)
         Filter: (user_id = u.id)
```

#### The Quadratic Problem

For each of 100,000 users, scan all 1,000,000 orders = 100 billion row comparisons!

#### Good Nested Loop Example

```sql
 Nested Loop  (cost=4.80..56.04 rows=11 width=229)
              (actual time=0.025..0.028 rows=4 loops=1)
   ->  Index Scan using users_pkey on users u  (rows=1)
   ->  Index Scan using idx_orders_user_id on orders o  (rows=4)
```

With indexes: 1 user lookup + 4 order lookups = 5 total operations

#### When to Worry

- Nested loop with `loops` > 1000 on the inner relation
- Seq Scan or Filter on the inner relation
- Total time dominated by the nested loop node

#### Solutions

1. **Ensure indexes exist** on join columns
2. **Force a different join** if needed:
   ```sql
   SET enable_nestloop = off;  -- Forces hash or merge join
   ```
3. **Rewrite the query** to reduce the outer relation size

## Practical Analysis Workflow

When faced with a slow query, follow this systematic approach to identify and fix performance issues.

### 1. Start with Summary Statistics

Always begin by checking the overall timing:

```sql
Planning Time: 101.157 ms  -- High planning time!
Execution Time: 91.342 ms
```

#### Interpreting Planning Time

- **< 1ms**: Excellent, simple query
- **1-10ms**: Normal for moderate complexity
- **10-50ms**: Complex query or first run after restart
- **> 50ms**: Investigate! Possible causes:
  - Outdated table statistics
  - Many joins or partitions
  - First query after PostgreSQL restart
  - Complex view definitions

In our example, 101ms planning suggests running `ANALYZE` on the tables.

### 2. Find the Slowest Node

Work backwards from total execution time to find bottlenecks:

```sql
->  Sort  (actual time=58.565..59.588 rows=29057 loops=3)  -- Bottleneck!
      Sort Key: (date_trunc('day'::text, created_at))
      Sort Method: external merge  Disk: 4816kB  -- Red flag!
      ->  Parallel Seq Scan on orders  (actual time=0.039..32.511 rows=256251 loops=3)
```

The sort operation takes 58-59ms while its input (seq scan) only takes 32ms. The "external merge" using disk is our culprit.

### 3. Check Row Estimates vs Reality

Poor estimates lead to bad plan choices:

```sql
 Seq Scan on orders  (cost=0.00..23932.00 rows=510476 width=116)  -- Planner estimate
                     (actual time=0.032..82.451 rows=505588 loops=1) -- Reality

-- Good estimate! Only 1% off
```

#### When to Worry About Estimates

- **Within 50%**: Generally OK
- **Off by 2-10x**: May cause suboptimal plans
- **Off by >10x**: Definitely causing problems

Common fixes:
```sql
-- Update table statistics
ANALYZE orders;

-- Increase statistics target for specific columns
ALTER TABLE orders ALTER COLUMN status SET STATISTICS 1000;
ANALYZE orders;
```

### 4. Analyze I/O Patterns

Use BUFFERS option to see cache behavior:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM users WHERE email = 'user1000@example.com';

 Index Scan using idx_users_email on users
   Buffers: shared hit=3 read=1
```

#### Buffer Metrics Decoded

- **shared hit**: Pages found in PostgreSQL's cache (fast)
- **shared read**: Pages read from disk (slow)
- **shared dirtied**: Pages modified in cache
- **shared written**: Pages written to disk

Ideal pattern: High hit ratio (hits / (hits + reads))

### 5. Look for Memory Pressure

Memory-constrained operations are common bottlenecks:

```sql
-- Red flags to watch for:
Sort Method: external merge  Disk: 4816kB    -- Sorting on disk
Hash Batches: 128                             -- Hash join spilling to disk
Heap Blocks: lossy=8932                       -- Bitmap degraded to lossy

-- Good signs:
Sort Method: quicksort  Memory: 25kB          -- In-memory sort
Hash Batches: 1                               -- Hash table fits in memory
Heap Blocks: exact=1205                       -- Precise bitmap
```

## Optimization Checklist

When analyzing slow queries, work through this checklist systematically:

### 1. Missing Indexes
**Symptom**: High "Rows Removed by Filter" in Sequential Scans
```sql
Rows Removed by Filter: 461378  -- Major red flag!
```
**Fix**: Add indexes on filter columns, especially for selective queries

### 2. Outdated Statistics
**Symptom**: Row estimates off by >10x
```sql
rows=1000 (actual rows=50000)  -- 50x underestimate!
```
**Fix**: Run ANALYZE, increase statistics targets, or enable auto-analyze

### 3. Insufficient Memory
**Symptom**: Disk-based operations
- `Sort Method: external merge`
- `Hash Batches: > 1`
- `Heap Blocks: lossy`

**Fix**: Increase work_mem or optimize queries to process less data

### 4. Poor Join Order
**Symptom**: Large intermediate result sets
```sql
-- Bad: Join produces 10M rows, then filters to 100
-- Good: Filter first, then join 100 rows
```
**Fix**: Add selective conditions, rewrite query, or adjust join_collapse_limit

### 5. Missing Parallelism
**Symptom**: Large scans without parallel workers
```sql
Workers Planned: 0  -- On a 10GB table scan
```
**Fix**: Check max_parallel_workers settings and table size thresholds

### 6. Index Correlation Issues
**Symptom**: Index scan slower than expected
```sql
-- Index scan taking longer than seq scan would
```
**Fix**: CLUSTER table on index, or use BRIN indexes for naturally ordered data

## Tools and Settings

### Essential EXPLAIN Options

```sql
-- The full diagnostic toolkit:
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS, WAL) SELECT ...
```

#### Option Reference

- **ANALYZE**: Executes query and shows real timings
- **BUFFERS**: Shows cache hits/misses and I/O statistics
- **VERBOSE**: Displays full output column lists and schema info
- **SETTINGS**: Shows non-default configurations affecting the plan
- **WAL**: Shows Write-Ahead Log generation (for write queries)

#### Progressive Analysis Example

```sql
-- Step 1: Basic plan structure
EXPLAIN SELECT ...

-- Step 2: See actual execution
EXPLAIN ANALYZE SELECT ...

-- Step 3: Add I/O analysis
EXPLAIN (ANALYZE, BUFFERS) SELECT ...

-- Step 4: Full diagnostics for complex issues
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS) SELECT ...
```

### Key Configuration Parameters

#### Memory Settings
```sql
-- Check current values
SHOW work_mem;           -- Default: 4MB
SHOW shared_buffers;     -- Default: 128MB
SHOW effective_cache_size; -- Default: 4GB

-- Session-level adjustments
SET work_mem = '256MB';  -- For sorts, hashes, CTEs
SET temp_buffers = '32MB'; -- For temporary tables
```

#### Cost Parameters
```sql
-- Disk I/O costs (in arbitrary units)
SHOW seq_page_cost;      -- Default: 1.0
SHOW random_page_cost;   -- Default: 4.0 (SSD: consider 1.1)

-- CPU costs
SHOW cpu_tuple_cost;     -- Default: 0.01
SHOW cpu_operator_cost;  -- Default: 0.0025

-- Adjust for SSD storage:
SET random_page_cost = 1.1;
```

#### Parallelism Controls
```sql
-- Parallel query settings
SHOW max_parallel_workers_per_gather;  -- Default: 2
SHOW min_parallel_table_scan_size;     -- Default: 8MB

-- Enable more parallelism
SET max_parallel_workers_per_gather = 4;
```

### Query Hints (Use Sparingly)

```sql
-- Force/prevent specific strategies
SET enable_seqscan = off;      -- Force index usage
SET enable_nestloop = off;     -- Force hash/merge joins
SET enable_hashjoin = off;     -- Force merge/nested joins

-- Remember to reset!
RESET enable_seqscan;
```

## Conclusion

Query optimization is an iterative process. Start by identifying the biggest bottleneck, fix it, then re-analyze. Often, fixing one issue reveals others that were hidden.

The key insights to remember:
- Most performance problems stem from missing indexes or insufficient memory
- The planner makes mistakes when statistics are outdated
- Small configuration changes can yield dramatic improvements
- Always measure before and after optimization

With practice, you'll develop an intuition for common patterns and their solutions. The query planner is sophisticated but not magic—understanding its decisions empowers you to guide it toward optimal plans.

---

**Ready to master PostgreSQL performance?** Subscribe for more deep dives into database optimization, query tuning, and performance best practices.

## References

- [PostgreSQL Documentation: Performance Tips](https://www.postgresql.org/docs/current/performance-tips.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL performance tips documentation (opens in new tab)"}
- [PostgreSQL Documentation: Server Configuration](https://www.postgresql.org/docs/current/runtime-config.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL server configuration documentation (opens in new tab)"}
- [PostgreSQL Documentation: Monitoring Database Activity](https://www.postgresql.org/docs/current/monitoring.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL monitoring documentation (opens in new tab)"}