---
layout: post
title: "PostgreSQL Fundamentals: How Databases Store Data (Part 2)"
author: prateek
categories: [ PostgreSQL, Database ]
tags: [ postgres, database-fundamentals, storage, pages, indexes, tables ]
excerpt: "Learn how PostgreSQL organizes data on disk using pages, tables, and indexes. Understand the building blocks of database storage."
description: "Explore PostgreSQL's storage architecture including pages, heap files, indexes, and TOAST. Learn how databases organize data for efficient retrieval and storage."
keywords: "postgres storage architecture, database pages, heap files postgres, postgres indexes, TOAST storage, postgres table organization, database storage fundamentals"
---

In [Part 1](/postgres-fundamentals-memory-vs-disk-part-1), we learned why memory is fast and disk is slow. Now let's explore how PostgreSQL actually organizes data on disk.

This is Part 2 of a series on PostgreSQL internals.

## The Page: PostgreSQL's Storage Unit

PostgreSQL doesn't read or write individual rows. Instead, it works with fixed-size blocks called **pages** (also called blocks).

```
Default page size: 8 KB (8,192 bytes)
```

Think of pages as the atomic unit of disk I/O. When PostgreSQL needs one row, it reads the entire 8 KB page containing that row.

You can verify this behavior:

```sql
-- Create a simple table
CREATE TABLE page_test (id INT, data TEXT);

-- Insert one tiny row
INSERT INTO page_test VALUES (1, 'test');

-- Get the physical file path
SELECT pg_relation_filepath('page_test');
-- Result: base/16384/2861815 (example output)

-- Find your PostgreSQL data directory
SHOW data_directory;
-- Result: /opt/homebrew/var/postgresql@14
```

Now check the actual file size on disk:

```bash
# Combine data_directory + filepath from above
ls -lh /opt/homebrew/var/postgresql@14/base/16384/2861815

# Output:
# -rw-------@ 1 prateek  admin  8192 20 Oct 10:29 /opt/homebrew/var/postgresql@14/base/16384/2861815

# The file is exactly 8192 bytes (8 KB), even with just one tiny row!
```

PostgreSQL allocated an entire 8 KB page for a table with one small row. This is the minimum storage unit.

### Why Pages?

1. **Disk I/O efficiency**: Reading 8 KB costs nearly the same as reading 512 bytes
2. **Memory management**: Easier to manage fixed-size chunks
3. **Caching**: The buffer cache works in page-sized units

```sql
-- Check your page size
SHOW block_size;
-- Result: 8192 (bytes)
```

### What's Inside a Page?

Each page has a structure:

```
┌─────────────────────────────┐
│     Page Header (24 bytes)  │  ← Metadata
├─────────────────────────────┤
│     Item IDs (4 bytes each) │  ← Pointers to rows
├─────────────────────────────┤
│                             │
│     Free Space              │
│                             │
├─────────────────────────────┤
│     Tuple Data (rows)       │  ← Actual data
├─────────────────────────────┤
│     Special Space           │  ← Index-specific data
└─────────────────────────────┘
```

The page header contains:
- Checksum (for data corruption detection)
- Free space pointers
- Transaction visibility information

## Tables: Heap Files

When you create a table in PostgreSQL, it's stored as a **heap file**, which is a collection of pages with no particular order.

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email TEXT,
    name TEXT
);

-- This creates a heap file on disk
-- Location: /var/lib/postgresql/data/base/{database_oid}/{table_oid}
```

### Finding Table Files

```sql
-- Get the file path for a table
SELECT pg_relation_filepath('users');
-- Result: base/16384/16385

-- Check the actual file size
SELECT pg_size_pretty(pg_relation_size('users'));
-- Result: 8192 bytes (one page for empty table)
```

### How Rows Are Stored

Rows (called **tuples** in PostgreSQL) are stored in pages:

```sql
-- Insert some data
INSERT INTO users (email, name) VALUES
    ('alice@example.com', 'Alice'),
    ('bob@example.com', 'Bob'),
    ('charlie@example.com', 'Charlie');

-- These rows are stored in pages
-- If rows fit in one page, they're all in the same 8 KB block
```

PostgreSQL stores rows in insertion order within pages, but pages themselves aren't ordered. This is why it's called a "heap."

### Reading Data: Sequential Scan

When you query without an index:

```sql
EXPLAIN ANALYZE SELECT * FROM users WHERE name = 'Alice';

-- Result shows: Seq Scan on users
-- This means: Read every page, check every row
```

A sequential scan reads pages in order (fast sequential I/O), but must examine every row.

## Indexes: Finding Data Fast

Indexes solve the "find one row in millions" problem.

### What Is an Index?

An index is a separate data structure that maps values to page locations:

```sql
CREATE INDEX idx_users_email ON users(email);

-- This creates a B-tree structure:
-- Index: email → (page_number, item_id)
```

You can see how the index stores pointers to heap pages:

```sql
-- Install pageinspect extension (run once)
CREATE EXTENSION IF NOT EXISTS pageinspect;

-- Insert some test data
INSERT INTO users (email, name) VALUES
    ('alice@example.com', 'Alice'),
    ('bob@example.com', 'Bob'),
    ('charlie@example.com', 'Charlie');

-- View index entries with their heap pointers
SELECT * FROM bt_page_items(get_raw_page('idx_users_email', 1))
LIMIT 3;

-- Output shows:
--  itemoffset | ctid  | itemlen | nulls | vars |          data
-- ------------+-------+---------+-------+------+-------------------------
--           1 | (0,1) |      24 | f     | t    | 1d 61 6c 69 63 65 40...
--           2 | (0,2) |      22 | f     | t    | 1b 62 6f 62 40 65 78...
--           3 | (0,3) |      26 | f     | t    | 1f 63 68 61 72 6c 69...

-- The ctid column shows (page_number, item_id)
-- ctid (0,1) means: page 0, item 1 in the heap table
```

The `ctid` (tuple identifier) is how the index points to the actual row in the heap table.

### B-tree Index Structure

PostgreSQL's default index type is B-tree (balanced tree):

```
                  [m-z]                    ← Root: Split point between a-l and m-z
                 /     \
        [a-f]          [m-z]               ← Internal nodes: Further subdivisions
       /   |   \       /    \
   [a-b][c-d][e-f] [m-p][q-z]              ← Leaf nodes: Ranges of actual values
     ↓    ↓    ↓     ↓    ↓
   pages with actual row locations (ctid pointers)
```

How this works for an email index:
- **Root node**: Decides if email starts with a-l (go left) or m-z (go right)
- **Internal nodes**: Further narrow the range (a-f, g-l, etc.)
- **Leaf nodes**: Contain actual email values and their heap page pointers

Example: To find 'charlie@example.com':
1. Root: 'c' is in a-l range → go left
2. Internal: 'c' is in a-f range → go left
3. Leaf: Find 'charlie@example.com' → get ctid (0,3)
4. Read heap page 0, item 3

Each level narrows the search. For a million rows:
- Sequential scan: Read ~122,000 pages (1M rows × 8 bytes ÷ 8 KB per page)
- B-tree index: Read ~4 pages (log₂(1M) ≈ 4 levels)

### Index Lookup Example

```sql
-- With index
EXPLAIN ANALYZE SELECT * FROM users WHERE email = 'alice@example.com';

-- Result shows: Index Scan using idx_users_email
-- PostgreSQL:
-- 1. Searches B-tree for 'alice@example.com' (3-4 page reads)
-- 2. Gets page location from index
-- 3. Reads that specific page (1 page read)
-- Total: 4-5 pages instead of ALL pages
```

### Indexes Use Pages Too

Indexes are also stored in pages:

```sql
-- Check index size
SELECT pg_size_pretty(pg_relation_size('idx_users_email'));
-- Result: 16 kB (two pages for a small index)
```

The larger your table, the larger your indexes.

So far we've talked about 8 KB pages fitting multiple rows. But what happens when a single value is larger than an entire page?

## TOAST: Storing Large Values


PostgreSQL pages are 8 KB. What happens when you store a 100 KB text field?

TOAST (The Oversized-Attribute Storage Technique) handles this:

```sql
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    content TEXT  -- Could be megabytes
);

-- Large values are stored in a separate TOAST table
-- The main table stores a pointer
```

### How TOAST Works

```
Main Table Page:
┌────────────────────┐
│ id: 1              │
│ content: <pointer> │ ─────┐
└────────────────────┘      │
                            ▼
                     TOAST Table:
                     ┌──────────────┐
                     │ chunk 1 (2KB)│
                     │ chunk 2 (2KB)│
                     │ chunk 3 (2KB)│
                     │ ...          │
                     └──────────────┘
```

Large values are:
1. Compressed (if beneficial)
2. Split into 2 KB chunks
3. Stored in a separate TOAST table

```sql
-- Check if table has TOAST
SELECT relname, reltoastrelid
FROM pg_class
WHERE relname = 'documents';
```

## Visibility and MVCC

PostgreSQL uses MVCC (Multi-Version Concurrency Control). Each tuple stores transaction visibility information:

```sql
-- When you UPDATE a row
UPDATE users SET name = 'Alice Smith' WHERE id = 1;

-- PostgreSQL doesn't modify the old row
-- It creates a NEW version and marks the old one as deleted
```

Each tuple header contains:
- `xmin`: Transaction ID that created this version
- `xmax`: Transaction ID that deleted/updated this version

```
Page contents after UPDATE:
┌─────────────────────────────┐
│ Old tuple: xmin=100, xmax=101 │ ← Marked as deleted
│ New tuple: xmin=101, xmax=0   │ ← Current version
└─────────────────────────────┘
```

You might have heard of vacuuming, or seen your DB instance going under auto-vacuum process. This is precisely why `VACUUM` is needed to clean up old tuple versions.

## Putting It Together

When you run a query:

```sql
SELECT * FROM users WHERE email = 'alice@example.com';
```

Here's what happens:

1. **Index lookup**: PostgreSQL scans the `idx_users_email` B-tree (reads 3-4 index pages)
2. **Get tuple location**: Index returns page number and item ID
3. **Check buffer cache**: Is this page in `shared_buffers`?
   - If yes: Read from memory (fast)
   - If no: Read from disk (slow), cache it
4. **Check visibility**: Is this tuple version visible to our transaction?
5. **Return result**: Send row back to client

## Practical Example: Watching Page Growth

```sql
-- Create table and check size
CREATE TABLE test_pages (id INT, data TEXT);
SELECT pg_size_pretty(pg_relation_size('test_pages'));
-- Result: 0 bytes (no pages allocated yet)

-- Insert enough data to fill one page
INSERT INTO test_pages
SELECT generate_series(1, 100), 'test data';

SELECT pg_size_pretty(pg_relation_size('test_pages'));
-- Result: 8192 bytes (one page)

-- Insert more data
INSERT INTO test_pages
SELECT generate_series(1, 1000), repeat('x', 100);

SELECT pg_size_pretty(pg_relation_size('test_pages'));
-- Result: 122 kB (15 pages)
```

Each page is allocated as needed.

## What's Next?

Now that you understand how PostgreSQL stores data in pages and organizes tables and indexes, we can explore transactions. In [Part 3](/postgres-fundamentals-transactions-part-3), we'll learn about ACID properties and why databases need mechanisms like Write-Ahead Logging to ensure data durability.

**Previous**: [Part 1 - Memory vs Disk Performance](/postgres-fundamentals-memory-vs-disk-part-1)

## References

- [PostgreSQL Documentation: Database Page Layout](https://www.postgresql.org/docs/current/storage-page-layout.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL page layout documentation (opens in new tab)"}
- [PostgreSQL Documentation: TOAST](https://www.postgresql.org/docs/current/storage-toast.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL TOAST documentation (opens in new tab)"}
- [PostgreSQL Documentation: Database File Layout](https://www.postgresql.org/docs/current/storage-file-layout.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL file layout documentation (opens in new tab)"}
