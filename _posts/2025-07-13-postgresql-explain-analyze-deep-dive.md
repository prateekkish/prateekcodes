---
layout: post
title: "Mastering PostgreSQL EXPLAIN ANALYZE: A Deep Dive into Query Plans"
author: prateek
categories: [ PostgreSQL, Database, Performance ]
tags: [ postgresql, explain analyze, query optimization, database performance, query plans ]
excerpt: "Learn to read and understand PostgreSQL EXPLAIN ANALYZE output like an expert. This comprehensive guide covers all scan strategies, join methods, and optimization techniques."
description: "Master PostgreSQL EXPLAIN ANALYZE output with this deep dive into query plans, scan strategies, and performance optimization. Learn to identify bottlenecks and optimize queries effectively."
keywords: "postgresql explain analyze, query plan analysis, postgres performance tuning, database optimization, scan strategies, index scans, sequential scans, bitmap scans, query execution plans"
---

PostgreSQL's EXPLAIN ANALYZE is a powerful tool for understanding how your database executes queries. However, the output can be overwhelming at first glance - with its mix of cost estimates, actual times, different scan types, and execution nodes.

This post aims to be a comprehensive reference guide for understanding PostgreSQL query execution plans. We'll explore what each component means, when different operations are used, and how to identify common performance issues. Whether you're debugging a slow query or trying to understand why PostgreSQL chose a particular execution strategy, this guide covers the key concepts you'll encounter in real-world query plans.

## Table of Contents

1. [Understanding the Basics](#understanding-the-basics)
   - [Decoding Cost Estimates](#decoding-cost-estimates)
   - [Actual Time vs Cost](#actual-time-vs-cost)
2. [Understanding Different Scan Types](#understanding-different-scan-types)
   - [Sequential Scan (Seq Scan)](#1-sequential-scan-seq-scan)
   - [Index Scan](#2-index-scan)
   - [Index Only Scan](#3-index-only-scan)
   - [Bitmap Scan](#4-bitmap-scan-two-phase-process)
   - [TID Scan](#5-tid-scan)
   - [Function Scan](#6-function-scan)
3. [Join Strategies](#join-strategies)
   - [Nested Loop Join](#nested-loop-join)
   - [Hash Join](#hash-join)
   - [Merge Join](#merge-join)
4. [Aggregation and Grouping](#aggregation-and-grouping)
   - [HashAggregate](#hashaggregate)
   - [GroupAggregate](#groupaggregate)
5. [Sorting Operations](#sorting-operations)
   - [In-Memory Sort](#in-memory-sort)
   - [External Sort (Disk-Based)](#external-sort-disk-based)
6. [Advanced Plan Elements](#advanced-plan-elements)
   - [Parallel Query Execution](#parallel-query-execution)
   - [CTE Scan (Common Table Expressions)](#cte-scan-common-table-expressions)
   - [InitPlan / SubPlan](#initplan--subplan)
7. [Conclusion](#conclusion)
8. [What's Next?](#whats-next)
9. [References](#references)

## Understanding the Basics

Before diving into scan strategies, let's understand what EXPLAIN ANALYZE actually shows us.

```sql
EXPLAIN ANALYZE SELECT * FROM users WHERE email = 'user@example.com';

                                                            QUERY PLAN
----------------------------------------------------------------------------------------------------------------------------------
 Index Scan using idx_users_email on users  (cost=0.42..8.44 rows=1 width=113) (actual time=0.015..0.016 rows=1 loops=1)
   Index Cond: ((email)::text = 'user@example.com'::text)
 Planning Time: 0.077 ms
 Execution Time: 0.023 ms
(4 rows)
```

Let's break down this output line by line:

1. **Operation Type**: `Index Scan using idx_users_email on users`
   - Tells us PostgreSQL is using an index scan
   - Shows which index (`idx_users_email`) and table (`users`)

2. **Cost Estimates**: `(cost=0.42..8.44 rows=1 width=113)`
   - Planner's estimates before execution (in arbitrary cost units, not time!)
   - `0.42` = startup cost (work before first row)
   - `8.44` = total cost (work for all rows)
   - `rows=1` = estimated row count
   - `width=113` = average row size in bytes

3. **Actual Performance**: `(actual time=0.015..0.016 rows=1 loops=1)`
   - Real measurements from executing the query
   - `0.015` = time to first row (in milliseconds)
   - `0.016` = time to get all rows (in milliseconds)
   - `rows=1` = actual rows returned
   - `loops=1` = number of times this operation ran

4. **Index Condition**: `Index Cond: ((email)::text = 'user@example.com'::text)`
   - Shows exactly how the index is being used

5. **Timing Summary**:
   - `Planning Time: 0.077 ms` - Time to create the execution plan (milliseconds)
   - `Execution Time: 0.023 ms` - Time to actually run the query (milliseconds)

### Decoding Cost Estimates

The cost format `(cost=startup..total rows=expected width=bytes)` means:
- **startup cost**: Work before first row can be returned (arbitrary units)
- **total cost**: Total work to return all rows (arbitrary units)
- **rows**: Estimated number of rows
- **width**: Average row size in bytes

**Important**: These costs are in arbitrary units, NOT time! They represent relative computational effort:
- Sequential page read = 1.0 cost unit
- Random page read = 4.0 cost units (adjustable via `random_page_cost`)
- CPU operation = 0.01 cost units (via `cpu_operator_cost`)
- CPU tuple processing = 0.01 cost units (via `cpu_tuple_cost`)

### Actual Time vs Cost

The actual time `(actual time=first..last rows=count loops=iterations)` tells us:
- **first**: Time to return first row (milliseconds)
- **last**: Time to return all rows (milliseconds)
- **rows**: Actual rows returned
- **loops**: Number of times this node executed

**Key difference**:
- Cost = Planner's estimate in arbitrary units
- Actual time = Real execution time in milliseconds

## Understanding Different Scan Types

Now that we understand how to read the basic components of EXPLAIN ANALYZE output, let's explore the different types of operations you'll encounter in query plans. PostgreSQL has six primary scan strategies, each optimized for specific data access patterns. Understanding when and why PostgreSQL chooses each strategy is crucial for query optimization.

### 1. Sequential Scan (Seq Scan)

The simplest strategy: read every page of the table sequentially.

```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE total_amount > 1000;

 Seq Scan on orders  (cost=0.00..23932.00 rows=510476 width=116)
                     (actual time=0.032..82.451 rows=505588 loops=1)
   Filter: (total_amount > '1000'::numeric)
   Rows Removed by Filter: 494412
 Planning Time: 101.157 ms
 Execution Time: 91.342 ms
```

**When PostgreSQL chooses Seq Scan:**
- Returning >5-10% of table rows
- No suitable index exists
- Table is small (<1000 rows)
- Statistics indicate high selectivity

**Key indicators of problems:**
- Large "Rows Removed by Filter" count (494,412 rows filtered to get 505,588!)
- High execution time (91.342 ms) for scanning the entire table

### 2. Index Scan

Traverses B-tree index to find matching rows, then fetches from table.

```sql
EXPLAIN ANALYZE SELECT * FROM users WHERE id = 42;

 Index Scan using users_pkey on users  (cost=0.29..8.31 rows=1 width=113)
                                       (actual time=0.007..0.007 rows=1 loops=1)
   Index Cond: (id = 42)
 Planning Time: 0.444 ms
 Execution Time: 0.015 ms
```

Notice that even though we found the row quickly using the index (id = 42), PostgreSQL still had to:
1. Look up the row location in the index
2. Go to the actual table page to fetch all columns (because we used SELECT *)

This two-step process is necessary because the index only contains the `id` column, not the other columns like `email`, `username`, etc.

**Characteristics:**
- Random I/O pattern (expensive on HDDs)
- Excellent for high selectivity queries (<5% of rows)
- Returns rows in index order
- Very fast for single row lookups (0.015 ms in our example)

**Performance factors:**
- `random_page_cost` setting heavily influences choice (default 4.0)
- Cache hit ratio affects actual performance
- Correlation between index and table order matters

But what if we only needed data that's already in the index? That's where Index Only Scans come in...

### 3. Index Only Scan

Retrieves data entirely from index without touching the table.

```sql
EXPLAIN ANALYZE SELECT email FROM users WHERE email LIKE 'john%';

 Index Only Scan using idx_users_email_covering on users  (cost=0.42..4.44 rows=10 width=21)
                                                          (actual time=0.003..0.003 rows=1 loops=1)
   Index Cond: ((email >= 'john'::text) AND (email < 'joho'::text))
   Filter: ((email)::text ~~ 'john%'::text)
   Heap Fetches: 1
 Planning Time: 0.705 ms
 Execution Time: 0.008 ms
```

**Requirements:**
- All selected columns must be in the index
- Visibility map must be up-to-date (requires VACUUM)
- Works with covering indexes (INCLUDE clause)

**Key metric:**
- `Heap Fetches: 1` means one tuple visibility check required table access
- `Heap Fetches: 0` would indicate a true index-only scan
- Higher numbers mean more table lookups, reducing performance benefit

### 4. Bitmap Scan (Two-Phase Process)

When PostgreSQL needs to retrieve many rows that are scattered across different pages of a table, it faces a dilemma: Index scans require expensive random I/O, while sequential scans read unnecessary data. Bitmap scans offer an elegant middle ground.

#### Understanding the Problem Bitmap Scans Solve

Let's say you're looking for all orders from user_id = 42. These orders might be spread across 50 different pages in your orders table. With a regular index scan, PostgreSQL would:
1. Look up each row location in the index
2. Jump to that page on disk (random I/O)
3. Repeat 50 times

This random jumping is expensive, especially on traditional hard drives. Bitmap scans solve this by first collecting all the page numbers, then reading those pages in order.

#### How Bitmap Scans Work

```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 42;

 Bitmap Heap Scan on orders  (cost=4.51..47.62 rows=11 width=116)
                             (actual time=0.019..0.021 rows=4 loops=1)
   Recheck Cond: (user_id = 42)
   Heap Blocks: exact=4
   ->  Bitmap Index Scan on idx_orders_user_id  (cost=0.00..4.51 rows=11 width=0)
                                                (actual time=0.010..0.010 rows=4 loops=1)
         Index Cond: (user_id = 42)
```

This happens in two distinct phases:

**Phase 1: Bitmap Index Scan** (the inner operation)
- Scans the index to find all matching entries
- Instead of fetching rows immediately, it builds a "bitmap" - essentially a list of which table pages contain matching rows
- In our example: found 4 pages containing user 42's orders

**Phase 2: Bitmap Heap Scan** (the outer operation)
- Takes the bitmap from phase 1
- Reads those 4 pages sequentially (much faster than random access)
- Applies the condition again to find the exact rows on each page (the "Recheck")

#### Key Metrics to Watch

- **Heap Blocks: exact=4** - PostgreSQL read exactly 4 pages. "exact" means the bitmap fit in memory perfectly
- **Recheck Cond** - Shows that PostgreSQL double-checks the condition on each page (necessary because the bitmap only tracks pages, not individual rows)

#### When You'll See Bitmap Scans

PostgreSQL typically chooses bitmap scans when:
- You're retrieving 1-20% of a table (too much for index scan, too little for sequential scan)
- Multiple indexes can be combined (using BitmapAnd/BitmapOr)
- The matching rows are scattered across many pages
- Your `work_mem` setting provides enough memory for the bitmap

#### Advanced: Combining Multiple Conditions

Bitmap scans truly shine when combining multiple conditions:

```sql
EXPLAIN ANALYZE
SELECT * FROM orders
WHERE user_id = 42
   OR (status = 'pending' AND created_at >= '2024-01-01');

 Bitmap Heap Scan on orders
   ->  BitmapOr
         ->  Bitmap Index Scan on idx_orders_user_id
               Index Cond: (user_id = 42)
         ->  BitmapAnd
               ->  Bitmap Index Scan on idx_orders_status
                     Index Cond: (status = 'pending')
               ->  Bitmap Index Scan on idx_orders_created_at
                     Index Cond: (created_at >= '2024-01-01')
```

PostgreSQL creates separate bitmaps for each condition, then combines them using set operations (AND/OR) before reading the table pages.

#### Performance Considerations

**Memory Usage**: Bitmaps are stored in `work_mem`. If the bitmap exceeds available memory, PostgreSQL switches to "lossy" mode:
- Instead of tracking individual rows, it tracks entire pages
- This requires more rechecking but still beats random I/O
- You'll see "Heap Blocks: lossy=N" in the output

### 5. TID Scan

While the previous scan types are common in everyday queries, TID (Tuple IDentifier) scans are specialized operations that directly access rows by their physical location. Understanding them helps complete your knowledge of PostgreSQL's access methods.

#### What is a TID?

Every row in PostgreSQL has a system column called `ctid` that represents its physical location as a pair: (page_number, item_number). For example, `ctid = '(0,1)'` means page 0, item 1.

```sql
EXPLAIN ANALYZE SELECT * FROM users WHERE ctid = '(0,1)';

 Tid Scan on users  (cost=0.00..4.01 rows=1 width=113)
                    (actual time=0.002..0.002 rows=1 loops=1)
   TID Cond: (ctid = '(0,1)'::tid)
 Planning Time: 0.049 ms
 Execution Time: 0.006 ms
```

This is the fastest possible way to retrieve a specific row - it goes directly to the exact page and position.

#### When You'll Encounter TID Scans

TID scans are rare in application code because:
- TIDs can change when rows are updated or during VACUUM
- They're not portable across database backups/restores
- They expose physical storage details

**Legitimate use cases include:**
- **Debugging**: "Show me exactly what's on page 0 of this table"
- **Maintenance scripts**: Processing tables in physical order
- **Recovery operations**: Accessing potentially corrupted data

**Warning**: Avoid using TIDs for pagination or as permanent row identifiers. Use proper primary keys instead.

### 6. Function Scan

The last scan type handles a different data source entirely: functions that return sets of rows. These are common when working with PostgreSQL's built-in functions or custom set-returning functions.

#### Understanding Function Scans

When you query a function that returns multiple rows (a "set-returning function"), PostgreSQL uses a Function Scan:

```sql
EXPLAIN ANALYZE SELECT * FROM generate_series(1,1000) AS n
WHERE n % 10 = 0;

 Function Scan on generate_series n  (cost=0.00..15.00 rows=5 width=4)
                                     (actual time=0.030..0.048 rows=100 loops=1)
   Filter: ((n % 10) = 0)
   Rows Removed by Filter: 900
 Planning Time: 0.008 ms
 Execution Time: 0.055 ms
```

Key points:
- The function generates 1000 rows in memory
- PostgreSQL then applies the filter (n % 10 = 0)
- 900 rows are filtered out, leaving 100

#### Common Function Scan Scenarios

You'll see function scans when using:
- **Built-in functions**: `generate_series()`, `unnest()`, `json_array_elements()`
- **Custom functions**: Any function returning `SETOF` or `TABLE`
- **System functions**: `pg_stat_user_tables()`, `pg_ls_dir()`

Example with JSON data:
```sql
EXPLAIN ANALYZE
SELECT item->>'name' AS product_name
FROM orders,
     json_array_elements(order_items) AS item
WHERE item->>'quantity'::int > 5;
```

This would show a Function Scan on `json_array_elements`, processing each JSON array element as a row.

## Join Strategies

Now that we understand how PostgreSQL accesses data from individual tables, let's explore how it combines data from multiple tables. PostgreSQL has three join algorithms, each optimized for different scenarios. The choice of algorithm can dramatically impact query performance.

### Nested Loop Join

The simplest join algorithm works like nested FOR loops in programming. It's often the fastest option when joining small datasets or when one side of the join returns very few rows.

#### How Nested Loops Work

Think of it as:
```
FOR each row in the outer table:
    FOR each matching row in the inner table:
        Output the combined row
```

Let's see this in action:

```sql
EXPLAIN ANALYZE
SELECT u.*, o.* FROM users u
JOIN orders o ON u.id = o.user_id
WHERE u.id = 42;

 Nested Loop  (cost=4.80..56.04 rows=11 width=229)
              (actual time=0.025..0.028 rows=4 loops=1)
   ->  Index Scan using users_pkey on users u  (cost=0.29..8.31 rows=1 width=113)
                                               (actual time=0.004..0.004 rows=1 loops=1)
         Index Cond: (id = 42)
   ->  Bitmap Heap Scan on orders o  (cost=4.51..47.62 rows=11 width=116)
                                     (actual time=0.019..0.021 rows=4 loops=1)
         Recheck Cond: (user_id = 42)
         Heap Blocks: exact=4
         ->  Bitmap Index Scan on idx_orders_user_id  (cost=0.00..4.51 rows=11 width=0)
                                                      (actual time=0.010..0.010 rows=4 loops=1)
               Index Cond: (user_id = 42)
 Planning Time: 0.151 ms
 Execution Time: 0.035 ms
```

Reading this plan from bottom to top:
1. **Outer loop** (first): Finds user with id = 42 (returns 1 row)
2. **Inner loop** (second): For that 1 user, finds all their orders (returns 4 rows)
3. **Result**: 1 user × 4 orders = 4 combined rows

#### Key Performance Indicators

- **loops=1** on both operations means the inner scan ran only once (because we found only 1 user)
- If we had found 10 users, the inner scan would show **loops=10**
- Total execution time of 0.035ms shows how efficient this is for small result sets

#### When Nested Loops Excel

PostgreSQL chooses nested loops when:
- The outer table returns very few rows (like our single user lookup)
- An index exists on the join column of the inner table
- You're joining a small table to a large one with good selectivity

**Real-world example**: Looking up a customer and their recent orders - you find one customer (outer), then efficiently find their orders using an index (inner).

#### When to Be Concerned

Watch out for:
- High **loops** count on expensive operations
- Missing indexes on the inner table's join column
- Large outer result sets (nested loops don't scale well)

### Hash Join

When joining large tables where nested loops would be too slow, PostgreSQL often chooses hash joins. This algorithm builds a hash table from one table, then probes it with rows from the other table.

#### Understanding Hash Joins

Hash joins work in two phases:
1. **Build phase**: Create a hash table from the smaller table
2. **Probe phase**: Scan the larger table and look up matches in the hash table

Think of it like creating a phone book (hash table) from your contacts, then looking up numbers as you go through a list of people to call.

```sql
EXPLAIN ANALYZE
SELECT o.*, u.username
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.created_at >= '2024-01-01'
LIMIT 100;

 Hash Join  (cost=4558.00..64262.11 rows=1000000 width=126)
            (actual time=21.966..589.594 rows=1000000 loops=1)
   Hash Cond: (o.user_id = u.id)
   ->  Seq Scan on orders o  (cost=0.00..21432.00 rows=1000000 width=116)
                             (actual time=0.002..25.622 rows=1000000 loops=1)
   ->  Hash  (cost=2819.00..2819.00 rows=100000 width=14)
             (actual time=20.349..20.349 rows=100001 loops=1)
         Buckets: 2048  Batches: 128  Memory Usage: 55kB
         ->  Seq Scan on users u  (cost=0.00..2819.00 rows=100000 width=14)
                                  (actual time=0.001..7.047 rows=100001 loops=1)
 Planning Time: 0.079 ms
 Execution Time: 604.340 ms
```

#### Critical Metrics Explained

The line `Buckets: 2048  Batches: 128  Memory Usage: 55kB` tells us a lot:

- **Buckets: 2048** - The hash table has 2048 slots (always a power of 2)
- **Batches: 128** - **This is a problem!** The hash table was too big for memory, so PostgreSQL split it into 128 separate batches
- **Memory Usage: 55kB** - Each batch uses only 55kB (constrained by `work_mem`)

#### Understanding Batches (and Why They're Bad)

When `Batches: 1`, the entire hash table fits in memory - this is ideal. But with `Batches: 128`, PostgreSQL had to:
1. Split the users table into 128 temporary files on disk
2. Process each batch separately
3. Write and read from disk 128 times

This explains why our query took 604ms - most of that time was disk I/O!

#### Fixing Hash Join Performance

To improve this query:
```sql
-- Increase work_mem for this session
SET work_mem = '256MB';

-- Now the same query might show:
-- Buckets: 131072  Batches: 1  Memory Usage: 24MB
```

With `Batches: 1`, the entire hash table stays in memory, dramatically improving performance.

#### When Hash Joins are Chosen

PostgreSQL uses hash joins when:
- Joining large tables (where nested loops would be too slow)
- No useful indexes exist for the join
- The join condition uses equality (=) only
- One table is significantly smaller (for the hash table)

**Real-world example**: Joining all orders to all users to create a report - both tables are large, and you need all rows.

### Merge Join

The third join algorithm is elegant: if both inputs are sorted on the join column, PostgreSQL can merge them together in a single pass, like merging two sorted lists.

#### How Merge Joins Work

Imagine you have two stacks of cards, both sorted by number. To find matching pairs:
1. Take the top card from each stack
2. If they match, output the pair
3. If left < right, advance the left stack
4. If right < left, advance the right stack
5. Continue until one stack is empty

```sql
EXPLAIN ANALYZE
SELECT u.created_at, o.created_at
FROM users u
JOIN orders o ON u.created_at = o.created_at
LIMIT 100;

 Limit  (cost=1.12..29.16 rows=100 width=16)
        (actual time=68.602..68.602 rows=0 loops=1)
   ->  Merge Join  (cost=1.12..32450.39 rows=115729 width=16)
                   (actual time=68.602..68.602 rows=0 loops=1)
         Merge Cond: (u.created_at = o.created_at)
         ->  Index Only Scan using idx_users_created_at on users u  (cost=0.29..2604.29 rows=100000 width=8)
                                                                     (actual time=0.004..8.544 rows=100001 loops=1)
               Heap Fetches: 6
         ->  Index Only Scan using idx_orders_created_at on orders o  (cost=0.42..25940.42 rows=1000000 width=8)
                                                                       (actual time=0.005..39.723 rows=1000000 loops=1)
               Heap Fetches: 0
 Planning Time: 0.351 ms
 Execution Time: 68.614 ms
```

#### Key Observations

Notice how both inputs use index scans:
- Users: Scanned 100,001 rows in order by created_at (8.544ms)
- Orders: Scanned 1,000,000 rows in order by created_at (39.723ms)
- Result: 0 rows (no users and orders with identical timestamps)

The beauty of merge join is that each table is read only once, in order. No random access, no hash tables, no repeated scans.

#### When Merge Joins Excel

PostgreSQL chooses merge joins when:
- Both inputs are already sorted (via index or explicit sort)
- Joining very large tables where hash tables would be too big
- The join uses equality or inequality operators (<, >, <=, >=)
- You need sorted output anyway (for ORDER BY)

#### Merge Join vs Other Algorithms

**Compared to Nested Loop:**
- Better for large datasets (single pass vs quadratic behavior)
- Doesn't need indexes on join columns (just sorted data)

**Compared to Hash Join:**
- Can handle inequality joins (not just =)
- No memory constraints (doesn't build hash tables)
- Predictable performance (no batch spillover)

**Real-world example**: Time-series joins where you match events within time windows, or joining two large tables that are naturally ordered by date.

## Aggregation and Grouping

After joining tables, you often need to summarize data using GROUP BY. PostgreSQL has two strategies for grouping: hash-based and sort-based. Understanding when each is used helps you optimize aggregation queries.

### HashAggregate

Just like hash joins use hash tables for matching rows, HashAggregate uses hash tables for grouping. It's the fastest method when you have enough memory and don't need sorted results.

#### Understanding HashAggregate

When you write `GROUP BY status`, PostgreSQL can:
1. Create a hash table with one bucket per unique status
2. Scan the table, updating counters in each bucket
3. Output the final aggregated results

Let's examine a more complex example with parallel execution:

```sql
EXPLAIN ANALYZE
SELECT status, COUNT(*), AVG(total_amount)
FROM orders
GROUP BY status;

 Finalize GroupAggregate  (cost=19723.78..19724.85 rows=4 width=50)
                         (actual time=50.478..64.344 rows=4 loops=1)
   Group Key: status
   ->  Gather Merge  (cost=19723.78..19724.72 rows=8 width=50)
                     (actual time=50.366..64.330 rows=12 loops=1)
         Workers Planned: 2
         Workers Launched: 2
         ->  Sort  (cost=18723.76..18723.77 rows=4 width=50)
                   (actual time=48.765..48.765 rows=4 loops=3)
               Sort Key: status
               Sort Method: quicksort  Memory: 25kB
               ->  Partial HashAggregate  (cost=18723.67..18723.72 rows=4 width=50)
                                         (actual time=48.749..48.750 rows=4 loops=3)
                     Group Key: status
                     Batches: 1  Memory Usage: 24kB
                     ->  Parallel Seq Scan on orders  (cost=0.00..15598.67 rows=416667 width=16)
                                                      (actual time=0.028..14.355 rows=333333 loops=3)
 Planning Time: 0.398 ms
 Execution Time: 64.365 ms
```

#### Breaking Down Parallel Aggregation

This plan shows a sophisticated parallel aggregation strategy:

1. **Parallel Seq Scan**: 3 workers (loops=3) each scan ~333,333 rows
2. **Partial HashAggregate**: Each worker groups its portion using a hash table
   - `Batches: 1` means the hash table fit in memory (good!)
   - `Memory Usage: 24kB` for grouping just 4 statuses
3. **Sort**: Workers sort their partial results by status
4. **Gather Merge**: Combine sorted results from all workers
5. **Finalize GroupAggregate**: Merge partial aggregates into final results

#### Why Mix Hash and Sort?

You might wonder why PostgreSQL used both HashAggregate AND GroupAggregate. This is a parallel query optimization:
- Workers use HashAggregate (fast for initial grouping)
- Final merge uses GroupAggregate (efficient for combining pre-aggregated data)

#### When Pure HashAggregate is Used

For simpler queries without parallelism:
```sql
 HashAggregate  (cost=23932.00..23932.04 rows=4 width=50)
   Group Key: status
   Batches: 1  Memory Usage: 24kB
   ->  Seq Scan on orders
```

This is the simplest and often fastest approach for small numbers of groups.

### GroupAggregate

When data is already sorted (or can be sorted efficiently), PostgreSQL uses GroupAggregate. This method processes groups sequentially, using less memory than hash aggregation.

#### How GroupAggregate Works

Unlike HashAggregate, GroupAggregate processes data in order:
1. Ensure data is sorted by the GROUP BY columns
2. Read rows sequentially
3. When the group key changes, output the aggregated result
4. Start accumulating the next group

```sql
EXPLAIN ANALYZE
SELECT date_trunc('day', created_at) AS day, COUNT(*)
FROM orders
WHERE created_at >= '2024-01-01'
GROUP BY day
ORDER BY day
LIMIT 10;

 Limit  (cost=52158.83..52160.14 rows=10 width=16)
        (actual time=62.782..65.747 rows=10 loops=1)
   ->  Finalize GroupAggregate  (cost=52158.83..144644.84 rows=706147 width=16)
                                (actual time=62.782..65.745 rows=10 loops=1)
         Group Key: (date_trunc('day'::text, created_at))
         ->  Gather Merge  (cost=52158.83..132610.82 rows=641436 width=16)
                           (actual time=62.751..65.740 rows=31 loops=1)
               Workers Planned: 2
               Workers Launched: 2
               ->  Partial GroupAggregate  (cost=51158.81..57573.17 rows=320718 width=16)
                                           (actual time=58.600..60.358 rows=63 loops=3)
                     Group Key: (date_trunc('day'::text, created_at))
                     ->  Sort  (cost=51158.81..51960.60 rows=320718 width=8)
                               (actual time=58.565..59.588 rows=29057 loops=3)
                           Sort Key: (date_trunc('day'::text, created_at))
                           Sort Method: external merge  Disk: 4816kB
                           ->  Parallel Seq Scan on orders  (cost=0.00..17442.13 rows=320718 width=8)
                                                            (actual time=0.039..32.511 rows=256251 loops=3)
                                 Filter: (created_at >= '2024-01-01 00:00:00'::timestamp without time zone)
                                 Rows Removed by Filter: 77083
 Planning Time: 0.080 ms
 Execution Time: 70.267 ms
```

#### Performance Problem Spotted!

Notice the line: `Sort Method: external merge  Disk: 4816kB`

This query has a serious performance issue - the sort spilled to disk! Each worker needed to sort ~250,000 rows, which exceeded available memory.

#### When GroupAggregate is Chosen

PostgreSQL uses GroupAggregate when:
- Data is already sorted (from an index or previous sort)
- You need results in order anyway (ORDER BY matches GROUP BY)
- There are many groups (hash table would be too large)
- Memory is constrained

#### GroupAggregate vs HashAggregate Trade-offs

**GroupAggregate advantages:**
- Uses minimal memory (processes one group at a time)
- Produces ordered output
- Handles unlimited numbers of groups

**HashAggregate advantages:**
- No sorting required (faster for unsorted data)
- Single pass through data
- Better for small numbers of groups

## Sorting Operations

Sorting is fundamental to many operations - not just ORDER BY, but also merge joins, GroupAggregate, and windowing functions. PostgreSQL chooses between in-memory and disk-based sorting based on data size and available memory.

### In-Memory Sort

When sorting small datasets that fit in memory, PostgreSQL uses efficient in-memory algorithms.

#### Example: Index-Optimized Sort

```sql
EXPLAIN ANALYZE
SELECT * FROM users
WHERE country_code = 'US'
ORDER BY created_at DESC
LIMIT 100;

 Limit  (cost=0.29..17.24 rows=100 width=113)
        (actual time=0.006..0.111 rows=100 loops=1)
   ->  Index Scan Backward using idx_users_created_at on users  (cost=0.29..10130.22 rows=59790 width=113)
                                                                 (actual time=0.006..0.107 rows=100 loops=1)
         Filter: ((country_code)::text = 'US'::text)
         Rows Removed by Filter: 54
 Planning Time: 0.071 ms
 Execution Time: 0.116 ms
```

Here, PostgreSQL cleverly avoided sorting entirely! By reading the index backwards, it delivered pre-sorted results. This is why proper indexing is crucial.

#### True In-Memory Sort Example

When an index isn't available, you'll see an actual sort operation:

```sql
Sort  (cost=18723.76..18723.77 rows=4 width=50)
      (actual time=48.765..48.765 rows=4 loops=3)
  Sort Key: status
  Sort Method: quicksort  Memory: 25kB
```

Key indicators of a healthy in-memory sort:
- **Sort Method: quicksort** - The fastest algorithm
- **Memory: 25kB** - Sort completed entirely in RAM
- Small time difference between start and completion

### External Sort (Disk-Based)

When data exceeds `work_mem`, PostgreSQL must use disk for sorting:

```sql
Sort  (cost=51158.81..51960.60 rows=320718 width=8)
      (actual time=58.565..59.588 rows=29057 loops=3)
  Sort Key: (date_trunc('day'::text, created_at))
  Sort Method: external merge  Disk: 4816kB
```

#### Understanding External Merge Sort

When PostgreSQL can't fit all data in memory:
1. Sorts chunks that fit in `work_mem`
2. Writes sorted chunks to temporary files
3. Merges the sorted files to produce final output

The **Disk: 4816kB** tells us how much temporary disk space was used. This is a performance red flag!

#### Sort Methods Explained

PostgreSQL chooses different algorithms based on the situation:

- **quicksort**: Default for in-memory sorts. Fast but requires all data in RAM.
- **top-N heapsort**: Used for `ORDER BY ... LIMIT N` when N is small. Keeps only the top N rows in memory.
- **external merge**: Disk-based sorting for large datasets. Much slower due to I/O.

#### Optimizing Sort Performance

To avoid disk sorts:
```sql
-- Increase work_mem for the session
SET work_mem = '256MB';

-- Or create an index on the sort column
CREATE INDEX idx_orders_created_at ON orders(created_at);
```

## Advanced Plan Elements

Beyond basic scans, joins, and aggregations, PostgreSQL has sophisticated features for complex queries. Understanding these advanced elements helps you optimize modern applications using parallelism, CTEs, and subqueries.

### Parallel Query Execution

Modern PostgreSQL can split work across multiple CPU cores. Understanding parallel query plans is essential for optimizing large-scale data processing.

#### How Parallel Queries Work

```sql
SET max_parallel_workers_per_gather = 2;
EXPLAIN ANALYZE
SELECT COUNT(*) FROM orders WHERE total_amount > 100;

 Finalize Aggregate  (cost=18636.41..18636.42 rows=1 width=8)
                     (actual time=29.257..30.348 rows=1 loops=1)
   ->  Gather  (cost=18636.20..18636.41 rows=2 width=8)
               (actual time=29.121..30.345 rows=3 loops=1)
         Workers Planned: 2
         Workers Launched: 2
         ->  Partial Aggregate  (cost=17636.20..17636.21 rows=1 width=8)
                               (actual time=27.019..27.019 rows=1 loops=3)
               ->  Parallel Seq Scan on orders  (cost=0.00..16640.33 rows=398345 width=0)
                                                (actual time=0.005..21.210 rows=318402 loops=3)
                     Filter: (total_amount > '100'::numeric)
                     Rows Removed by Filter: 14932
 Planning Time: 0.056 ms
 Execution Time: 30.357 ms
```

#### Breaking Down Parallel Execution

1. **Parallel Seq Scan**: The table is divided among workers
   - `loops=3` means 3 processes total (1 leader + 2 workers)
   - Each processed ~318,402 rows (roughly 1/3 of the table)

2. **Partial Aggregate**: Each worker counts its portion
   - Workers compute partial results independently
   - No communication needed during this phase

3. **Gather**: Collect results from all workers
   - This is the synchronization point
   - `rows=3` shows we collected 3 partial counts

4. **Finalize Aggregate**: Combine partial results
   - Sum the counts from all workers
   - Produce the final result

#### Key Parallel Metrics

- **Workers Planned vs Launched**: If these differ, PostgreSQL couldn't allocate enough workers (resource constraint)
- **loops**: Shows how many processes executed each node
- **Row distribution**: Check if rows are evenly distributed (318,402 per worker is good)

#### When Parallel Queries Help

Parallel execution is beneficial for:
- Large table scans (Sequential or Bitmap)
- Aggregations over many rows
- Sorts of large datasets
- Hash joins with large tables

But NOT for:
- Small tables (overhead exceeds benefit)
- Index scans (usually already fast)
- Queries returning many rows to client

### CTE Scan (Common Table Expressions)

Common Table Expressions (CTEs) are the WITH clauses that let you write more readable queries. Understanding how PostgreSQL handles them is crucial for performance.

#### CTE Optimization in Modern PostgreSQL

```sql
EXPLAIN ANALYZE
WITH high_value_users AS (
    SELECT user_id, SUM(total_amount) as total_spent
    FROM orders
    WHERE status = 'completed'
    GROUP BY user_id
    HAVING SUM(total_amount) > 5000
)
SELECT u.username, h.total_spent
FROM users u
JOIN high_value_users h ON u.id = h.user_id
LIMIT 10;

 Limit  (cost=0.72..26.23 rows=10 width=42)
        (actual time=0.020..0.081 rows=10 loops=1)
   ->  Merge Join  (cost=0.72..78015.27 rows=30579 width=42)
                   (actual time=0.020..0.080 rows=10 loops=1)
         Merge Cond: (u.id = orders.user_id)
         ->  Index Scan using users_pkey on users u  (cost=0.29..4426.29 rows=100000 width=14)
                                                     (actual time=0.003..0.004 rows=15 loops=1)
         ->  GroupAggregate  (cost=0.42..72650.95 rows=30579 width=36)
                            (actual time=0.016..0.074 rows=10 loops=1)
               Group Key: orders.user_id
               Filter: (sum(orders.total_amount) > '5000'::numeric)
               Rows Removed by Filter: 5
               ->  Index Scan using idx_orders_user_id on orders  (cost=0.42..67771.73 rows=700633 width=10)
                                                                  (actual time=0.005..0.064 rows=116 loops=1)
                     Filter: ((status)::text = 'completed'::text)
                     Rows Removed by Filter: 36
```

#### Important: No CTE Scan Node!

Notice there's no "CTE Scan" in this plan. PostgreSQL 12+ automatically **inlined** the CTE into the main query. This is a major optimization - the query executes as if you wrote it without the CTE.

#### When CTEs are Materialized

Sometimes you'll see an actual CTE Scan:

```sql
WITH RECURSIVE category_tree AS (
    -- Recursive CTEs are always materialized
)
-- Or when explicitly requested:
WITH high_value_users AS MATERIALIZED (
    -- This forces materialization
)
```

Materialized CTEs:
- Compute results once and store in memory
- Useful when referenced multiple times
- Can act as optimization fences
- Required for recursive CTEs

#### CTE Performance Considerations

**Inlined CTEs (default in PostgreSQL 12+):**
- No performance penalty
- Optimizer can see through them
- Purely for readability

**Materialized CTEs:**
- Create temporary result set
- Can't push down predicates
- Useful for forcing evaluation order

### InitPlan / SubPlan

Subqueries in PostgreSQL can be executed in two ways: InitPlan (executed once) or SubPlan (executed repeatedly). Understanding the difference is crucial for query performance.

#### InitPlan: The Good Kind

InitPlans are subqueries that PostgreSQL executes once at the beginning:

```sql
EXPLAIN ANALYZE
SELECT * FROM orders
WHERE total_amount > (SELECT AVG(total_amount) FROM orders);

 Bitmap Heap Scan on orders  (cost=23888.32..39486.99 rows=333333 width=116)
                             (actual time=53.599..78.352 rows=500213 loops=1)
   Recheck Cond: (total_amount > $1)
   Heap Blocks: exact=11378
   InitPlan 1 (returns $1)
     ->  Finalize Aggregate  (cost=17640.56..17640.57 rows=1 width=32)
                            (actual time=27.101..27.124 rows=1 loops=1)
           ->  Gather  (cost=17640.34..17640.55 rows=2 width=32)
                       (actual time=26.948..27.119 rows=3 loops=1)
                 Workers Planned: 2
                 Workers Launched: 2
                 ->  Partial Aggregate  (cost=16640.34..16640.35 rows=1 width=32)
                                       (actual time=25.709..25.710 rows=1 loops=3)
                       ->  Parallel Seq Scan on orders orders_1  (cost=0.00..15598.67 rows=416667 width=6)
                                                                 (actual time=0.002..9.329 rows=333333 loops=3)
   ->  Bitmap Index Scan on idx_orders_total_amount  (cost=0.00..6164.42 rows=333333 width=0)
                                                     (actual time=52.779..52.779 rows=500213 loops=1)
         Index Cond: (total_amount > $1)
```

Key points about this InitPlan:
- **InitPlan 1 (returns $1)**: Calculates average once (27.124 ms)
- **$1**: The result is stored in parameter $1
- **Recheck Cond: (total_amount > $1)**: Uses the cached result
- Total overhead: Just 27ms for the entire subquery

#### SubPlan: The Performance Killer

SubPlans are correlated subqueries executed for each row:

```sql
-- Example of a query that would create a SubPlan
SELECT o.*,
       (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
FROM orders o;

-- Would show:
SubPlan 1
  ->  Aggregate (cost=8.28..8.29 rows=1 width=8)
        ->  Index Scan using idx_order_items_order_id
              Index Cond: (order_id = o.id)
```

If this SubPlan runs for 1 million orders, that's 1 million separate queries!

#### Recognizing the Difference

**InitPlan characteristics:**
- Appears before the main query execution
- Shows "loops=1" (executed once)
- Results in parameters like $1, $2
- Good for performance

**SubPlan characteristics:**
- Appears within the main query nodes
- Shows "loops=N" where N > 1
- References outer query columns
- Usually indicates a performance problem

#### Converting SubPlans to Joins

Instead of correlated subqueries, use joins:
```sql
-- Instead of SubPlan approach:
SELECT o.*, (SELECT COUNT(*) FROM order_items WHERE order_id = o.id)
FROM orders o;

-- Use a join:
SELECT o.*, COALESCE(oi.item_count, 0) as item_count
FROM orders o
LEFT JOIN (
    SELECT order_id, COUNT(*) as item_count
    FROM order_items
    GROUP BY order_id
) oi ON o.id = oi.order_id;
```

## Conclusion

You now have the foundation to read and understand PostgreSQL's EXPLAIN ANALYZE output. We've covered:

- How to decode cost estimates and actual execution times
- Six different scan strategies and when PostgreSQL uses each
- Three join algorithms and their performance characteristics
- How aggregation and sorting operations work
- Advanced features like parallel queries and CTEs

With this knowledge, you can look at any query plan and understand what PostgreSQL is doing and why. The next step is learning to identify performance problems and apply optimizations.

## What's Next?

In the follow-up post, we'll put this knowledge into practice by covering:

- Identifying performance red flags in query plans
- Common optimization patterns and solutions
- A practical workflow for analyzing slow queries
- Configuration tuning for better performance

Stay tuned for the practical guide to applying these EXPLAIN ANALYZE concepts!

---

**Want more PostgreSQL optimization tips?** Subscribe to get notified when new database performance articles are published.

## References

- [PostgreSQL Documentation: Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL official EXPLAIN documentation (opens in new tab)"}
- [PostgreSQL Documentation: Planner Statistics](https://www.postgresql.org/docs/current/planner-stats.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL planner statistics documentation (opens in new tab)"}
- [PostgreSQL Query Planning](https://www.postgresql.org/docs/current/planner-optimizer.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL query planner documentation (opens in new tab)"}