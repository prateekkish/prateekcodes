---
layout: post
title: "PostgreSQL Fundamentals: Memory vs Disk Performance (Part 1)"
author: prateek
categories: [ PostgreSQL, Database ]
tags: [ postgres, database-fundamentals, memory, disk, performance, storage ]
excerpt: "Understand the fundamental difference between memory and disk performance, and why this matters for database systems like PostgreSQL."
description: "Learn why memory is thousands of times faster than disk, how this impacts database performance, and the concepts of sequential vs random I/O in PostgreSQL."
keywords: "postgres memory vs disk, database performance basics, sequential vs random io, disk latency, memory access speed, postgres storage fundamentals, database io performance"
---

When working with databases, understanding the performance difference between memory (RAM) and disk is fundamental. This isn't just academic knowledge. It shapes how PostgreSQL and every other database system is designed.

This is Part 1 of a series on PostgreSQL internals. Understanding these concepts will help you grasp how PostgreSQL works under the hood.

## The Speed Gap

Let's start with hard numbers (based on [Latency Numbers Every Programmer Should Know](https://gist.github.com/jboner/2841832){:target="_blank" rel="noopener noreferrer" aria-label="Latency numbers reference (opens in new tab)"}):

```
Memory (RAM) access:     ~100 nanoseconds
SSD read:                ~100 microseconds  (1,000x slower than RAM)
HDD read:                ~10 milliseconds   (100,000x slower than RAM)
```

To put this in perspective, if accessing RAM took 1 second, reading from an SSD would take 16 minutes, and reading from a traditional hard drive would take over a day.

## Why This Matters for Databases

Databases need to store data permanently (on disk) but access it quickly (from memory). This creates a fundamental tension.

```sql
-- When you run this query
SELECT * FROM users WHERE id = 123;

-- Ideal scenario: Data is in memory
-- PostgreSQL checks shared_buffers (memory cache)
-- Returns result in microseconds ✓

-- Worst scenario: Data is on disk
-- PostgreSQL must read from disk
-- Returns result in milliseconds ✗
```

A query reading from memory might take 0.1ms. The same query reading from disk might take 10ms. That's a 100x difference.

When you're handling thousands of requests per second, this gap can become gianormous.

## Sequential vs Random I/O

Not all disk access is equal. How you access disk data makes a huge difference.

### Sequential I/O (Fast)

Reading data in order from disk:

```
Disk head position:  [————READ————>]
Data blocks:         [1][2][3][4][5][6][7][8]
                      ↑  ↑  ↑  ↑  ↑  ↑  ↑  ↑
                      Read continuously in order
```

Think of reading a book from start to finish. The disk head moves smoothly across the platter (for HDDs) or the SSD reads consecutive blocks efficiently.

**Speed: ~100-500 MB/s on SSDs, ~80-160 MB/s on HDDs**

### Random I/O (Slow)

Jumping around to different locations:

```
Data blocks:         [1][x][x][x][5][x][2][x][8]
                      ↑           ↑     ↑     ↑
Disk head position:   1st ·seek·> 2nd ·seek·> 3rd ·seek·> 4th
                      Read blocks 1, 5, 2, 8 (scattered)
```

Think of flipping randomly through a book. Each jump requires the disk head to physically move (HDDs) or the SSD to switch between different memory cells.

**Speed: ~10,000-100,000 IOPS on SSDs, ~100-200 IOPS on HDDs**

For a typical 4KB read:
- Sequential: Can read 25,000+ blocks per second
- Random: Can read 100-200 blocks per second (HDDs)

That's a 100x difference in throughput.

## How PostgreSQL Uses This Knowledge

PostgreSQL is designed around this performance reality:

### 1. Shared Buffers (Memory Cache)

```sql
-- Check your shared_buffers setting
SHOW shared_buffers;

-- Example output:
--  shared_buffers
-- ----------------
--  16777216kB
-- (1 row)
```

PostgreSQL keeps frequently accessed data pages in memory. This is its primary performance optimization. If data is in shared_buffers, queries run at memory speed.

### 2. Write-Ahead Log Uses Sequential I/O

PostgreSQL writes all changes to a Write-Ahead Log (WAL) using sequential I/O. This is much faster than random writes to data files.

```
WAL File (append-only):
[Write 1][Write 2][Write 3][Write 4]... → Sequential (FAST)
         ↓        ↓        ↓        ↓
      1ms      1ms      1ms      1ms

Data Files (scattered locations):
[Page 42]    [Page 108]    [Page 5]    [Page 251]
   ↓            ↓            ↓            ↓
  5ms    seek  8ms    seek  6ms    seek  7ms    Random (SLOW)
```

### 3. Checkpoints Batch Random Writes

Instead of writing every change to data files immediately (random I/O), PostgreSQL batches them up and writes during checkpoints. This amortizes the cost of random I/O. For a detailed understanding of how checkpoints work, see [Understanding PostgreSQL Checkpoints](/understanding-postgres-checkpoints).

## Practical Example

Let's see this in action:

```sql
-- Create a test table
CREATE TABLE measurements (
    id SERIAL PRIMARY KEY,
    sensor_id INT,
    value DECIMAL,
    recorded_at TIMESTAMP
);

-- Insert 1 million rows
INSERT INTO measurements (sensor_id, value, recorded_at)
SELECT
    (random() * 1000)::INT,
    random() * 100,
    NOW() - (random() * INTERVAL '365 days')
FROM generate_series(1, 1000000);

-- Sequential scan (reads data in order)
EXPLAIN ANALYZE SELECT COUNT(*) FROM measurements;

-- Result: Seq Scan, ~50-100ms (reading sequentially from disk)

-- Random access pattern (without index)
EXPLAIN ANALYZE
SELECT * FROM measurements
WHERE sensor_id IN (5, 100, 500, 999)
ORDER BY recorded_at;

-- Result: Seq Scan, potentially slower due to scattered rows
-- Even though it's a seq scan, matching rows are scattered throughout
```

The full table scan reads pages sequentially (fast I/O), but when rows matching your criteria are scattered across many pages, you're reading more data than needed. With an index on `sensor_id`, this becomes index lookups to scattered pages (random I/O).

## Why Databases Can't Just Use RAM

You might wonder: if RAM is so fast, why not keep everything in memory?

1. **Cost**: RAM is 10-20x more expensive than SSD storage per GB
2. **Volatility**: RAM loses data when power is lost
3. **Capacity**: You might have TBs of data but only GBs of RAM

Databases must balance:
- **Performance**: Keep hot data in memory
- **Durability**: Persist everything to disk
- **Cost**: Use disk for bulk storage

## The Buffer Cache Concept

This is why every database uses a buffer cache:

```
                    User Query
                        │
                        ↓
        ┌───────────────────────────┐
        │   Shared Buffers          │ ← PostgreSQL memory (fastest)
        └───────────────────────────┘
                        │
                        │ (cache miss)
                        ↓
        ┌───────────────────────────┐
        │   OS Page Cache           │ ← Operating system memory (fast)
        └───────────────────────────┘
                        │
                        │ (cache miss)
                        ↓
        ┌───────────────────────────┐
        │   Physical Disk           │ ← Actual disk I/O (slow)
        └───────────────────────────┘
```

When you query data, it goes through multiple cache layers:

1. **Check `shared_buffers`** (PostgreSQL's memory): If found, return immediately
2. **Check OS page cache** (operating system memory): If found, still fast (no physical disk I/O)
3. **Read from physical disk**: Only happens on a complete cache miss (slowest)

This is why sometimes "disk reads" aren't as slow as expected. They might hit the OS page cache, which is still memory access.

The goal is to maximize the "cache hit rate", which is the percentage of requests served from memory (either PostgreSQL's or the OS's).

## Monitoring Cache Performance

Check your cache hit rate:

```sql
SELECT
    sum(heap_blks_read) as heap_read,
    sum(heap_blks_hit)  as heap_hit,
    sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) * 100 AS cache_hit_ratio
FROM pg_statio_user_tables;
```

A healthy database typically has a 95%+ cache hit ratio. If yours is lower, you might need more shared_buffers or have a working set larger than available memory.

## What's Next?

Now that you understand why memory is fast and disk is slow, we can explore how PostgreSQL organizes data on disk. In [Part 2](/postgres-fundamentals-database-storage-part-2), we'll look at pages, tables, and indexes, which are the building blocks of database storage.

## References

- [PostgreSQL Documentation: Resource Consumption](https://www.postgresql.org/docs/current/runtime-config-resource.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL resource consumption documentation (opens in new tab)"}
- [PostgreSQL Documentation: Monitoring Disk Usage](https://www.postgresql.org/docs/current/diskusage.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL disk usage documentation (opens in new tab)"}
