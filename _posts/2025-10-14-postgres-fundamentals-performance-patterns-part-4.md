---
layout: post
title: "PostgreSQL Fundamentals: Performance Patterns and Trade-offs (Part 4)"
author: prateek
categories: [ PostgreSQL, Database ]
tags: [ postgres, database-fundamentals, performance, optimization, io-patterns, write-amplification ]
excerpt: "Learn the performance trade-offs database systems face: write amplification, I/O batching, and why PostgreSQL makes the design choices it does."
description: "Understand database performance patterns including write amplification, I/O batching, fsync behavior, and the fundamental trade-offs between durability and performance in PostgreSQL."
keywords: "postgres performance patterns, database write amplification, io batching database, fsync postgres, database performance tradeoffs, postgres durability performance, sequential vs random io"
---

In [Part 3](/postgres-fundamentals-transactions-part-3), we learned about transactions and ACID properties. Now let's explore the performance implications of building a durable database and the trade-offs PostgreSQL makes.

This is Part 4 of a series on PostgreSQL internals.

## The Durability vs Performance Dilemma

Remember from [Part 3](/postgres-fundamentals-transactions-part-3): durability means committed data survives crashes. But guaranteeing durability is expensive.

```sql
-- When you commit
COMMIT;

-- PostgreSQL must ensure data is on disk
-- But disk writes are slow (See Part 1)
-- This creates a fundamental tension
```

Every database faces this challenge. The solution lies in clever I/O patterns.

## Write Amplification: The Overhead

Write amplification is when you write more data to disk than the actual change requires.

### Example: Updating One Field

```sql
-- You change one field
UPDATE users SET last_login = NOW() WHERE id = 123;
```

What actually happens:

1. **Logical change**: 8 bytes (a timestamp)
2. **Physical write**: Entire 8 KB page must be written

That's 1,000x amplification (8 KB ÷ 8 bytes).

### Why Write the Whole Page?

Disks don't write 8 bytes at a time. The smallest writable unit is typically 512 bytes or 4 KB (disk sector/block size). PostgreSQL's page size matches this reality.

```
You want to change: [X]
Must write: [XXXXXXXX] ← Entire page
```

### Write Amplification with Indexes

It gets worse with indexes:

```sql
UPDATE users SET email = 'newemail@example.com' WHERE id = 123;
```

PostgreSQL must update:
1. The table page (8 KB)
2. The old index entry (mark as deleted)
3. The new index entry (insert)
4. Any other indexes on updated columns

One logical change = multiple page writes.

## I/O Batching: This is the way

Instead of writing each change immediately, batch them:

```sql
-- Transaction 1
UPDATE users SET last_login = NOW() WHERE id = 1;
COMMIT;

-- Transaction 2
UPDATE users SET last_login = NOW() WHERE id = 2;
COMMIT;

-- Transaction 3
UPDATE users SET last_login = NOW() WHERE id = 3;
COMMIT;
```

If users 1, 2, and 3 are on the same page:
- **Without batching**: Write the page 3 times
- **With batching**: Write the page once with all changes

PostgreSQL batches writes in two ways:
1. **WAL buffering**: Buffer multiple WAL records before flushing
2. **Checkpoint batching**: Accumulate dirty pages, flush together

## Introducing fsync

`fsync` is the system call that forces data to physical disk (not just OS cache). It's slow but necessary for durability.

```c
// Simplified PostgreSQL commit
write(wal_fd, wal_record);   // Write to OS buffer (fast)
fsync(wal_fd);               // Force to physical disk (slow!)
return COMMIT_SUCCESS;       // Now safe to acknowledge
```

### fsync Performance

```
Without fsync:  ~1-2 microseconds (OS buffer)
With fsync:     ~1-2 milliseconds (physical disk)

That's a 1,000x difference!
```

If you commit 1,000 transactions per second and fsync each one:
- 1,000 commits × 2ms = 2,000ms = 2 seconds
- You can only do 500 commits/second, not 1,000

### Group Commit: Batching fsyncs

PostgreSQL uses group commit to amortize fsync cost:

```
Transaction 1 commits → Write WAL record → Wait for fsync
Transaction 2 commits → Write WAL record → Wait for fsync
Transaction 3 commits → Write WAL record → Wait for fsync
                                             ↓
                                    Single fsync for all three!
```

Multiple transactions share the same fsync operation:
- Transaction 1 arrives, starts fsync
- Transactions 2 and 3 arrive while fsync is happening
- All three complete when fsync finishes

```sql
-- See group commit in action
SELECT
    (SELECT sum(xact_commit) FROM pg_stat_database) AS total_commits,
    wal_sync,
    round((SELECT sum(xact_commit) FROM pg_stat_database)::numeric / wal_sync, 2) AS commits_per_sync
FROM pg_stat_wal;

-- Example output:
-- total_commits | wal_sync  | commits_per_sync
-- --------------+-----------+-----------------
-- 68245891203   | 204512847 | 33.37

-- commits_per_sync of 33.37 means ~33 commits share each fsync
-- Group commit is batching effectively
```

## Sequential vs Random I/O Revisited

From [Part 1](/postgres-fundamentals-memory-vs-disk-part-1), we know sequential I/O is faster. Let's see why this matters for database design.

### Random Write Pattern (Slow)

Updating scattered rows:

```sql
UPDATE users SET last_login = NOW() WHERE id IN (1, 5000, 10000, 50000);

-- These rows are likely on different pages
-- PostgreSQL must write multiple pages scattered across disk
```

Disk head (or SSD controller) jumps around:
```
Write page 1    → seek →
Write page 5000 → seek →
Write page 10000 → seek →
Write page 50000
```

Each seek adds latency (5-10ms on HDD).

### Sequential Write Pattern (Fast)

WAL writes sequentially:

```sql
-- Same updates, but WAL records are written sequentially
[Record 1][Record 2][Record 3][Record 4]...

-- No seeking, just append
```

This is why PostgreSQL uses WAL:
- Changes go to WAL (sequential, fast)
- Data pages updated later (random, slow but batched)

## The Write-Back Cache Pattern

PostgreSQL uses a write-back cache pattern:

```
1. Change happens → Write to WAL (fast, sequential)
2. Change happens → Update page in memory (fastest)
3. Later → Flush dirty pages to disk (slow, random, but batched)
```

This is the same pattern CPUs use with L1/L2 cache and main memory. For more on CPU cache hierarchies, see [What Every Programmer Should Know About Memory](https://people.freebsd.org/~lstewart/articles/cpumemory.pdf){:target="_blank" rel="noopener noreferrer" aria-label="CPU memory architecture paper (opens in new tab)"}.

### Dirty Pages Accumulate

```sql
-- Transaction 1
UPDATE users SET name = 'Alice' WHERE id = 1;
COMMIT;
-- Page 1 is now "dirty" (in memory, not yet written to data file)

-- Transaction 2
UPDATE users SET email = 'bob@example.com' WHERE id = 2;
COMMIT;
-- Page 1 is STILL dirty (not written yet)

-- Checkpoint happens
-- Now page 1 with BOTH changes is written once
```

Dirty pages stay in `shared_buffers` until a *checkpoint*.

## Checkpoint (Trade-off alert)

Checkpoints must balance (for a complete understanding of checkpoints, see [Understanding PostgreSQL Checkpoints](/understanding-postgres-checkpoints)):

1. **Frequency**: How often to flush dirty pages?
   - Too frequent: Excessive I/O overhead
   - Too infrequent: Long crash recovery time

2. **Duration**: How fast to write dirty pages?
   - Too fast: I/O spike, queries slow down
   - Too slow: Checkpoint takes too long

PostgreSQL's solution:

```sql
-- Checkpoint configuration
checkpoint_timeout = 5min          -- Max time between checkpoints
max_wal_size = 1GB                 -- Max WAL before forcing checkpoint
checkpoint_completion_target = 0.9 -- Spread writes over 90% of interval
```

`checkpoint_completion_target = 0.9` means:
- Checkpoint interval is 5 minutes
- Spread writes over 4.5 minutes (90%)
- Write ~100 MB per minute instead of 1 GB in one burst

### Visualizing Checkpoint I/O

```
Without spreading (checkpoint_completion_target = 0):
I/O │     ┌────┐
    │     │    │
    │─────┘    └───────────────
    Time →

With spreading (checkpoint_completion_target = 0.9):
I/O │     ┌────────────┐
    │    ╱              ╲
    │───┘                └─────
    Time →
```

Spreading reduces I/O spikes but increases checkpoint duration.

## Write Amplification in PostgreSQL

Let's calculate actual write amplification:

```sql
-- Simple update
UPDATE users SET status = 'active' WHERE id = 123;
```

Writes required:
1. **WAL record**: ~100 bytes (change record + metadata)
2. **Data page**: 8 KB (entire page)
3. **Index page**: 8 KB (if updating indexed column)

Total: ~16 KB written for a ~10 byte logical change.

**Amplification factor: 1,600x**

But this gets batched:
- 100 updates to same page → Write page once at checkpoint
- Effective amplification: ~160x instead of 1,600x

## Understanding the Trade-offs

PostgreSQL's design creates fundamental trade-offs between durability, performance, and resource usage. Let's explore the key decisions database administrators must make.

## The Memory Trade-off

More memory (shared_buffers) = better batching:

```sql
-- Small shared_buffers (128 MB)
-- Pages evicted quickly
-- Less batching opportunity
-- More checkpoints needed

-- Large shared_buffers (8 GB)
-- Pages stay in memory longer
-- More batching opportunity
-- Fewer checkpoints needed
```

But memory is expensive and limited.

## Crash Recovery Time Trade-off

The longer between checkpoints, the more WAL to replay after a crash:

```
Checkpoint every 5 min → ~5 min of WAL to replay
Checkpoint every 30 min → ~30 min of WAL to replay

Larger checkpoint interval = longer recovery time
```

PostgreSQL balances:
- Performance (less frequent checkpoints)
- Recovery time (more frequent checkpoints)

Default `checkpoint_timeout = 5min` is a reasonable middle ground.

## Practical Example: Measuring Write Amplification

```sql
-- Create test table
CREATE TABLE write_test (id SERIAL PRIMARY KEY, data TEXT);

-- Record starting WAL position
SELECT pg_current_wal_lsn() AS start_lsn;
-- Result: 0/1000000

-- Insert 1000 rows
INSERT INTO write_test (data)
SELECT repeat('x', 100)
FROM generate_series(1, 1000);

-- Record ending WAL position
SELECT pg_current_wal_lsn() AS end_lsn;
-- Result: 0/1500000

-- Calculate WAL generated
SELECT pg_wal_lsn_diff('0/1500000', '0/1000000') AS wal_bytes;
-- Result: 5242880 (5 MB)

-- Logical data size
SELECT pg_size_pretty(pg_relation_size('write_test'));
-- Result: 128 KB

-- Write amplification: 5 MB WAL / 128 KB data = ~40x
```

The WAL is much larger than the data due to:
- Transaction metadata
- Index updates
- MVCC version information

## What's Next?

Now that you understand the performance trade-offs databases face, we can dive deep into Write-Ahead Logging. In [Part 5](/postgres-fundamentals-wal-deep-dive-part-5), we'll explore exactly how WAL works, what's inside WAL records, and how it enables both durability and crash recovery.

**Previous**: [Part 3 - Transactions and ACID](/postgres-fundamentals-transactions-part-3)

## References

- [PostgreSQL Documentation: WAL Configuration](https://www.postgresql.org/docs/current/wal-configuration.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL WAL configuration documentation (opens in new tab)"}
- [PostgreSQL Documentation: Checkpoint Parameters](https://www.postgresql.org/docs/current/runtime-config-wal.html#RUNTIME-CONFIG-WAL-CHECKPOINTS){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL checkpoint configuration documentation (opens in new tab)"}
- [PostgreSQL Documentation: Resource Consumption](https://www.postgresql.org/docs/current/runtime-config-resource.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL resource consumption documentation (opens in new tab)"}
