---
layout: post
title: "PostgreSQL Fundamentals: Write-Ahead Logging Deep Dive (Part 5)"
author: prateek
categories: [ PostgreSQL, Database ]
tags: [ postgres, database-fundamentals, wal, write-ahead-logging, crash-recovery, durability ]
excerpt: "Deep dive into PostgreSQL's Write-Ahead Logging: how it works, what's inside WAL records, and how it enables both durability and crash recovery."
description: "Learn how PostgreSQL's Write-Ahead Logging (WAL) works internally, including WAL record structure, LSN tracking, crash recovery process, and how WAL enables database durability."
keywords: "postgres wal internals, write ahead logging explained, wal records postgres, lsn postgres, crash recovery database, postgres wal segments, wal replay postgres, database durability implementation"
---

In [Part 4](/postgres-fundamentals-performance-patterns-part-4), we learned about database performance trade-offs and why sequential I/O is preferred. Now let's dive deep into Write-Ahead Logging (WAL), which is PostgreSQL's solution to the durability problem.

This is Part 5 of a series on PostgreSQL internals.

## What Problem Does WAL Solve?

Remember the durability dilemma from [Part 3](/postgres-fundamentals-transactions-part-3):

```sql
UPDATE users SET balance = 500 WHERE id = 1;
COMMIT;  -- Must survive a crash from this point forward
```

The naive approach would be:
1. Modify the data page in memory
2. Write the page to disk (random I/O, slow)
3. Acknowledge COMMIT

But this has problems:
- **Slow**: Random writes to data files (10-100ms)
- **Fragile**: Partial page writes during crash
- **No batching**: Can't combine multiple updates

WAL solves all three problems.

## How WAL Works: The Big Picture

Instead of writing data pages immediately, PostgreSQL writes changes to a sequential log first:

```
1. Transaction modifies data
   ↓
2. Write change to WAL (sequential, fast)
   ↓
3. Acknowledge COMMIT (user sees success)
   ↓
4. Later: Apply changes to data files (background)
```

If PostgreSQL crashes before step 4, the WAL contains everything needed to reconstruct the changes.

### The Write-Ahead Principle

**Write-Ahead**: Changes must be logged in WAL before the data page is written to disk.

This ensures crash recovery always works.

## WAL File Structure

WAL is stored in 16 MB segment files:

```bash
# Find your data directory first
psql -c "SHOW data_directory;"

# WAL directory (use the path from above)
ls -lh /path/to/data/pg_wal/

# Example output:
-rw------- 1 postgres postgres 16M Oct 17 10:00 000000010000000000000001
-rw------- 1 postgres postgres 16M Oct 17 10:05 000000010000000000000002
-rw------- 1 postgres postgres 16M Oct 17 10:10 000000010000000000000003
```

Each file is exactly 16 MB and contains many WAL records.

### WAL Segment Naming

```
000000010000000000000001
│      ││              │
│      ││              └─ Segment number (hex)
│      │└──────────────── High 32 bits of LSN
│      └───────────────── Timeline ID
└──────────────────────── Always starts with 00000001
```

As the database runs, PostgreSQL creates new segments sequentially.

## LSN: Log Sequence Number

Every position in WAL has a unique identifier called an LSN (Log Sequence Number):

```
LSN format: 0/16A4B80
            │ │
            │ └─ Offset within segment (hex)
            └─── Segment file number (hex)
```

LSN is essentially a 64-bit offset into the infinite WAL stream.

```sql
-- Get current WAL write position
SELECT pg_current_wal_lsn();
-- Result: 0/16A4B80

-- Get current WAL insert position
SELECT pg_current_wal_insert_lsn();
-- Result: 0/16A4C00
```

LSNs increase monotonically. A higher LSN means a later point in time.

## WAL Record Structure

Each change to the database generates a WAL record:

```
WAL Record:
┌─────────────────────────────┐
│ Record Header               │  ← Metadata (24 bytes)
│  - Total length             │
│  - Transaction ID           │
│  - Previous record pointer  │
│  - CRC checksum             │
├─────────────────────────────┤
│ Resource Manager Info       │  ← What kind of change?
│  - Heap, Btree, Sequence... │
├─────────────────────────────┤
│ Block References            │  ← Which pages changed?
│  - Page number              │
│  - Fork (main/FSM/VM)       │
├─────────────────────────────┤
│ Main Data                   │  ← The actual change
│  - Old values (for undo)    │
│  - New values (for redo)    │
└─────────────────────────────┘
```

### Example WAL Record

When you run:

```sql
UPDATE users SET balance = 500 WHERE id = 1;
```

PostgreSQL generates a WAL record like:

```
Resource Manager: Heap (table data)
Block Reference: Relation 16385, Block 0
Old Tuple: (id=1, balance=400, name='Alice')
New Tuple: (id=1, balance=500, name='Alice')
Transaction ID: 1234
LSN: 0/16A4B80
```

This record contains everything needed to:
- **Redo**: Apply the change (crash recovery)
- **Undo**: Reverse the change (rollback, though PostgreSQL uses MVCC instead)

## Types of WAL Records

Different operations generate different WAL record types:

### Heap Records (Table Data)

```sql
INSERT INTO users VALUES (1, 'Alice');
-- WAL: HEAP_INSERT, block 0, tuple data [1, 'Alice']

UPDATE users SET name = 'Alice Smith' WHERE id = 1;
-- WAL: HEAP_UPDATE, block 0, old tuple, new tuple

DELETE FROM users WHERE id = 1;
-- WAL: HEAP_DELETE, block 0, tuple offset
```

### Btree Records (Index Data)

```sql
CREATE INDEX idx_users_email ON users(email);
-- WAL: BTREE_INSERT for each index entry

UPDATE users SET email = 'newemail@example.com' WHERE id = 1;
-- WAL: BTREE_DELETE (old entry), BTREE_INSERT (new entry)
```

### Transaction Records

```sql
COMMIT;
-- WAL: TRANSACTION_COMMIT, transaction ID, timestamp

ROLLBACK;
-- WAL: TRANSACTION_ABORT, transaction ID
```

### Checkpoint Records

```sql
-- Checkpoint happens
-- WAL: CHECKPOINT, LSN, redo point, next XID, database state
```

## How Crash Recovery Works

When PostgreSQL starts after a crash:

### Step 1: Read Last Checkpoint

PostgreSQL reads `pg_control` to find the last completed checkpoint:

```sql
-- View control file info (requires pg_controldata tool)
-- $ pg_controldata $PGDATA

-- Shows:
Latest checkpoint location: 0/1500000
Prior checkpoint location:  0/1000000
```

### Step 2: Find Redo Point

The checkpoint record contains the "redo point", which is the LSN where recovery should start:

```
Checkpoint at LSN 0/1500000
Redo point: 0/1480000

This means:
- All changes before 0/1480000 are on disk
- Changes from 0/1480000 to crash point need replay
```

### Step 3: Replay WAL

PostgreSQL reads WAL records from the redo point forward:

```
Read WAL record at 0/1480000:
  HEAP_UPDATE on block 5
  Apply: Load page 5, apply update

Read WAL record at 0/1480100:
  BTREE_INSERT on index block 10
  Apply: Load page 10, insert index entry

... continue until end of WAL ...
```

Each record is applied to reconstruct the database state.

### Step 4: Reach Consistent State

When replay completes, the database is consistent up to the crash point. All committed transactions are present, all uncommitted transactions are absent (because COMMIT records weren't written).

## Handling Corrupted Pages

Crash recovery through WAL replay sounds straightforward, but there's a subtle problem: what if the data pages themselves become corrupted during a crash? PostgreSQL needs a way to handle partial writes that leave pages in an inconsistent state.


### The Problem

```
PostgreSQL writes 8 KB page to disk
Crash happens after 4 KB written
Page is corrupted (half old, half new)
```

Even with WAL, you can't replay changes onto a corrupted page.

### The Solution: Full Page Writes

After each checkpoint, the first modification to a page writes the entire page to WAL:

```sql
-- First update to a page after checkpoint
UPDATE users SET balance = 500 WHERE id = 1;

-- WAL record contains:
-- 1. Full 8 KB page image (FPW)
-- 2. The change record
```

Subsequent updates to the same page only log the change (until next checkpoint).

This ensures:
- If page is partially written during crash, WAL contains a good copy
- Recovery can restore the page from WAL, then apply changes

```sql
-- Check FPW setting
SHOW wal_log_hints;
-- or
SHOW full_page_writes;  -- Should be 'on'
```

Disabling full page writes improves performance but risks data corruption during crashes.

## Managing WAL in Memory

WAL records need to reach disk to guarantee durability, but writing to disk on every change would be too slow. PostgreSQL uses an in-memory buffer to batch WAL writes efficiently.

WAL records aren't written directly to disk. They go through WAL buffers:

```
Transaction generates WAL record
    ↓
WAL buffer (in memory, 16 MB)
    ↓
fsync to disk (when needed)
```

### When WAL is Flushed

WAL is flushed to disk when:

1. **Transaction commits**:
   ```sql
   COMMIT;  -- Forces fsync of WAL up to this point
   ```

2. **WAL buffer fills**:
   ```sql
   SHOW wal_buffers;  -- Default: 16 MB
   -- When buffer is full, flush to disk
   ```

3. **Background writer**:
   ```
   Every 200ms, flush any unwritten WAL
   ```

```sql
-- Check WAL flush stats
SELECT * FROM pg_stat_wal;

-- Key metrics:
-- wal_write: Number of times WAL was written
-- wal_sync:  Number of times WAL was synced (fsync)
-- wal_bytes: Total bytes written to WAL
```

## Beyond Crash Recovery

While WAL's primary purpose is crash recovery, it also enables several advanced PostgreSQL features. By preserving a complete history of changes, WAL becomes the foundation for backup strategies and replication.

For point-in-time recovery and replication, you can archive completed WAL segments:

```sql
-- Enable archiving in postgresql.conf
archive_mode = on
archive_command = 'cp %p /mnt/wal_archive/%f'

-- PostgreSQL will archive each 16 MB segment when full
```

Archived WAL lets you:
- Restore to any point in time
- Set up streaming replication
- Build read replicas

## WAL Generation Rate

Different workloads generate WAL at different rates:

```sql
-- Read-only query (no WAL generated)
SELECT * FROM users;

-- Small insert (~100 bytes of WAL)
INSERT INTO users VALUES (1, 'Alice');

-- Large update with indexes (~1 KB of WAL)
UPDATE users SET email = 'newemail@example.com' WHERE id = 1;

-- Create index (MB of WAL)
CREATE INDEX idx_users_email ON users(email);
```

### Monitoring WAL Generation

```sql
-- Current WAL position
SELECT pg_current_wal_lsn();
-- Result: 0/16A4B80

-- Wait 1 minute, check again
SELECT pg_current_wal_lsn();
-- Result: 0/18C7000

-- Calculate WAL generated
SELECT pg_size_pretty(
    pg_wal_lsn_diff('0/18C7000', '0/16A4B80')
);
-- Result: 2.1 MB generated in 1 minute
```

High WAL generation rate = more frequent checkpoints.

## WAL and Performance

Understanding how WAL affects performance helps you make informed trade-offs between durability and speed. WAL introduces overhead in multiple areas, from write latency to disk space usage. Let's look at some of the ways:

### 1. Write Performance

Every transaction writes to WAL:
- Fast (sequential I/O)
- But still I/O (slower than memory)

```sql
-- Synchronous commit (default, safe)
SET synchronous_commit = on;
-- Every COMMIT waits for WAL fsync

-- Asynchronous commit (faster, less safe)
SET synchronous_commit = off;
-- COMMIT returns immediately, fsync happens later
-- Risk: Lose last ~200ms of commits if crash
```

### 2. Disk Space

WAL segments accumulate:
- Each 16 MB
- Kept until checkpoint completes
- Then recycled or archived

```sql
-- Check WAL directory size
SELECT pg_size_pretty(
    pg_stat_file('pg_wal', true).size
);
```

### 3. Checkpoint Frequency

More WAL generation → more frequent checkpoints:

```sql
-- If you generate 1 GB WAL per minute
-- And max_wal_size = 1GB
-- Checkpoints happen every minute (frequent!)

-- Solution: Increase max_wal_size
max_wal_size = 4GB
```

With the recommended solution, can you guess the trade-offs now? If you're not sure, make sure to read the previous parts and revisit this post.

## What's Next?

Now that you understand how WAL works internally, we can explore the monitoring and administration tools PostgreSQL provides. In [Part 6](/postgres-fundamentals-monitoring-administration-part-6), we'll learn about system views, log analysis, and how to use `pg_waldump` to inspect WAL records.

**Previous**: [Part 4 - Performance Patterns and Trade-offs](/postgres-fundamentals-performance-patterns-part-4)

## References

- [PostgreSQL Documentation: Write-Ahead Logging](https://www.postgresql.org/docs/current/wal-intro.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL WAL introduction documentation (opens in new tab)"}
- [PostgreSQL Documentation: WAL Internals](https://www.postgresql.org/docs/current/wal-internals.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL WAL internals documentation (opens in new tab)"}
- [PostgreSQL Documentation: WAL Configuration](https://www.postgresql.org/docs/current/wal-configuration.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL WAL configuration documentation (opens in new tab)"}
