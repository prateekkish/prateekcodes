---
layout: post
title: "PostgreSQL Fundamentals: Transactions and ACID (Part 3)"
author: prateek
categories: [ PostgreSQL, Database ]
tags: [ postgres, database-fundamentals, transactions, acid, isolation, consistency ]
excerpt: "Learn what database transactions are, why ACID properties matter, and how PostgreSQL ensures your data stays consistent even when things go wrong."
description: "Understand database transactions, ACID properties, isolation levels, and why PostgreSQL needs mechanisms like Write-Ahead Logging to guarantee data durability and consistency."
keywords: "postgres transactions, acid properties database, database consistency, transaction isolation levels, postgres mvcc, atomicity consistency isolation durability, postgres transaction management"
---

In [Part 2](/postgres-fundamentals-database-storage-part-2), we learned how PostgreSQL stores data in pages. Now let's explore transactions, which are the mechanism that keeps your data consistent even when multiple users access it simultaneously or the system crashes.

This is Part 3 of a series on PostgreSQL internals.

## What Is a Transaction?

A transaction is a sequence of database operations that are treated as a single unit of work. Either all operations succeed, or none do.

```sql
-- Start a transaction
BEGIN;

-- Multiple operations
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;

-- Commit: Make changes permanent
COMMIT;
```

If anything goes wrong between `BEGIN` and `COMMIT`, you can `ROLLBACK` to undo everything:

```sql
BEGIN;

UPDATE accounts SET balance = balance - 100 WHERE id = 1;
-- Oops, error or change your mind
ROLLBACK;  -- First UPDATE is undone
```

## The ACID Properties

ACID is an acronym for the four properties that guarantee database transactions are processed reliably:

### 1. Atomicity: All or Nothing

A transaction either completes fully or has no effect at all.

```sql
BEGIN;

-- Transfer $100 from Alice to Bob
UPDATE accounts SET balance = balance - 100 WHERE user_id = 1;  -- Alice
UPDATE accounts SET balance = balance + 100 WHERE user_id = 2;  -- Bob

COMMIT;
```

If the database crashes after the first UPDATE but before COMMIT:
- Both updates are undone
- No money is lost or created
- The system is as if the transaction never happened

This is **atomicity**. The transaction is atomic (indivisible).

### 2. Consistency: Rules Are Always Enforced

The database moves from one valid state to another valid state. Constraints are always respected.

```sql
CREATE TABLE accounts (
    user_id INT PRIMARY KEY,
    balance DECIMAL CHECK (balance >= 0)  -- Constraint: no negative balances
);

BEGIN;
UPDATE accounts SET balance = balance - 200 WHERE user_id = 1;
-- If this would make balance negative, transaction fails
COMMIT;
-- ERROR: new row violates check constraint "accounts_balance_check"
```

The database prevents you from violating constraints. This is **consistency**.

### 3. Isolation: Transactions Don't Interfere

When multiple transactions run concurrently, each transaction sees a consistent snapshot of the database, as if it's running alone.

```sql
-- Transaction 1
BEGIN;
SELECT balance FROM accounts WHERE user_id = 1;  -- Returns 500
-- ... doing some work ...

-- Transaction 2 (running at the same time)
BEGIN;
UPDATE accounts SET balance = 1000 WHERE user_id = 1;
COMMIT;

-- Back to Transaction 1
SELECT balance FROM accounts WHERE user_id = 1;  -- Still returns 500!
COMMIT;
```

Transaction 1 sees a consistent view even though Transaction 2 modified the data. This is **isolation**.

PostgreSQL provides multiple isolation levels:

```sql
-- Set isolation level
BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;
-- or
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
-- or
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
```

Each level provides different guarantees about what changes from other transactions you can see.

### 4. Durability: Committed Data Survives

Once a transaction commits, the changes are permanent, even if the system crashes immediately after.

```sql
BEGIN;
INSERT INTO orders (user_id, total) VALUES (1, 99.99);
COMMIT;  -- From this point, the data MUST survive

-- Even if PostgreSQL crashes here, the order exists when it restarts
```

_This is **durability**, which is the hardest property to implement and the reason Write-Ahead Logging exists._

## How PostgreSQL Implements Durability

When you commit a transaction, PostgreSQL must ensure the data survives a crash. But writing to disk is slow (remember [Part 1](/postgres-fundamentals-memory-vs-disk-part-1)?).

PostgreSQL's solution: **Write-Ahead Logging (WAL)**

### The Durability Problem

```sql
COMMIT;  -- User expects this to be permanent

-- But writing all changed pages to disk takes time:
-- - Multiple random disk writes
-- - Could be many pages scattered across disk
-- - Takes 10-100ms

-- What if the system crashes during these writes?
```

### The WAL Solution

Instead of writing data pages directly:

1. **Write changes to WAL** (sequential, fast)
2. **Acknowledge COMMIT to user**
3. **Write data pages later** (in background)

```
Transaction commits:
    ↓
Write to WAL (sequential, fast: 1-2ms)
    ↓
COMMIT acknowledged ✅
    ↓
Later: Write dirty pages to data files
```

The WAL is a sequential log of all changes. Sequential writes are fast (see [Part 1](/postgres-fundamentals-memory-vs-disk-part-1)).

### WAL Example

```sql
BEGIN;
UPDATE accounts SET balance = 500 WHERE user_id = 1;
COMMIT;

-- Behind the scenes:
-- 1. Change recorded in WAL:
--    "Transaction 12345: Change page 42, offset 10, old value 400, new value 500"
-- 2. WAL flushed to disk (fsync)
-- 3. COMMIT returns to user
-- 4. Dirty page stays in memory (shared_buffers)
-- 5. Background writer eventually writes page 42 to data file
```

If PostgreSQL crashes after step 3:
- WAL has the change recorded
- On restart, PostgreSQL replays the WAL
- The change is reconstructed
- Durability preserved ✌🏽

## Isolation Levels in Detail

PostgreSQL offers four isolation levels, each with different trade-offs. Each level provides different guarantees about what changes from other transactions you can see. For a complete reference, see the [PostgreSQL Documentation: Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL transaction isolation documentation (opens in new tab)"}.

### Read Uncommitted (Not Really Implemented)

```sql
BEGIN TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
```

In PostgreSQL, this behaves the same as Read Committed. PostgreSQL doesn't allow reading uncommitted data.

### Read Committed (Default)

```sql
BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

Each query sees data committed before the query started:

```sql
-- Transaction 1
BEGIN;
SELECT COUNT(*) FROM orders;  -- Returns 100

-- Transaction 2 (different session)
BEGIN;
INSERT INTO orders VALUES (...);
COMMIT;

-- Back to Transaction 1
SELECT COUNT(*) FROM orders;  -- Returns 101 (sees new commit)
COMMIT;
```

You might see different data in each query within the same transaction.

### Repeatable Read

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
```

Sees a consistent snapshot of data from when the transaction started:

```sql
-- Transaction 1
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT COUNT(*) FROM orders;  -- Returns 100

-- Transaction 2
BEGIN;
INSERT INTO orders VALUES (...);
COMMIT;

-- Back to Transaction 1
SELECT COUNT(*) FROM orders;  -- Still returns 100 (snapshot isolation)
COMMIT;
```

The entire transaction sees data as it was at the start.

### Serializable

```sql
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
```

Strongest isolation. Guarantees transactions behave as if executed one at a time.

If concurrent transactions would produce inconsistent results, PostgreSQL aborts one:

```sql
-- Transaction 1: Serializable
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT SUM(balance) FROM accounts;  -- 1000

-- Transaction 2: Serializable
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
INSERT INTO accounts (user_id, balance) VALUES (3, 100);
COMMIT;

-- Back to Transaction 1
INSERT INTO audit_log (total) VALUES (1000);  -- Uses old sum
COMMIT;
-- ERROR: could not serialize access due to read/write dependencies
```

PostgreSQL detects that Transaction 1's view is stale and aborts it.

## MVCC: How PostgreSQL Implements Isolation

PostgreSQL uses Multi-Version Concurrency Control (MVCC). Instead of locking, it keeps multiple versions of rows.

```sql
-- Original data
SELECT * FROM accounts WHERE user_id = 1;
-- balance: 500, xmin: 100, xmax: 0

-- Transaction 1 updates
BEGIN;  -- Transaction ID: 101
UPDATE accounts SET balance = 600 WHERE user_id = 1;
COMMIT;

-- Physical storage now has TWO versions:
-- Old: balance 500, xmin: 100, xmax: 101
-- New: balance 600, xmin: 101, xmax: 0
```

When you query, PostgreSQL uses transaction IDs to determine which version is visible:

- Transactions started before 101: See balance 500
- Transactions started after 101: See balance 600

No locks needed for reads and writes on different versions.

## Practical Example: Transaction Behavior

```sql
-- Create test table
CREATE TABLE transfers (
    id SERIAL PRIMARY KEY,
    from_account INT,
    to_account INT,
    amount DECIMAL
);

-- Transaction that demonstrates atomicity
BEGIN;
INSERT INTO transfers (from_account, to_account, amount) VALUES (1, 2, 100);
SELECT * FROM transfers WHERE from_account = 1;  -- Shows the new row
ROLLBACK;
SELECT * FROM transfers WHERE from_account = 1;  -- Row is gone (atomicity)

-- Transaction that demonstrates isolation
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT COUNT(*) FROM transfers;  -- Let's say it's 0

-- In another session, insert a row and commit
-- (Open another terminal)
-- BEGIN; INSERT INTO transfers VALUES (DEFAULT, 1, 2, 50); COMMIT;

-- Back in first session
SELECT COUNT(*) FROM transfers;  -- Still 0 (isolation)
COMMIT;
SELECT COUNT(*) FROM transfers;  -- Now 1 (after commit, you see changes)
```

## What's Next?

Now that you understand transactions and why durability requires persisting data to disk, we can explore the performance implications of different I/O patterns. In [Part 4](/postgres-fundamentals-performance-patterns-part-4), we'll learn about write amplification, I/O batching, and why PostgreSQL makes the design choices it does.

**Previous**: [Part 2 - How Databases Store Data](/postgres-fundamentals-database-storage-part-2)

## References

- [PostgreSQL Documentation: Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL transaction isolation documentation (opens in new tab)"}
- [PostgreSQL Documentation: MVCC](https://www.postgresql.org/docs/current/mvcc-intro.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL MVCC documentation (opens in new tab)"}
- [PostgreSQL Documentation: Reliability and Write-Ahead Logging](https://www.postgresql.org/docs/current/wal-intro.html){:target="_blank" rel="noopener noreferrer" aria-label="PostgreSQL WAL documentation (opens in new tab)"}
