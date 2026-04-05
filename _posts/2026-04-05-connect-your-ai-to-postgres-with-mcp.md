---
layout: post
title: "Stop Pasting Schema Into Your AI: Connect PostgreSQL Directly with MCP"
author: prateek
categories: [ AI, PostgreSQL, MCP, Developer Tools ]
tags: [ mcp, postgresql, model-context-protocol, claude, cursor, ai-tools, database, developer-productivity ]
excerpt: "AI tools can read your schema, but they're blind to your actual data. MCP gives them a live database connection so they can make real tradeoffs when building features."
description: "Learn how to connect your AI coding assistant directly to PostgreSQL using Model Context Protocol (MCP). Setup guide for @modelcontextprotocol/server-postgres, covering read-only access, zero data retention, and why live data context matters for feature design."
keywords: "mcp postgresql, model context protocol postgres, connect ai to database, claude postgres mcp, ai feature development database, ai database context, postgres mcp setup, read-only ai database access, zero data retention ai, llm database access"
---

Agentic coding tools have gotten good at reading your codebase. Claude Code will find your `schema.rb`, Cursor will pick up your Prisma schema, and most tools know how to navigate ORM-based projects well enough to understand your data model structurally.

What they can't do is reason about your actual data - and that gap matters more than most developers realize.

When you ask an AI to help design a new feature, it's working from structure alone. It knows what columns exist, not how they're used. It doesn't know that your `notifications` table has 400M rows and any fan-out design will be a problem. It doesn't know that 80% of your `users` have never set a `preferences` value, which changes how you'd model the feature. It doesn't know whether a background job is necessary or whether the data volume makes a synchronous approach fine. These are the tradeoffs that determine whether a feature ships well or causes incidents - and without live data access, the AI is guessing.

The same gap shows up in debugging. When a query is slow, the AI has to ask you to run `EXPLAIN ANALYZE` and paste the results. When it needs row counts or value distributions, it asks you to run those too. You become the relay between the AI and your database.

Model Context Protocol (MCP) is an open standard that lets AI tools connect to external systems and query them directly. With a Postgres MCP server configured, your AI can inspect live data volumes, run `EXPLAIN ANALYZE`, check value distributions, and make recommendations grounded in what's actually in your database.

## The Problem

Here's what designing a new feature looks like without MCP:

**You:** "I want to add a real-time notification feed for users."

**AI:** "How many users do you have, and roughly how many notifications per user per day?"

**You:** *(checks, pastes numbers)*

**AI:** "And what does the current `notifications` table look like? How many rows total?"

**You:** *(runs `SELECT COUNT(*)`, pastes result)*

**AI:** "What's the read pattern - are users mostly reading recent notifications or querying by type?"

**You:** *(runs a distribution query, pastes result)*

The AI knows your schema. It has no idea what's in it. Every data-dependent decision becomes a round-trip where you run the query and report back. For a non-trivial feature this happens five or ten times before you get a recommendation you can act on.

## With a Postgres MCP Server

Once connected, the same conversation looks like this:

**You:** "I want to add a real-time notification feed for users."

**AI:** *(checks `notifications` table row count, queries user and notification distribution, inspects existing indexes)*

**AI:** "You have 400M notification rows across 2.1M users, with a long tail - the top 5% of users account for 60% of rows. A naive fan-out on write will be a problem at this scale. I'd recommend a pull-based feed with a covering index on `(user_id, created_at DESC)` rather than pre-computing feeds. Here's the schema and the background job design."

No relay. The AI queries your database when it needs data and gives you a recommendation grounded in actual numbers. The same applies to debugging - understanding [query plans](/postgresql-explain-analyze-deep-dive/) becomes something the AI does directly rather than something you transcribe into the conversation.

## Setting Up @modelcontextprotocol/server-postgres

The official Postgres MCP server is `@modelcontextprotocol/server-postgres`. The source repository was archived in May 2025, but the npm package remains functional and is the most straightforward way to get started.

### Step 1: Create a Read-Only Database User

Never connect your AI tool using the same credentials your application uses. Create a dedicated user with read-only access:

```sql
-- Create a dedicated user for AI access
CREATE USER ai_readonly WITH PASSWORD 'your-secure-password';

-- Grant connect on the database
GRANT CONNECT ON DATABASE your_database TO ai_readonly;

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO ai_readonly;

-- Grant read-only access to all current tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ai_readonly;

-- Ensure future tables are also covered
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO ai_readonly;
```

This limits blast radius significantly. Worth noting: the MCP server also runs all queries inside a `READ ONLY` transaction - the README states this explicitly - so it refuses mutations at the server level regardless of user permissions. The read-only DB user is a second, independent layer of protection. Both should be in place.

### Step 2: Configure Claude Desktop or Claude Code

For **Claude Desktop**, edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "postgresql://ai_readonly:your-secure-password@localhost:5432/your_database"
      ]
    }
  }
}
```

For **Claude Code**, open `~/.claude/settings.json` and add the same `mcpServers` block:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "postgresql://ai_readonly:your-secure-password@localhost:5432/your_database"
      ]
    }
  }
}
```

Restart Claude after saving.

### Step 3: Verify the Connection

Ask Claude: "What tables are in my database?"

If it responds with your actual schema, you're connected. The server exposes two capabilities to the AI:

- **Schema inspection** - lists tables, columns, data types, constraints, and indexes
- **Query execution** - runs SQL and returns results into the conversation context

That's enough for the AI to write accurate migrations, suggest indexes based on actual table sizes, and debug slow queries by running `EXPLAIN ANALYZE` itself.

## Other MCP Database Options

The official Postgres server works well for most local setups, but depending on your database host or what you need the AI to do, there are more capable alternatives.

**[Neon MCP](https://neon.tech/docs/mcp){:target="_blank" rel="noopener noreferrer" aria-label="Neon MCP documentation (opens in new tab)"}** is worth using if you're on Neon's serverless Postgres. It's actively maintained, supports both read and write operations through proper authorization, and integrates branch management. This makes it practical for letting the AI help apply migrations against a staging branch without touching production.

**Supabase MCP** ships as part of Supabase's tooling and gives the AI access to your project's tables, schema, and Row Level Security policies. Useful if your authorization logic lives in the database.

**SQLite MCP** (`@modelcontextprotocol/server-sqlite`) is the equivalent for local SQLite databases.

For cloud-hosted databases - RDS, Azure Database, Cloud SQL - the configuration is identical to the local example above. If you're on a primary-replica setup, point the connection string at the replica rather than the primary.

## Security

### Use a Read-Only Connection

Use a dedicated database user with `SELECT`-only privileges, as shown in Step 1. The MCP server's built-in transaction protection is a safety net, not a substitute for database-level access control.

### Zero Data Retention for Sensitive Databases

If your database contains PII, financial records, or anything you'd classify as sensitive, pay attention to your AI provider's data retention policy. When the AI queries your database through MCP, the results - including actual row data - pass through the conversation context. That context may be retained by default.

For sensitive workloads:

1. **Enable zero data retention (ZDR)** through Anthropic's API if it's available on your plan. With ZDR enabled, prompts and outputs aren't stored or used for model training.

2. **Avoid querying raw PII through the AI** - have the AI write the query, review it yourself, then run it outside the AI context.

3. **Mask sensitive columns** using a view that exposes only what the AI needs:

```sql
-- Expose a masked version of the users table
CREATE VIEW public.users_masked AS
SELECT
  id,
  created_at,
  updated_at,
  role,
  subscription_plan,
  '***' AS email,
  '***' AS phone_number
FROM users;

-- Grant access to the masked view only
GRANT SELECT ON public.users_masked TO ai_readonly;
REVOKE SELECT ON public.users FROM ai_readonly;
```

The AI still has enough context to answer questions about user behavior, subscription distribution, and counts - without seeing the actual values.

## What Changes Day to Day

Once the MCP server is running, the AI can:

- Understand your full schema without you explaining it
- Suggest indexes based on actual table sizes and existing constraints
- Write migrations that account for real foreign keys and default values
- Debug slow queries by running `EXPLAIN ANALYZE` itself
- Answer data questions like "how many orders shipped last week?" directly

The manual loop of pasting schema, waiting for a clarifying question, then pasting more schema mostly disappears.

## Conclusion

The Postgres MCP server takes under ten minutes to set up, runs all queries in read-only transactions, and removes a class of manual work that compounds fast. Start with a dedicated read-only DB user, be deliberate about what data flows through the AI's context, and you have a setup that's practical and secure.

## References

- [@modelcontextprotocol/server-postgres on GitHub](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/postgres){:target="_blank" rel="noopener noreferrer" aria-label="Official postgres MCP server repository on GitHub (opens in new tab)"}
- [Model Context Protocol documentation](https://modelcontextprotocol.io){:target="_blank" rel="noopener noreferrer" aria-label="Model Context Protocol official documentation (opens in new tab)"}
- [Neon MCP documentation](https://neon.tech/docs/mcp){:target="_blank" rel="noopener noreferrer" aria-label="Neon MCP server documentation (opens in new tab)"}
- [Anthropic privacy policy and data retention](https://www.anthropic.com/legal/privacy){:target="_blank" rel="noopener noreferrer" aria-label="Anthropic privacy policy and data retention information (opens in new tab)"}
