---
layout: post
title: "PostgreSQL Fundamentals: Monitoring and Administration Tools (Part 6)"
author: prateek
categories: [ PostgreSQL, Database ]
tags: [ postgres, database-fundamentals, monitoring, administration, pg-waldump, system-views ]
excerpt: "Learn the essential PostgreSQL monitoring tools and system views for understanding database internals, WAL activity, and checkpoint behavior."
description: "Master PostgreSQL monitoring with system views like pg_stat_bgwriter, pg_stat_wal, and tools like pg_waldump. Learn to read PostgreSQL logs and track database performance."
keywords: "postgres monitoring, pg stat bgwriter, pg stat wal, pg waldump, postgres system views, checkpoint monitoring, wal monitoring postgres, postgres log analysis, database administration postgres"
---

In [Part 5](/postgres-fundamentals-wal-deep-dive-part-5), we learned how Write-Ahead Logging works internally. Now let's explore the tools PostgreSQL provides for monitoring and administering these systems.

This is Part 6 (final part) of a series on PostgreSQL internals.

## System Views: Your Window Into PostgreSQL

PostgreSQL exposes extensive information through system views. These views are your primary tool for understanding what's happening inside the database.

### pg_stat_checkpointer: Checkpoint Statistics (PostgreSQL 17+)

The most important view for checkpoint monitoring:

```sql
SELECT * FROM pg_stat_checkpointer;
```

Key columns:

```sql
SELECT
    num_timed,              -- Scheduled checkpoints (time-based)
    num_requested,          -- Requested checkpoints (WAL-based or manual)
    write_time,             -- Milliseconds spent writing files
    sync_time,              -- Milliseconds spent syncing files
    buffers_written,        -- Buffers written during checkpoints
    stats_reset            -- When stats were last reset
FROM pg_stat_checkpointer;
```

**Note**: Before PostgreSQL 17, checkpoint statistics were in `pg_stat_bgwriter` with column names `checkpoints_timed`, `checkpoints_req`, `checkpoint_write_time`, `checkpoint_sync_time`, and `buffers_checkpoint`.

### Interpreting pg_stat_checkpointer

```sql
-- Example output:
num_timed:       1250    -- Mostly time-based (good)
num_requested:   45      -- Few requested (good)
write_time:      450000  -- 450 seconds total writing
sync_time:       2500    -- 2.5 seconds total syncing
buffers_written: 500000  -- 500k buffers written at checkpoints
```

What to look for:

1. **High num_requested**: Checkpoints happening too frequently
   - Solution: Increase `max_wal_size`

2. **High write_time**: Checkpoint I/O is slow
   - Solution: Increase `checkpoint_completion_target`
   - Or: Improve disk I/O performance

3. **High buffers_written relative to checkpoint frequency**: Large checkpoints
   - Solution: More frequent checkpoints or increase `shared_buffers`

### pg_stat_wal: WAL Activity

Monitor WAL generation and flush activity:

```sql
SELECT
    wal_records,        -- Total WAL records generated
    wal_fpi,           -- Full page images written
    wal_bytes,         -- Total bytes written to WAL
    wal_buffers_full,  -- Times WAL buffer was full
    wal_write,         -- Number of WAL writes
    wal_sync,          -- Number of WAL syncs (fsync)
    wal_write_time,    -- Time spent writing WAL (ms)
    wal_sync_time,     -- Time spent syncing WAL (ms)
    stats_reset
FROM pg_stat_wal;
```

### Calculating WAL Generation Rate

```sql
-- Record current WAL stats
CREATE TEMP TABLE wal_baseline AS
SELECT
    now() AS measured_at,
    pg_current_wal_lsn() AS wal_lsn,
    wal_bytes
FROM pg_stat_wal;

-- Wait 60 seconds...
SELECT pg_sleep(60);

-- Calculate rate
SELECT
    pg_size_pretty(
        w.wal_bytes - b.wal_bytes
    ) AS wal_generated,
    EXTRACT(EPOCH FROM (now() - b.measured_at)) AS seconds,
    pg_size_pretty(
        (w.wal_bytes - b.wal_bytes) /
        EXTRACT(EPOCH FROM (now() - b.measured_at))
    ) || '/s' AS wal_rate
FROM pg_stat_wal w, wal_baseline b;

-- Example result:
-- wal_generated: 25 MB
-- seconds: 60
-- wal_rate: 427 kB/s
```

### pg_stat_database: Database-Level Stats

```sql
SELECT
    datname,
    xact_commit,           -- Transactions committed
    xact_rollback,         -- Transactions rolled back
    blks_read,            -- Disk blocks read
    blks_hit,             -- Disk blocks found in cache
    tup_inserted,         -- Rows inserted
    tup_updated,          -- Rows updated
    tup_deleted,          -- Rows deleted
    temp_files,           -- Temp files created
    temp_bytes            -- Temp file bytes
FROM pg_stat_database
WHERE datname = current_database();
```

Calculate cache hit ratio:

```sql
SELECT
    datname,
    round(
        100.0 * blks_hit / nullif(blks_hit + blks_read, 0),
        2
    ) AS cache_hit_ratio
FROM pg_stat_database
WHERE datname = current_database();

-- Healthy databases: 95%+
-- Low ratio: Need more shared_buffers or working set too large
```

### pg_stat_statements: Query-Level WAL Generation

Track which queries generate the most WAL:

```sql
-- Enable extension
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Top WAL generators (PostgreSQL 13+)
SELECT
    substring(query, 1, 60) AS query_preview,
    calls,
    pg_size_pretty(wal_bytes) AS wal_generated,
    pg_size_pretty(wal_bytes / calls) AS wal_per_call,
    round(100.0 * wal_bytes / sum(wal_bytes) OVER (), 2) AS wal_percent
FROM pg_stat_statements
ORDER BY wal_bytes DESC
LIMIT 10;
```

Once you identify high WAL-generating queries, you can optimize write operations: batch INSERT/UPDATE operations, use `COPY` for bulk loads, and consider whether all indexes are necessary.

### pg_stat_activity: Live Connections

```sql
SELECT
    pid,
    usename,
    application_name,
    state,
    query_start,
    state_change,
    wait_event_type,
    wait_event,
    substring(query, 1, 50) AS query_preview
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY query_start;
```

Find long-running queries:

```sql
SELECT
    pid,
    now() - query_start AS duration,
    query
FROM pg_stat_activity
WHERE state = 'active'
  AND now() - query_start > interval '5 minutes'
ORDER BY duration DESC;
```

For long-running queries, you can:

1. **Analyze execution plans**: Use `EXPLAIN ANALYZE` to understand why queries are slow. See [PostgreSQL EXPLAIN ANALYZE Deep Dive](/postgresql-explain-analyze-deep-dive) for detailed analysis techniques.

2. **Offload reads to replicas**: Move long-running SELECT queries to read replicas to reduce contention on the primary database. See [Rails Read Replicas Part 1](/rails-read-replicas-part-1-understanding-the-basics) for implementation patterns.

## PostgreSQL Logs: Checkpoint and WAL Messages

Enable detailed logging in `postgresql.conf`:

```conf
# Log checkpoints
log_checkpoints = on

# Log long-running statements
log_min_duration_statement = 1000  # Log queries > 1 second

# Log connections and disconnections
log_connections = on
log_disconnections = on

# Set log destination
logging_collector = on
log_directory = 'log'
log_filename = 'postgresql-%Y-%m-%d_%H%M%S.log'
```

### Reading Checkpoint Logs

With `log_checkpoints = on`, you'll see:

```
2025-10-17 10:15:42.123 UTC [12345] LOG: checkpoint starting: time
2025-10-17 10:16:11.456 UTC [12345] LOG: checkpoint complete: wrote 2435 buffers (14.9%); 0 WAL file(s) added, 0 removed, 3 recycled; write=29.725 s, sync=0.004 s, total=29.780 s; sync files=7, longest=0.003 s, average=0.001 s; distance=49142 kB, estimate=49142 kB
```

Breakdown:

```
wrote 2435 buffers (14.9%)    # Dirty pages written (14.9% of shared_buffers)
0 WAL file(s) added           # New WAL segments created
0 removed                     # Old WAL segments deleted
3 recycled                    # WAL segments renamed for reuse
write=29.725 s                # Time spent writing buffers
sync=0.004 s                  # Time spent fsync'ing
total=29.780 s                # Total checkpoint duration
distance=49142 kB             # WAL generated since last checkpoint
estimate=49142 kB             # Estimated WAL to next checkpoint
```

What to watch:

1. **High write time**: Checkpoint taking too long
   - Check disk I/O performance
   - Consider spreading checkpoint over more time

2. **Frequent checkpoints**: If you see many "checkpoint starting: xlog" instead of "checkpoint starting: time"
   - Increase `max_wal_size`

3. **Large distance**: Generating lots of WAL
   - Normal for write-heavy workloads
   - Ensure `max_wal_size` is adequate

## pg_waldump: Inspecting WAL Records

`pg_waldump` lets you read WAL files directly:

```bash
# Find WAL files
ls $PGDATA/pg_wal/

# If this doesn't work, replace PGDATA with output from SHOW data_directory;

# Dump a WAL segment
pg_waldump $PGDATA/pg_wal/000000010000000000000001

# Output shows each WAL record:
rmgr: Heap        len: 54   rec: INSERT off 1 flags 0x00
rmgr: Btree       len: 72   rec: INSERT_LEAF off 5
rmgr: Transaction len: 34   rec: COMMIT 2025-10-17 10:15:42.123456 UTC
```

### Filtering WAL Records

```bash
# Show only specific resource manager (Heap = table data)
pg_waldump -r Heap $PGDATA/pg_wal/000000010000000000000001

# Show records from specific LSN range
pg_waldump -s 0/1500000 -e 0/1600000 $PGDATA/pg_wal/000000010000000000000001

# Show statistics summary
pg_waldump --stats $PGDATA/pg_wal/000000010000000000000001
```

### Understanding WAL Record Output

```bash
rmgr: Heap        len: 54   rec: INSERT off 1
    lsn: 0/01500028, prev: 0/01500000, desc: INSERT off 1 flags 0x00
    blkref #0: rel 1663/16384/16385 blk 0
```

Breaking this down:

```
rmgr: Heap              # Resource manager (table data)
len: 54                 # Record length in bytes
rec: INSERT             # Operation type
lsn: 0/01500028        # Log Sequence Number
prev: 0/01500000       # Previous record LSN
blkref #0:             # Block reference
  rel 1663/16384/16385 # Relation OID (tablespace/database/relation)
  blk 0                # Block number
```

## pg_control: Database Cluster State

View control file (requires command-line tool):

```bash
pg_controldata $PGDATA
```

Key information:

```
pg_control version number:            1300
Catalog version number:               202107181
Database system identifier:           7012345678901234567
Database cluster state:               in production
pg_control last modified:             Thu 17 Oct 2025 10:15:42 AM UTC
Latest checkpoint location:           0/1500000
Latest checkpoint's REDO location:    0/1480000
Latest checkpoint's TimeLineID:       1
Latest checkpoint's full_page_writes: on
Latest checkpoint's NextXID:          0:1000
Latest checkpoint's NextOID:          24576
```

This shows the last checkpoint LSN, which is crucial for crash recovery.

## Monitoring Checkpoint Health

Create a monitoring query (PostgreSQL 17+):

```sql
CREATE OR REPLACE VIEW checkpoint_health AS
SELECT
    num_timed,
    num_requested,
    round(100.0 * num_requested /
          nullif(num_timed + num_requested, 0), 2
    ) AS req_checkpoint_pct,
    pg_size_pretty(
        buffers_written * 8192::bigint
    ) AS checkpoint_write_size,
    round(
        write_time::numeric /
        nullif(num_timed + num_requested, 0),
        2
    ) AS avg_checkpoint_write_ms,
    round(
        sync_time::numeric /
        nullif(num_timed + num_requested, 0),
        2
    ) AS avg_checkpoint_sync_ms
FROM pg_stat_checkpointer;

-- Check health
SELECT * FROM checkpoint_health;

-- Example output:
-- num_timed: 1200
-- num_requested: 50
-- req_checkpoint_pct: 4.00           ← Good (< 10%)
-- checkpoint_write_size: 4000 MB
-- avg_checkpoint_write_ms: 375.21
-- avg_checkpoint_sync_ms: 2.08
```

**For PostgreSQL 16 and earlier**, use `pg_stat_bgwriter` with column names `checkpoints_timed`, `checkpoints_req`, `checkpoint_write_time`, `checkpoint_sync_time`, and `buffers_checkpoint`.

Healthy checkpoint system:
- `req_checkpoint_pct` < 10%: Most checkpoints are scheduled
- Reasonable write times: Not overwhelming the I/O system
- Consistent checkpoint sizes

## Resetting Statistics

Statistics accumulate since the last reset:

```sql
-- Reset all statistics
SELECT pg_stat_reset();

-- Reset bgwriter stats
SELECT pg_stat_reset_shared('bgwriter');

-- Reset WAL stats
SELECT pg_stat_reset_shared('wal');

-- Check when stats were last reset
SELECT stats_reset FROM pg_stat_bgwriter;
```

Reset stats to measure recent behavior or after configuration changes.

## Putting It All Together

A complete checkpoint monitoring query:

```sql
WITH wal_rate AS (
    SELECT
        pg_size_pretty(wal_bytes) AS total_wal,
        wal_records AS total_records,
        wal_fpi AS full_page_images
    FROM pg_stat_wal
),
checkpoint_stats AS (
    SELECT
        checkpoints_timed + checkpoints_req AS total_checkpoints,
        checkpoints_req,
        round(100.0 * checkpoints_req /
              nullif(checkpoints_timed + checkpoints_req, 0), 2
        ) AS req_pct,
        pg_size_pretty(buffers_checkpoint * 8192::bigint) AS data_written,
        round(checkpoint_write_time::numeric /
              nullif(checkpoints_timed + checkpoints_req, 0), 2
        ) AS avg_write_ms
    FROM pg_stat_bgwriter
)
SELECT
    c.total_checkpoints,
    c.checkpoints_req,
    c.req_pct || '%' AS req_checkpoint_pct,
    w.total_wal,
    w.total_records,
    w.full_page_images,
    c.data_written AS checkpoint_data_written,
    c.avg_write_ms || ' ms' AS avg_checkpoint_write_time
FROM checkpoint_stats c, wal_rate w;
```

## Conclusion

You now have the foundational knowledge of PostgreSQL internals:
- Memory vs disk performance ([Part 1](/postgres-fundamentals-memory-vs-disk-part-1))
- How data is stored in pages ([Part 2](/postgres-fundamentals-database-storage-part-2))
- Transactions and ACID ([Part 3](/postgres-fundamentals-transactions-part-3))
- Performance trade-offs ([Part 4](/postgres-fundamentals-performance-patterns-part-4))
- Write-Ahead Logging ([Part 5](/postgres-fundamentals-wal-deep-dive-part-5))
- Monitoring tools ([Part 6](/postgres-fundamentals-monitoring-administration-part-6))

Think I missed out on a key topic? Please reach out to me.

**Previous**: [Part 5 - Write-Ahead Logging Deep Dive](/postgres-fundamentals-wal-deep-dive-part-5)

**Next**: [Understanding PostgreSQL Checkpoints](/understanding-postgres-checkpoints)

## References

- [PostgreSQL Documentation: Monitoring Stats](https://www.postgresql.org/docs/current/monitoring-stats.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL monitoring statistics documentation (opens in new tab)"}
- [PostgreSQL Documentation: pg_waldump](https://www.postgresql.org/docs/current/pgwaldump.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL pg_waldump documentation (opens in new tab)"}
- [PostgreSQL Documentation: Server Log](https://www.postgresql.org/docs/current/runtime-config-logging.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL logging configuration documentation (opens in new tab)"}
