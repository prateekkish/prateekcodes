# Code-Mint Onboarding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Onboard the `prateekcodes` Jekyll blog for AI-first development using the code-mint framework, proving six north-star outcomes with evidence before any remediation.

**Architecture:** Assessment-first, approval-gated. Phase 1 runs read-only auditors to baseline the current state; Phases 2–5 are remediation and are gated on explicit user approval after seeing Phase 1 findings. Progress is tracked in `docs/onboarding-checklist.md` as the system of record.

**Tech Stack:** Jekyll 4 (Ruby 3.2.2), AWS Amplify (CI/CD + hosting), Docker (local dev), code-mint skill framework, git.

---

## Context: Target Repository

- **Repo:** `/Users/prateek/Work/personal/prateekcodes`
- **Stack:** Jekyll static blog, Ruby 3.2.2, plugins: jekyll-feed, sitemap, paginate, seo-tag, archives, compose, kramdown, jekyll-environment-variables
- **Deployment:** AWS Amplify (`amplify.yml` — `bundle exec jekyll b`)
- **Local runtime:** `jekyll serve --watch` or Docker (`docker-compose up`)
- **No existing agent infra:** No `.agents/`, no `AGENTS.md`, no `docs/` (outside `docs/plans/`)
- **No `.env` files:** env vars likely set in Amplify console only
- **No automated tests:** Static blog — test infrastructure likely N/A

## Auditor Applicability Decision

| Auditor | Apply? | Reason |
|---|---|---|
| `legibility--auditor` | Yes | Always run |
| `autonomy--test-readiness-auditor` | Yes | Always run; expected finding: minimal/N/A for static blog |
| `autonomy--env-auditor` | No | No `.env` files locally; `jekyll-environment-variables` used only in Amplify build |
| `autonomy--runtime-auditor` | Yes | Jekyll serve + Docker = documentable smoke path |
| `autonomy--sre-auditor` | Maybe | AWS Amplify has build logs and deployment history; confirm scope with user |

---

## Phase 1: Assess The Current State

> **Assessment-first, read-only. No approval needed to run Phase 1.**

### Task 1: Create Onboarding Branch

**Files:** Git only

**Step 1: Verify clean working tree**

```bash
cd /Users/prateek/Work/personal/prateekcodes
git status
```
Expected: `nothing to commit, working tree clean`

**Step 2: Create and switch to onboarding branch**

```bash
git checkout -b chore/code-mint-phase-1-assessment
```
Expected: `Switched to a new branch 'chore/code-mint-phase-1-assessment'`

---

### Task 2: Copy Code-Mint Assets Into Repo

**Files:**
- Create: `.agents/skills/` (all 13 skills)
- Create: `.agents/code-mint-status.json`
- Create: `.agents/reports/.gitkeep`
- Create: `.agents/reports/completed/.gitkeep`
- Create: `docs/framework.md`
- Create: `docs/outcomes.md`
- Create: `docs/onboarding-checklist.md`
- Create: `docs/skills-status.md`
- Modify: `.gitignore`

**Step 1: Clone code-mint source into a temp directory**

```bash
cd /Users/prateek/Work/personal/prateekcodes
git clone https://github.com/patterninc/code-mint.git .code-mint-source
```

**Step 2: Create directory structure**

```bash
mkdir -p .agents/reports .agents/reports/completed docs
touch .agents/reports/.gitkeep .agents/reports/completed/.gitkeep
```

**Step 3: Copy skills and docs**

```bash
cp -RL .code-mint-source/.agents/skills .agents/
cp .code-mint-source/.agents/code-mint-status.json .agents/
cp .code-mint-source/docs/framework.md docs/
cp .code-mint-source/docs/outcomes.md docs/
cp .code-mint-source/docs/onboarding-checklist.md docs/
cp .code-mint-source/docs/skills-status.md docs/
```

**Step 4: Update `.gitignore` to keep dirs but ignore generated reports**

Add to `.gitignore`:
```
.agents/reports/*
!.agents/reports/.gitkeep
!.agents/reports/completed/
.agents/reports/completed/*
!.agents/reports/completed/.gitkeep
.code-mint-source/
```

**Step 5: Remove temp source**

```bash
rm -rf .code-mint-source
```

**Step 6: Initialize `docs/onboarding-checklist.md`**

Open `docs/onboarding-checklist.md` — it is already the template from code-mint. No further edits needed yet.

**Step 7: Initialize `.agents/code-mint-status.json`**

Edit `.agents/code-mint-status.json` — set `"scope": "."` (repo-root onboarding). All outcomes remain `Not Started`.

**Step 8: Initialize `.agents/reports/onboarding-summary.md`**

Create this file with the running memo structure:

```markdown
# Onboarding Summary
**Repository:** prateekcodes
**Current Phase:** Phase 1

## Outcomes
- Validate Current State: In Progress
- Navigate: Not Started
- Self-Test: Not Started
- Smoke Path: Not Started
- Bug Reproduction: Not Started
- SRE Investigation: Not Started

## Scope Decisions
- env auditor: N/A — no local .env files; env vars set in Amplify console
- sre auditor: TBD — pending user confirmation of Amplify log access

## Current Priorities
- Run Phase 1 auditors to baseline current state

## Decisions And Approvals
- None yet

## Blockers
- None

## Next Step
- Run legibility, test-readiness, and runtime auditors (parallel)

## Next PR
- PR: chore/code-mint-phase-1-assessment — assessment artifacts only
```

---

### Task 3: Run Phase 1 Auditors (Parallel, Read-Only)

> All three auditors can run in parallel — they are read-only. Do not update `.agents/code-mint-status.json` during this step; defer to Task 4.

**Step 1: Run legibility auditor**

Using the `legibility--auditor` skill from `.agents/skills/legibility--auditor/SKILL.md`:

- Crawl directory structure, check for AGENTS.md (none exist)
- Evaluate root AGENTS.md criteria (all will fail — it doesn't exist yet)
- Check subdirectory coverage for `_posts/`, `_layouts/`, `_includes/`, `_sass/`, `_pages/`, `_plugins/`, `assets/`
- Score across 8 readiness dimensions
- Write report to `.agents/reports/legibility--auditor-audit.md`

**Step 2: Run test-readiness auditor**

Using the `autonomy--test-readiness-auditor` skill:

- Discover test infrastructure (expect: none for a static blog)
- Check for test commands in Gemfile, README, CI
- Evaluate CI integration (`amplify.yml` — build only, no test step)
- Write report to `.agents/reports/autonomy--test-readiness-auditor-audit.md`

**Step 3: Run runtime auditor**

Using the `autonomy--runtime-auditor` skill:

- Identify runtime targets: `jekyll serve --watch` and `docker-compose up`
- Document prerequisites: Ruby 3.2.2, bundler, OR Docker
- Document the smoke path: `bundle exec jekyll serve` → `localhost:4000`
- Identify stop conditions and success signals (HTTP 200 on localhost:4000)
- Write report to `.agents/reports/autonomy--runtime-auditor-audit.md`

---

### Task 4: Update Checklist and Status, Write Summary

**Files:**
- Modify: `docs/onboarding-checklist.md`
- Modify: `.agents/code-mint-status.json`
- Modify: `.agents/reports/onboarding-summary.md`

**Step 1: Update `docs/onboarding-checklist.md`**

Based on audit findings, update the Outcome Tracker:
- `Validate Current State` → `Proven` (audit reports + summary exist)
- `Navigate` → `In Progress` (no AGENTS.md yet)
- `Self-Test` → likely `N/A` (static blog, no test infrastructure)
- `Smoke Path` → `In Progress` (runtime auditor has findings, not yet documented as a smoke path)
- `Bug Reproduction` → `Not Started`
- `SRE Investigation` → `Not Started` (pending user confirmation on Amplify access)

Fill in the `### Validate Current State` section with evidence:
- Evidence: links to the three audit reports + `onboarding-summary.md`
- What Passed: audit reports generated, current state baselined
- What Is Still Missing: AGENTS.md, smoke path doc, test infra assessment

**Step 2: Update `.agents/code-mint-status.json`**

Set `onboarded_at` to `2026-04-05` and update all outcome statuses to match checklist.

**Step 3: Update `.agents/reports/onboarding-summary.md`**

Fill in final Phase 1 summary with what is working, blocked, risky, and next to prove.

---

### Task 5: Present Phase 1 Summary to User — STOP FOR APPROVAL

Present this summary to the user:

```
Phase 1 Assessment Complete.

Validate Current State: Proven — audit reports generated, current state baselined
Navigate: In Progress — no AGENTS.md exists; legibility score will show gaps
Self-Test: [N/A or In Progress] — static blog; see test-readiness audit
Smoke Path: In Progress — Jekyll serve + Docker documented in runtime audit
Bug Reproduction: Not Started
SRE Investigation: Not Started (pending: do you have AWS Amplify log access?)

Recommended next proof: Navigate (create AGENTS.md)

Awaiting your approval before making changes. Which phase(s) would you like to proceed with?
1. Phase 2: Prove Navigation (create AGENTS.md)
2. Phase 3: Prove Smoke Path (document jekyll serve as trusted smoke path)
3. Both 1 and 2 together
4. Stop here — assessment only
```

> **HARD STOP: Do not proceed past this point without explicit user approval.**

---

## Phase 2: Prove Navigation (Approval Required)

> **Gate: User must approve before starting this phase.**

### Task 6: Create Root AGENTS.md

**Files:**
- Create: `AGENTS.md`

**Step 1: Read legibility audit findings**

Read `.agents/reports/legibility--auditor-audit.md` to understand all gaps.

**Step 2: Use `legibility--enhancer` skill**

Using `.agents/skills/legibility--enhancer/SKILL.md`, create `AGENTS.md` at repo root covering:
- Project purpose: personal tech blog at prateekcodes.com
- Tech stack: Jekyll 4, Ruby 3.2.2, kramdown, AWS Amplify
- Build/run commands: `bundle exec jekyll serve --watch`, `docker-compose up`, `JEKYLL_ENV=production bundle exec jekyll b`
- Directory map: `_posts/`, `_layouts/`, `_includes/`, `_sass/`, `_pages/`, `_plugins/`, `assets/`
- Conventions: front matter format, post naming (`YYYY-MM-DD-slug.md`), SCSS structure
- Deploy: AWS Amplify auto-deploys on push to main via `amplify.yml`
- Keep under 100 lines

**Step 3: Verify navigation proof**

Ask the agent (yourself) to explain where a sample task belongs:
> "I want to add syntax highlighting to code blocks in blog posts. Where should I work?"

Record the grounded answer in `docs/onboarding-checklist.md` under `### Navigate`.

**Step 4: Update checklist**

Mark `Navigate` as `Proven` in `docs/onboarding-checklist.md`. Update `.agents/code-mint-status.json`.

**Step 5: Commit**

```bash
git add AGENTS.md docs/onboarding-checklist.md .agents/code-mint-status.json
git commit -m "docs: add AGENTS.md and prove Navigate outcome"
```

---

## Phase 3: Prove Smoke Path (Approval Required)

> **Gate: User must approve before starting this phase.**

### Task 7: Document Smoke Path

**Files:**
- Modify: `AGENTS.md` (add smoke path section if not already present)
- Modify: `.agents/reports/autonomy--runtime-auditor-audit.md` (ensure smoke path is documented)

**Step 1: Read runtime audit findings**

Read `.agents/reports/autonomy--runtime-auditor-audit.md`.

**Step 2: Use `autonomy--runtime-creator` skill**

Using `.agents/skills/autonomy--runtime-creator/SKILL.md`, document the smoke path:

Prerequisites:
- Ruby 3.2.2 installed OR Docker installed
- `bundle install` (if using Ruby directly)

Smoke path (option A — Ruby):
```bash
bundle exec jekyll serve --watch
# Success signal: "Server running... press ctrl-c to stop."
# Then: curl -s -o /dev/null -w "%{http_code}" http://localhost:4000 → 200
```

Smoke path (option B — Docker):
```bash
docker-compose up
# Success signal: container starts, port 4000 exposed
```

Stop conditions: HTTP 200 on localhost:4000/

**Step 3: Update checklist**

Mark `Smoke Path` as `Proven` with exact evidence. Update `.agents/code-mint-status.json`.

**Step 4: Commit**

```bash
git commit -m "docs: prove Smoke Path outcome with jekyll serve smoke check"
```

---

## Phase 4: Self-Test Assessment (Approval Required)

> **Gate: User must approve. Expected outcome: N/A for a static blog.**

### Task 8: Assess and Record Self-Test Status

**Step 1: Review test-readiness audit**

Read `.agents/reports/autonomy--test-readiness-auditor-audit.md`.

**Step 2: Decide**

For a Jekyll static blog with no Ruby business logic:
- If no test infrastructure exists and there is nothing meaningful to test automatically, mark `Self-Test` as `N/A` with reason.
- If the user wants to add HTML/link validation (e.g., `htmlproofer`), that becomes a remediation task.

**Step 3: Update checklist**

Mark `Self-Test` as `N/A` (with reason) or `In Progress` depending on decision.

---

## Phase 5: Verify And Activate (Approval Required)

> **Gate: User must approve phases 2–4 first.**

### Task 9: Re-run Auditors and Archive

**Step 1: Archive Phase 1 reports**

```bash
for f in .agents/reports/*-audit.md; do
  [ -f "$f" ] && cp "$f" ".agents/reports/completed/$(basename "$f" .md)-baseline-2026-04-05.md"
done
```

**Step 2: Re-run auditors**

Re-run `legibility--auditor` and `autonomy--runtime-auditor`. Compare against baseline.

**Step 3: Final checklist update**

Update `docs/onboarding-checklist.md` with final statuses, dates, and evidence. Update `.agents/code-mint-status.json` with `last_validated: "2026-04-05"`.

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: complete code-mint onboarding phase 1-3 for prateekcodes"
```

**Step 5: Ask user about PR**

Do not open a PR automatically. Ask: "Ready to open a PR for `chore/code-mint-phase-1-assessment`?"

---

## Summary of Approval Gates

| After Task | Gate | Description |
|---|---|---|
| Task 5 | **HARD STOP** | Present Phase 1 findings. Wait for explicit approval before any changes. |
| Task 6 | Requires approval | Create AGENTS.md (Phase 2) |
| Task 7 | Requires approval | Document smoke path (Phase 3) |
| Task 8 | Requires approval | Self-test decision (Phase 4) |
| Task 9 | Requires approval | Final verification and PR (Phase 5) |
