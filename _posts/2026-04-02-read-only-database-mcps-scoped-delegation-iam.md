---
layout: post
title: "Read-only database MCPs as a scoped-delegation pattern: applying IAM primitives to AI agents"
author: prateek
categories: [ AI, MCP, Security, Identity ]
tags: [ mcp, ai-agents, iam, rbac, scoped-delegation, authorization, audit, least-privilege ]
excerpt: "AI agents are non-human principals at scale. The pattern that holds up for giving them access to production data is one IAM engineers already know: scoped delegation through a narrow, audited, RBAC-governed capability surface."
description: "How IAM primitives (scoped delegation, RBAC, capability surfaces, audit) translate to AI agent access patterns. Why read-only MCP servers, designed correctly, are an instance of scoped delegation rather than a new problem."
keywords: "mcp authorization, ai agent rbac, scoped delegation pattern, ai agent iam, model context protocol security, read-only mcp server, agent authorization model, capability surface ai, non-human principal authorization, mcp least privilege"
---

AI agents are useful in proportion to the context they can read. That is the productive observation. The unproductive one, which follows about thirty seconds later, is that giving an agent the context it wants usually means giving it broad access to production data. Most teams reach for one of three approaches: hand the agent a database credential, filter the agent's behavior at the prompt layer ("don't query the customers table unless asked"), or trust the agent because the model is good now. The first reproduces every shared-credential failure of the last twenty years. The second is policy enforcement at the wrong layer, since it depends on the thing being constrained to cooperate with the constraint. The third is not a policy.

The pattern that holds up is one identity engineers already recognize: scoped delegation through a narrow, audited, [RBAC](https://csrc.nist.gov/projects/role-based-access-control){:target="_blank" rel="noopener noreferrer"}-governed capability surface. The [Model Context Protocol](https://modelcontextprotocol.io){:target="_blank" rel="noopener noreferrer"} (the emerging interface for exposing tools to LLM agents) provides a natural place to implement that pattern, and a [read-only database MCP server](/connect-your-ai-to-postgres-with-mcp){:target="_blank"}, designed correctly, is an instance of it. This post is about the principles underneath it.

## Introducing: scoped delegation pattern

In IAM terms, an AI agent is a non-human principal. That framing is doing more work than it looks. Principals need identities, capabilities they are authorized to invoke, and audit trails attached to each invocation. The model is not new; it is the model used for every service account, every workload identity, every cross-account role a backend service has held for the last decade. What changes with AI agents is the cardinality and the unpredictability: there are more of them, they are spun up casually, and their behavior is governed by a probabilistic policy nobody fully controls.

An MCP server is a policy-enforcement point. The policy decision is encoded in the surface of the server: which tools exist, what each tool accepts as input, what each tool is permitted to return, and which principals are allowed to invoke which tools. A backend service calling a database through a narrow IAM role does not hold credentials for the database; it holds authorization to invoke a specific set of capabilities. The agent's relationship to the MCP server is structurally identical. The agent never holds database credentials. It holds an identity and an authorization to call tools.

That distinction is the entire point. If the agent held credentials, the surface of "what the agent can do" would be "anything the credentials grant." With a capability surface in front of it, the surface of "what the agent can do" is the union of behaviors the tools permit. Those two surfaces look adjacent on a diagram. In production, they are an order of magnitude apart in blast radius.

The MCP server, in this framing, is not a convenience layer for the agent. It is the policy-enforcement point in an authorization model that already exists. Building one well is the job of porting that authorization model into agent-shaped terms.

## Why RBAC is the right starting model

There is a temptation, when designing the authorization model for an agent, to reach immediately for [attribute-based authorization](https://csrc.nist.gov/projects/attribute-based-access-control){:target="_blank" rel="noopener noreferrer"}. Each tool call gets a policy decision computed from request context, agent attributes, target object attributes, environmental conditions. The model is expressive, the model is the future, and the model is wrong for the first version.

Start with RBAC for agents the same way you would for humans. Define a small set of agent roles, each describing a coherent job: `read_only_analyst`, `customer_support_lookup`, `engineering_debug`. Bind each role to a fixed set of MCP tools. Bind each tool to a fixed set of database objects: which tables it touches, which columns it returns, which row-level predicates it always applies. The tool itself is a parameterized query, not a raw SQL interface, and the role grants the right to invoke it.

That last constraint is load-bearing. A `run_sql(query)` tool collapses the entire authorization model down to "agent can do anything the database role can do." Every refinement above the database role becomes window dressing. The capability surface is supposed to be narrower than what the underlying credentials permit. A raw-query tool throws that away for flexibility the agent does not actually need.

The shape of a well-designed tool, in pseudocode:

```
tool "lookup_customer_orders":
  binds_to_role: customer_support_lookup
  params:
    customer_id: uuid (required)
    limit: int (max=50, default=10)
  query: |
    SELECT order_id, status, created_at, total_cents
    FROM orders
    WHERE customer_id = :customer_id
      AND created_at >= now() - interval '90 days'
    ORDER BY created_at DESC
    LIMIT :limit
  rate_limit: 100/hour per principal
  audit: full
```

RBAC for agents pays for itself on the human side of the system. Reviews are tractable: the question reduces to "which tools is this role bound to, and is that set still appropriate." Audits are tractable: every invocation maps back to a role, and every role maps back to a fixed surface. Onboarding a new agent reduces to picking a role. Incident response reduces to revoking one.

ABAC and [ReBAC](https://research.google/pubs/pub48190/){:target="_blank" rel="noopener noreferrer"} are escape hatches for the 5% of cases RBAC genuinely cannot express: data sensitive because of its content rather than its location, relationships that bleed across object types, decisions that depend on request-time context. Reach for them when needed. Most teams reach too early, mistake expressive power for clarity, and end up with a policy graph nobody can answer questions about three months later.

## What "read-only" actually has to mean

"Read-only" is a phrase that does not survive contact with a real authorization model. Most teams hear it and think "no INSERT, no UPDATE, no DELETE." Necessary, not sufficient. Read-only at the IAM layer means a stricter set of things, all of which translate familiar IAM concerns into agent terms.

No raw query interface. Every tool is a parameterized query with a fixed shape. The agent supplies values for the parameters, not the query itself. This is least privilege expressed at the capability level: the agent gets the queries it has been authorized for, not "the database, in read-only mode."

PII is redacted at the tool layer, not at the prompt layer. Prompt-layer redaction is policy enforcement at the wrong layer; it depends on the agent cooperating with the system that constrains it. Tool-layer redaction is enforced by the policy-enforcement point itself. The agent never sees what it is not entitled to see. This is data minimization translated from "do not log this field" to "do not return this field to this principal."

Output volume is bounded. An agent that can invoke a per-customer lookup ten thousand times can extract the customers table. Per-tool rate limits, per-principal rate limits, and result-set caps are not optimizations; they are policy. They prevent capability misuse by repetition.

Cross-tool capability chaining is policed. If tool A returns a customer ID and tool B accepts a customer ID, the composition of A and B grants relationship access that neither tool grants alone. Static analysis of the tool surface catches the obvious cases. Runtime detection of suspicious call sequences catches the rest.

## Audit is where this pattern earns its keep

Audit is where the design earns most of its keep, and it is the part most early implementations underweight. Every tool invocation is a policy decision the system has already made, which means every invocation is a logged event with a fixed shape: which agent invoked the call, under which role, against which tool, with which parameters, returning which result fingerprint, at which timestamp.

Two payoffs from getting this right.

First, the audit log is the post-incident forensic record, the role audit logs have always played in human-IAM systems. When something has gone wrong, the question "what did this principal do, when, and against what" needs a deterministic answer. Reconstructing agent behavior from prompts and model outputs is hopeless. Reconstructing it from a list of tool calls is mechanical.

Second, the audit log is the dataset on which agent behavior is tuned. Anomaly detection on agent activity becomes concrete once the data exists. A `customer_support_lookup` role that suddenly starts paginating through every customer in the database is a signal whose detection does not require understanding the model; it requires understanding the policy. The same techniques that flagged a service account exfiltrating data in 2015 flag an agent doing the same thing now.

## What this pattern does not solve

Three honest limits, worth naming so they are not mistaken for places the pattern silently covers.

Write paths. Agents that need to write are a different problem. Approval workflows, dry-run modes, two-person rules, staged commits: all of these are familiar from the write side of human-IAM systems and none of them are addressed by the read-only capability pattern. Read is the easier half of the problem. Write deserves its own design.

Sensitive-by-context data. RBAC by tool and column does not capture "this record is sensitive because of who it is about." A customer who is a minor, a transaction that is part of an active fraud investigation, an employee under HR review: none of these are detectable from the schema, and none of them are caught by the role-to-tool-to-column binding. This is genuinely ABAC territory, and a real reason to graduate from pure RBAC once the read pattern is solid.

Capability chaining at scale. The surface of an MCP server with five tools is reviewable by inspection. The surface of one with fifty is not. The combinatorics of what an agent can infer from a sequence of legitimate calls become a real threat model, and the inferential reach can exceed the apparent permission of any single tool. Static analysis of the tool surface helps. Runtime detection of suspicious call sequences helps more. Neither makes the problem go away.

## Conclusion

AI agents are non-human principals at scale. The IAM community spent two decades figuring out how to give non-human principals safe access to systems. The teams that ignore that body of knowledge will rediscover its lessons the hard way, usually after an incident. The MCP read-only pattern is a way of porting one lesson, scoped delegation governed by RBAC, into the agentic era. The next ones worth porting, in roughly the order they are about to be needed, are just-in-time credentials, mutual authentication between agent and capability surface, and capability auditing across composed tool calls. Each is its own post.

## References

- [Model Context Protocol specification](https://modelcontextprotocol.io){:target="_blank" rel="noopener noreferrer"}
- [NIST Role-Based Access Control (RBAC) project](https://csrc.nist.gov/projects/role-based-access-control){:target="_blank" rel="noopener noreferrer"}
- [NIST Attribute-Based Access Control (ABAC) project](https://csrc.nist.gov/projects/attribute-based-access-control){:target="_blank" rel="noopener noreferrer"}
- [Zanzibar: Google's Consistent, Global Authorization System](https://research.google/pubs/pub48190/){:target="_blank" rel="noopener noreferrer"} - canonical modern reference for relationship-based access control (ReBAC)
- [Connecting PostgreSQL to AI tools via MCP](/connect-your-ai-to-postgres-with-mcp){:target="_blank"} - prior post covering MCP server setup mechanics
