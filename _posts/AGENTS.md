# _posts/

Blog posts as `YYYY-MM-DD-slug.md`. Each covers a specific backend engineering topic (Rails, PostgreSQL, database scaling).

## Front-Matter Schema

```yaml
layout: post
title: "..."           # Required
author: prateek        # Required, always this value
categories: [ ... ]    # Required, e.g. [ Rails, PostgreSQL, Performance ]
tags: [ ... ]          # Required, kebab-case, e.g. [ rails-7, connection-pooling ]
excerpt: "..."         # Required, 1-2 sentences, plain text
description: "..."     # Optional — auto-generated from excerpt if absent
keywords: "..."        # Optional — auto-generated from tags+categories if absent
image: "..."           # Optional
```

## Writing Style

Match existing posts. Read 2-3 recent posts in `_posts/` before drafting.

**Voice and tone:**
- Direct and technical. State the problem in the opening paragraph — no warmup.
- Natural, conversational but precise. Do not sound like a marketing page.
- Avoid gimmicky phrases ("game-changer", "revolutionize", "unlock the power of", "dive into").
- No em dashes (—). Use a regular hyphen-dash ( - ) or restructure the sentence.
- No rhetorical questions as section headers.

**Structure:**
- Opening paragraph: what this is and what problem it solves. No preamble.
- Use `## The Problem` / `## Before` sections to establish context before showing the solution.
- Use `## After` or a named solution section for the payoff.
- Bullet lists for enumerating tradeoffs or consequences — not for padding.
- Link to source commits, RFCs, or changelogs when citing a specific change (see existing posts for link format).

**Code examples:**
- Examples must be concrete and realistic, not toy snippets.
- Every code example that is not explicitly vague or conceptual must be run and verified before the post is published.
- Use inline backticks for method names, class names, and config keys: `with_connection`, `_config.yml`.

## Workflow for New Posts

1. Draft the post.
2. Run every non-trivial code example to confirm it works as described.
3. Before publishing, pass the full draft to a **fresh subagent** with the instruction: "Proofread this post for technical accuracy. Flag any claim, code snippet, or version reference that is incorrect or unverifiable." Fix all flagged issues before publishing.
