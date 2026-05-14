---
layout: post
title: "Multi-hop delegation for AI agents: porting OAuth's on-behalf-of pattern into MCP topologies"
author: prateek
categories: [ AI, MCP, Security, Identity ]
tags: [ mcp, ai-agents, iam, oauth, rfc-8693, token-exchange, delegation, on-behalf-of ]
excerpt: "Bearer tokens do not survive composed agent tool calls. The pattern that does is one the IAM community settled in 2019: RFC 8693 Token Exchange with actor-chain claims, now being extended by IETF drafts specifically for agent topologies."
description: "How RFC 8693 Token Exchange and the on-behalf-of grant flow apply to AI agent topologies. Why bearer tokens fail across composed MCP tool calls, and what the actor-chain pattern fixes."
keywords: "oauth token exchange ai agents, rfc 8693 agents, on-behalf-of agent oauth, multi-hop delegation ai, mcp oauth delegation, actor token chain, agent oauth flow, oauth ai agent draft, delegated authorization ai agents, token exchange mcp"
---

Most AI agent deployments hit an awkward authentication problem inherited from web auth. A user authenticates. The user invokes an agent. The agent calls a tool. The tool calls another tool. By the time the request reaches the third service down, the identity of the original principal has either been lost, forged, or smuggled forward as a bearer credential that the agent could just as easily exfiltrate. The naive solutions are familiar. Hand the agent the user's access token, and it leaks the first time a prompt injection succeeds. Give the agent its own credential, and downstream services lose user attribution. Pass a custom header full of user claims, and the claims have no cryptographic binding to the original session.

The IAM community already has the right pattern. It is [RFC 8693 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693){:target="_blank" rel="noopener noreferrer"} and the on-behalf-of grant flow it formalizes. Several IETF drafts now extend that flow specifically for agent topologies. This post is about that pattern.

## Introducing: delegated authorization with actor chains

Delegation is the old IAM word for "principal A authorizes principal B to act for them, with some bounded scope." Impersonation is the variant where the downstream service cannot tell whether A or B made the call. Delegation is the variant where it can. For agent topologies, the second is the only acceptable design.

RFC 8693 Token Exchange formalizes both. The relevant primitives are two token parameters: `subject_token` (the principal the request is being made for) and `actor_token` (the principal making the request on their behalf). When an agent calls a tool, the token it presents has the user as subject and the agent itself as actor. When that tool, in turn, calls another tool, the second tool receives a token whose subject is still the user, whose immediate actor is the first tool, and whose actor's actor is the agent. The chain is preserved.

The `act` claim is what makes this work. It is a nested JWT claim whose value is itself an actor description, recursively. A four-hop call carries four-deep actor nesting. The token is no longer "a bearer credential that names a principal." It is a transcript of who delegated to whom, signed by the issuer, that any downstream verifier can interpret.

This inverts the trust direction. In a bearer-token world, every downstream service has to trust that the immediate caller is legitimately the principal it claims to be. In an actor-chain world, every downstream service can verify the entire chain of delegation from issuer-signed claims. The agent does not need the user's secret. The agent has its own credential, presented alongside a delegation token that binds it to a specific user context.

## Why bearer tokens fail in agent topologies

Three failure modes show up immediately when bearer credentials are reused across composed agent tool calls. Each is recognizable from older IAM experience. Each is amplified by the probabilistic nature of agent behavior.

Token exfiltration through prompt injection. If the agent holds the user's bearer token, the agent can be coerced into sending it somewhere. Prompt injection is the agent-shaped variant of an attack that web-IAM solved by binding tokens to channels (cookies with `HttpOnly`, proof-of-possession tokens, mTLS-bound sessions). Bearer tokens in the agent's working context are stored, transmitted, and reasoned about by a language model that does not have `HttpOnly`. The mitigation is structural: the agent must not hold a credential that grants it the user's authority. It must hold a credential that grants it the right to ask, on the user's behalf, with the issuer mediating each ask.

Audit blindness. When a downstream service sees a bearer token whose subject is the user, the audit log can only record "the user did this." If the call was actually initiated by an agent acting for the user, that distinction is missing from the record. Post-incident forensics on agent activity then becomes impossible: every agent action looks like a user action, and the principal-of-record for the call is wrong. The actor chain fixes this because it records, in the token itself, which agent invoked which tool, and the audit log can capture it without trusting the agent's self-report.

Cross-tool replay. Bearer tokens are valid wherever the issuer is trusted. An agent that received a token for one tool can present the same token to a different tool if that tool's verifier accepts the same issuer. [RFC 8707 Resource Indicators](https://datatracker.ietf.org/doc/html/rfc8707){:target="_blank" rel="noopener noreferrer"} address part of this by binding tokens to specific audiences. RFC 8693 addresses the rest by ensuring that each hop receives a fresh token narrowed to its audience and scope, derived from but not equal to the token the previous hop received. Replay across the topology becomes a token forgery problem, not a token reuse problem.

## What the actor chain looks like

The mechanics are clarified by walking through a single exchange. An agent has just received a request from a user. The agent has its own credential (the agent assertion). To call a downstream tool on the user's behalf, the agent presents both: its own credential as `actor_token`, and the user's authorization assertion as `subject_token`. The authorization server returns a new access token whose subject is the user and whose immediate actor (the `act` claim) is the agent.

When that tool in turn needs to call another tool, it performs another exchange. It presents its own credential as `actor_token`. It presents the token it just received as `subject_token`. The authorization server returns a token whose subject is still the user, whose immediate actor is the tool, and whose actor's actor is the original agent. The claim structure looks like this:

```json
{
  "iss": "https://auth.example.com",
  "aud": "tool_b",
  "sub": "user:alice",
  "act": {
    "sub": "tool_a",
    "act": {
      "sub": "agent:session-7f3a"
    }
  },
  "scope": "orders:read",
  "exp": 1715800000
}
```

That structure is the delegation history of the request, signed by the issuer, verifiable by any party that trusts the issuer's keys. The downstream verifier knows three things at once: who the action is ultimately for, who the most recent actor was, and the full chain of actors that brought the request to this point. The authorization policy at each hop can use any of those claims, individually or in combination, as inputs to its decision.

## What this fixes, and what it does not

The chain pattern fixes the three failure modes named earlier, and a couple more besides.

Attribution becomes precise. Every audit record at every hop names the user, the agent, and the intermediate tools. Post-incident analysis stops being guesswork. Scoped delegation per hop becomes possible: the token exchange at each hop can narrow scope. An agent granted broad read access by the user can still choose to invoke only `orders:read` against tool A; the narrowing is recorded in the token A receives. If A then calls B, A can narrow further. The narrowing is monotonic, since downstream tokens cannot widen what upstream tokens granted. Revocation becomes selective: revoking the agent's authority does not require revoking the user's session, and revoking one tool's authority does not require revoking the agent.

What this pattern does not fix is worth naming.

It does not verify agent intent. The user authorized the agent in general, not for this specific action. If the agent's interpretation of the user's request is wrong, every token in the chain is correctly issued for a request the user did not actually want. Step-up authorization is the answer there, and it is a separate problem.

It does not replace the policy decision. The actor chain is input to authorization, not output. Each hop still needs an RBAC or ABAC decision based on the claims in the token. Token exchange is a transport mechanism for delegation context, not a policy engine.

## The state of the standards work

The IETF work is moving, with several drafts active. [`draft-oauth-ai-agents-on-behalf-of-user-02`](https://datatracker.ietf.org/doc/html/draft-oauth-ai-agents-on-behalf-of-user-02){:target="_blank" rel="noopener noreferrer"} (published August 2025) extends RFC 8693 with `requested_actor` and `actor_token` parameters specifically scoped to agent flows. It is the most direct port of the on-behalf-of pattern for MCP-shaped topologies. [`draft-rosenberg-oauth-aauth-00`](https://www.ietf.org/archive/id/draft-rosenberg-oauth-aauth-00.html){:target="_blank" rel="noopener noreferrer"} ("AAuth: Agentic Authorization OAuth 2.1 Extension") addresses a different slice: a grant flow for agents operating in voice, SMS, or messaging channels where the browser redirect at the heart of standard OAuth is not available. The two drafts are not competing so much as partitioning the problem space.

Inside the on-behalf-of slice specifically, the live question is how much new machinery is needed. One position holds that RFC 8693 already covers the essential semantics, and what is needed is profile-level guidance: standard claim shapes, conventions for naming agent principals, sensible defaults for token lifetime in agent contexts. The other position argues for explicit new parameters, on the basis that the assumptions in RFC 8693 (especially around how `actor_token` is obtained for a non-human actor) do not map cleanly onto stochastic agent sessions.

Either way, the direction is settled. Multi-hop delegation for agents will be expressed in the language of RFC 8693, with or without a profile draft on top. Reading the drafts now, rather than after the WG adopts one, is the cheaper option.

## Conclusion

On-behalf-of is the second IAM lesson worth porting into agent terms, after [scoped delegation](/read-only-database-mcps-scoped-delegation-iam){:target="_blank"}. Together they cover most of what an MCP authorization design needs to get right at the protocol layer. The remaining lessons (sender-constrained tokens via DPoP, workload identity via SPIFFE-style attestation, step-up authorization through out-of-band re-auth) extend the pattern further but do not change its shape. The shape was decided in January 2020 when RFC 8693 was published. Agent authorization is, mostly, a question of adopting it deliberately rather than reinventing parts of it accidentally.

## References

- [RFC 8693 - OAuth 2.0 Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693){:target="_blank" rel="noopener noreferrer"}
- [RFC 8707 - Resource Indicators for OAuth 2.0](https://datatracker.ietf.org/doc/html/rfc8707){:target="_blank" rel="noopener noreferrer"}
- [draft-oauth-ai-agents-on-behalf-of-user-02](https://datatracker.ietf.org/doc/html/draft-oauth-ai-agents-on-behalf-of-user-02){:target="_blank" rel="noopener noreferrer"} - IETF draft extending RFC 8693 for agent flows
- [AAuth: Agentic Authorization OAuth 2.1 Extension](https://www.ietf.org/archive/id/draft-rosenberg-oauth-aauth-00.html){:target="_blank" rel="noopener noreferrer"} - competing IETF draft with broader scope
- [Model Context Protocol authorization specification](https://modelcontextprotocol.io/specification/draft/basic/authorization){:target="_blank" rel="noopener noreferrer"}
- [The multi-hop delegation problem for AI agents](https://workos.com/blog/oauth-multi-hop-delegation-ai-agents){:target="_blank" rel="noopener noreferrer"} - explainer on the bearer-token failure mode
- [Read-only database MCPs as a scoped-delegation pattern](/read-only-database-mcps-scoped-delegation-iam){:target="_blank"} - prior post on the RBAC/capability-surface half of the problem
