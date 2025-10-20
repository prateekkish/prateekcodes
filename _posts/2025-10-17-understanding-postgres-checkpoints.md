---
layout: post
title: "Understanding PostgreSQL Checkpoints: From WAL to Disk"
author: prateek
categories: [ PostgreSQL, Database ]
tags: [ postgres, wal, checkpoints, performance, database-internals ]
excerpt: "A deep dive into how PostgreSQL checkpoints work, from Write-Ahead Logging to persisting data on disk, with practical monitoring commands."
description: "Learn how PostgreSQL checkpoints work, understanding Write-Ahead Logging (WAL), the checkpoint process, and how to monitor checkpoint activity for database performance tuning."
keywords: "postgresql checkpoints, postgres wal, write ahead logging, postgres performance tuning, checkpoint monitoring, postgres internals, database checkpoints"
---

PostgreSQL relies on checkpoints to ensure data durability while maintaining performance. Understanding how checkpoints work and their relationship with Write-Ahead Logging is essential for database performance tuning and troubleshooting.

This post builds on fundamental concepts covered in our PostgreSQL internals series:
- [Part 1: Memory vs Disk Performance](/postgres-fundamentals-memory-vs-disk-part-1)
- [Part 2: How Databases Store Data](/postgres-fundamentals-database-storage-part-2)
- [Part 3: Transactions and ACID](/postgres-fundamentals-transactions-part-3)
- [Part 4: Performance Patterns](/postgres-fundamentals-performance-patterns-part-4)
- [Part 5: Write-Ahead Logging Deep Dive](/postgres-fundamentals-wal-deep-dive-part-5)
- [Part 6: Monitoring and Administration](/postgres-fundamentals-monitoring-administration-part-6)

## Write-Ahead Logging: The Foundation

Checkpoints work hand-in-hand with [Write-Ahead Logging (WAL)](/postgres-fundamentals-wal-deep-dive-part-5). When PostgreSQL modifies data, changes are written to WAL files first (sequential, fast) before updating data pages in memory. Modified pages (called "dirty pages") accumulate in `shared_buffers`, and eventually these changes need to be written to the actual data files. That's where checkpoints come in.

## What Happens During a Checkpoint

A checkpoint is PostgreSQL's process of writing all dirty pages from shared buffers to disk. It creates a known recovery point and ensures data durability.

### The Checkpoint Process

When a checkpoint occurs:

1. **Checkpoint starts**
   - PostgreSQL marks the current WAL position as the checkpoint location
   - This position is the recovery starting point if a crash occurs

2. **Dirty pages are written**
   - All modified data pages in `shared_buffers` are flushed to disk
   - This happens gradually to avoid I/O spikes (controlled by `checkpoint_completion_target`)
   - Pages are written in order to minimize random I/O

3. **Checkpoint completes**
   - A checkpoint record is written to WAL
   - The `pg_control` file is updated with the new checkpoint location
   - Old WAL files (before the checkpoint) can now be recycled or archived

### What Triggers a Checkpoint?

PostgreSQL creates checkpoints based on:

- **Time**: `checkpoint_timeout` parameter (default: 5 minutes)
- **WAL volume**: `max_wal_size` parameter (default: 1GB)
- **Manual trigger**: `CHECKPOINT` command
- **Shutdown**: Always creates a checkpoint during clean shutdown

```sql
-- Force an immediate checkpoint
CHECKPOINT;
```

### Checkpoint Impact on Performance

Checkpoints involve heavy I/O (writing potentially gigabytes of dirty pages), which can cause temporary performance degradation. Understanding [performance trade-offs](/postgres-fundamentals-performance-patterns-part-4) helps you balance durability with speed. PostgreSQL spreads checkpoint writes over time using `checkpoint_completion_target` (default: 0.9) to minimize I/O spikes.

## Monitoring Checkpoint Activity

For detailed monitoring techniques, see [Part 6: Monitoring and Administration](/postgres-fundamentals-monitoring-administration-part-6). Key metrics to track:

### Check Checkpoint Statistics

```sql
-- PostgreSQL 17+
SELECT * FROM pg_stat_checkpointer;

-- PostgreSQL 16 and earlier
SELECT * FROM pg_stat_bgwriter;
```

What to look for:
- High `checkpoints_req` (or `num_requested` in v17+) means checkpoints are happening too frequently
- Large `checkpoint_write_time` (or `write_time` in v17+) indicates heavy I/O load

### Monitor WAL Generation Rate

High WAL generation can trigger frequent checkpoints. See [Part 6](/postgres-fundamentals-monitoring-administration-part-6#pg_stat_wal-wal-activity) for detailed WAL monitoring queries and interpretation.

## Tuning Checkpoint Behavior

Key parameters to adjust (see [Part 4: Performance Patterns](/postgres-fundamentals-performance-patterns-part-4#checkpoint-trade-off-alert) for trade-offs):

```conf
checkpoint_timeout = 15min          # Default: 5min
max_wal_size = 4GB                  # Default: 1GB
checkpoint_completion_target = 0.9  # Default: 0.9
log_checkpoints = on
```

Guidelines:
- Increase `max_wal_size` if `checkpoints_req` is high
- Increase `checkpoint_timeout` for write-heavy workloads
- Keep `checkpoint_completion_target` at 0.9 to avoid I/O spikes

For broader PostgreSQL performance optimization, see [PostgreSQL query optimization guide](/postgresql-query-optimization-guide).

## Conclusion

Checkpoints are PostgreSQL's mechanism for persisting in-memory changes to disk, creating recovery points, and managing WAL files. They balance performance with durability by batching writes and spreading I/O over time. Watch for frequent requested checkpoints and long write times as signals for tuning opportunities.

For deeper understanding, explore the [PostgreSQL internals series](/postgres-fundamentals-memory-vs-disk-part-1), or dive into [PostgreSQL EXPLAIN ANALYZE](/postgresql-explain-analyze-deep-dive) for query optimization.

## References

- [PostgreSQL Documentation: WAL Configuration](https://www.postgresql.org/docs/current/wal-configuration.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL WAL Configuration documentation (opens in new tab)"}
- [PostgreSQL Documentation: Reliability and the Write-Ahead Log](https://www.postgresql.org/docs/current/wal-intro.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL WAL introduction documentation (opens in new tab)"}
- [PostgreSQL Documentation: pg_stat_bgwriter](https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-BGWRITER-VIEW){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL pg_stat_bgwriter documentation (opens in new tab)"}
