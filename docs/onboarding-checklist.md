# Outcome Checklist

Use this file as the canonical progress tracker during onboarding. The goal is not to mark steps complete; it is to prove that the repository can support a small set of agent capabilities with real evidence.

This file is intended to be copied into the target repository and updated there throughout onboarding.

## How To Use

1. Start with `Validate Current State` so the repository has a baseline.
2. Work toward one proof at a time. Do not try to unlock every outcome at once.
3. Record evidence each time an outcome changes state.
4. Keep `.agents/code-mint-status.json` in sync with this checklist. It is the machine-readable index; this file is the detailed evidence record.
5. Revisit the file when the user comes back later. It should be obvious what is done, blocked, or still unproven.

## Status Key

| Status | Meaning |
|---|---|
| `Not Started` | No meaningful work has been done on this outcome yet. |
| `Blocked` | The next proof is known, but something external or risky is preventing it. |
| `In Progress` | Work is underway, but the outcome is not yet proven with evidence. |
| `Proven` | The outcome has been demonstrated and the proof is captured below. |
| `N/A` | The outcome does not apply to this repository. |

## Outcome Tracker

| Outcome | Status | Last Validated |
|---|---|---|
| `Validate Current State` | Proven | 2026-04-05 |
| `Navigate` | Proven | 2026-04-05 |
| `Self-Test` | N/A | 2026-04-05 |
| `Smoke Path` | Proven | 2026-04-05 |
| `Bug Reproduction` | Not Started | — |
| `SRE Investigation` | N/A | 2026-04-05 |

## Outcome Details

Copy one section per outcome as it moves forward. Each section is the detailed evidence record for that outcome.

### Validate Current State

The agent can assess the repo before making changes.

- **Status:** Proven
- **Date:** 2026-04-05
- **Evidence:** `.agents/reports/legibility--auditor-audit.md`, `.agents/reports/autonomy--test-readiness-auditor-audit.md`, `.agents/reports/autonomy--runtime-auditor-audit.md`, `.agents/reports/onboarding-summary.md`
- **Exact Check:** Three Phase 1 auditors ran in parallel (legibility, test-readiness, runtime). All reports written. Summary captures current state, gaps, and next proofs.
- **What Passed:** Repo structure fully crawled. Runtime smoke path verified (jekyll build succeeds). All gaps identified with priority and remediation path.
- **What Is Still Missing:** AGENTS.md (legibility Level 0), no test infrastructure (test-readiness Failing), smoke path not yet formally documented.
- **Next Action:** Proceed to Phase 2 (Navigate) — create root AGENTS.md using legibility--enhancer.

### Navigate

The agent can explain where to work and why modules exist.

- **Status:** Proven
- **Date:** 2026-04-05
- **Evidence:** `AGENTS.md` (root), `_layouts/AGENTS.md`, `_includes/AGENTS.md`, `_plugins/AGENTS.md`. Build verified passing after all files created.
- **Exact Check:** Sample task: "Add syntax highlighting to code blocks." Grounded answer: edit `_sass/mediumish.scss` for CSS; optionally set `rouge` highlighter in `_config.yml`. No changes needed to posts or layouts. Answer derived entirely from `AGENTS.md` directory map and tech stack declaration.
- **What Passed:** Root AGENTS.md covers tech stack, exact commands, directory map, post conventions, deployment model, and agent permission boundaries. High-priority subdirectory files cover `_layouts/`, `_includes/`, `_plugins/`. `assets/js/` vendored-vs-custom distinction captured in root AGENTS.md.
- **What Is Still Missing:** `assets/js/AGENTS.md` deferred — vendored/custom distinction already documented in root AGENTS.md; low residual risk.
- **Next Action:** None — outcome proven.

### Self-Test

The agent can run the smallest relevant automated checks and trust the result.

- **Status:** N/A
- **Date:** 2026-04-05
- **Evidence:** No test infrastructure exists. Static blog with no application logic warranting automated tests.
- **Exact Check:** N/A — personal blog; owner decided automated tests are out of scope.
- **What Passed:** N/A
- **What Is Still Missing:** N/A
- **Next Action:** None — intentionally out of scope.

### Smoke Path

The agent can prove the runtime is meaningfully usable.

- **Status:** Proven
- **Date:** 2026-04-05
- **Evidence:** `AGENTS.md` smoke test command. Build verified: `bundle exec jekyll build && ls _site/index.html` exits 0 in 0.523s.
- **Exact Check:** Prerequisites: Ruby 3.2.2 (rbenv), `bundle install`. Smoke command: `bundle exec jekyll build && ls _site/index.html`. Success signal: exit 0, file exists. No auth, no external services, no side effects.
- **What Passed:** Cold-start build fully autonomous. README cleaned (removed obsolete `gsl` dep, removed unused foreman path, fixed `bundle exec` prefix). Docker image pinned to `jekyll/jekyll:4.4.1`.
- **What Is Still Missing:** Nothing blocking — smoke path is safe and documented.
- **Next Action:** None — outcome proven.

### Bug Reproduction

The agent can reproduce a reported issue before proposing a fix.

- **Status:** Not Started
- **Date:** —
- **Evidence:** failing test, script, or repro recipe linked to the issue
- **Exact Check:** Turn one real bug report into a deterministic failing case another person or agent can rerun.
- **What Passed:** —
- **What Is Still Missing:** —
- **Next Action:** The repro is the proof.

### SRE Investigation

The agent can inspect logs, metrics, traces, CI, or infra evidence.

- **Status:** N/A
- **Date:** 2026-04-05
- **Evidence:** N/A — static site deployed to AWS Amplify. No application runtime, no logs, no metrics, no tracing.
- **Exact Check:** N/A — owner decided Amplify build logs are out of scope for agent investigation.
- **What Passed:** N/A
- **What Is Still Missing:** N/A
- **Next Action:** None — intentionally out of scope.

## Suggested Evidence Patterns

| Outcome | Good Evidence |
|---|---|
| `Validate Current State` | Audit reports plus a short plain-language summary in `.agents/reports/onboarding-summary.md` covering working, blocked, risky, and next proof |
| `Navigate` | Root and module `AGENTS.md` files plus a sample repo explanation that answers where a representative task should happen |
| `Self-Test` | Exact targeted test command, the module or behavior it verifies, and the pass/fail signal it produced |
| `Smoke Path` | Prerequisites, startup order, smoke command, concrete success signal, and "stop here" safety notes |
| `Bug Reproduction` | Failing test or deterministic repro script tied to a reported issue and rerunnable by another person or agent |
| `SRE Investigation` | Query commands, time range, observed symptoms, ranked hypotheses, and next actions or an `N/A` reason |

## Skill Mapping

| Outcome | Skills To Reach It |
|---|---|
| `Validate Current State` | `meta--onboarding` plus all applicable auditor skills |
| `Navigate` | `legibility--auditor`, `legibility--enhancer` |
| `Self-Test` | `autonomy--test-readiness-auditor`, `autonomy--test-readiness-creator` |
| `Smoke Path` | `autonomy--env-auditor`, `autonomy--env-creator`, `autonomy--runtime-auditor`, `autonomy--runtime-creator` |
| `Bug Reproduction` | `autonomy--sre-agent`, `autonomy--test-readiness-*` |
| `SRE Investigation` | `autonomy--sre-auditor`, `autonomy--sre-agent` |

## Return-Visit Questions

When someone comes back to onboarding later, this file should answer:

- What has been proven already?
- What is the next missing proof?
- Which command, prompt, or scenario should be run next?
- What is blocked on human approval or missing tooling?
