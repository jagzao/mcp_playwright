# US-004 — Browser Agent Gateway Usable V1

Status: Ready for autonomous execution
Type: Umbrella deliver / release-level User Story

## Authoritative context

Before planning or implementing this deliver, read completely:

1. `.agents/memory/browser-gateway-master-spec.md` — authoritative consolidated mega-spec.
2. `AGENTS.md`.
3. `.agents/skills/project-lead/SKILL.md`.
4. `docs/architecture/browser-gateway.md`.
5. `docs/architecture/persistent-browser-lifecycle.md`.
6. `docs/security/secrets-and-authenticated-sessions.md`.
7. `docs/architecture/deep-research.md`.
8. `docs/architecture/context-routing.md`.
9. `docs/architecture/webmcp-strategy.md`.
10. Relevant ADRs and existing code/tests.

This US consolidates the complete analysis into a release target. Do not shrink it to US-001 only.

## User Story

**As** Juan and the authorized agents in the CONTROL ecosystem,
**I want** a locally runnable Browser Agent Gateway that can browse cheaply through Obscura, fall back to Playwright/Chromium, keep browsers alive while I authenticate, securely persist authenticated sessions, perform evidence-backed deep research and expose stable MCP/CLI capabilities,
**so that** Interview Nail, Marketing, OrquestadorZao and coding agents can use a browser/research capability we control without depending routinely on the limited Codex built-in browser.

## Business outcome

Deliver a genuinely usable local V1, not merely an architectural scaffold.

A successful release materially reduces Codex Browser dependence and supports at least:

- public browsing/extraction;
- browser-engine fallback;
- persistent human login/takeover;
- reusable authenticated sessions;
- deep research with evidence;
- safe agent integration via MCP/CLI;
- observable cost/success/fallback metrics.

## Scope

This umbrella deliver includes the functionality previously separated as:

- US-001 Browser Gateway core;
- US-002 secure authenticated sessions + SecretProvider;
- US-003 Deep Research + SearchProviderRouter;
- persistent BrowserHost and human pause/resume behavior;
- release usability/quickstart/diagnostics;
- integration contracts needed by Interview Nail, Marketing and OrquestadorZao.

Cross-repository implementation inside Interview Nail/Marketing/OrquestadorZao is not required to declare this repository usable, but this repository must expose/document the contracts those projects need.

## Required functional areas

### A. Stable/reproducible project baseline

- dependency installation is reproducible;
- CI reaches actual build/test steps;
- current secret-unsafe logging/tool-result behavior is corrected;
- existing critical Playwright/MCP/session behavior has a regression baseline.

### B. Browser Gateway core

- provider-neutral `BrowserEngine` contract;
- typed results/error categories;
- Obscura implementation as preferred engine;
- existing Playwright wrapped/reused as compatibility engine;
- deterministic bounded fallback;
- safety/approval gate independent from engine;
- DOM/snapshot-first observation;
- configurable LLM operator routing;
- structured telemetry/cost/fallback reporting;
- MCP and CLI access over the same application logic.

### C. Persistent BrowserHost

Browser process/session lifetime must not depend on an LLM call/turn.

Must support explicit lifecycle/status and multiple isolated sessions.

A user takeover flow must:

1. launch/show headed Playwright;
2. transition the task to `WAITING_FOR_USER`;
3. leave the browser open while the agent/transport is waiting;
4. allow Juan to login/MFA/CAPTCHA manually;
5. resume the exact same task/session/page when Juan says continue;
6. avoid forcing Juan to restate the task;
7. persist auth after success when allowed.

### D. SecretProvider + SessionVault

- no plaintext secrets/auth artifacts in Git/prompts/logs;
- provider abstraction for machine secrets;
- initial Bitwarden-compatible provider integration or documented adapter if credentials are unavailable during implementation;
- local/dev env provider behind same contract;
- encrypted durable browser auth/session storage;
- session profile/domain/capability isolation;
- expiry/validation/revocation lifecycle;
- separate engine-specific artifacts when necessary;
- typed reauthentication/bootstrap/user-interaction outcomes.

### E. Deep Research

- provider-neutral SearchProviderRouter;
- quick/standard/deep modes;
- question decomposition in deep mode;
- source discovery/ranking;
- Obscura-first source reading with Playwright/auth fallback;
- Evidence Ledger connecting conclusions/claims to sources/locators;
- bounded iterative gap research;
- contradiction/adversarial pass in deep mode;
- citation/evidence validation before completion;
- configurable request/page/model/token/USD budgets;
- telemetry for providers/pages/models/cost.

### F. Security

- SSRF/private-network denied by default;
- secrets/cookies/auth/form sensitive values redacted from logs/results;
- page prompt injection cannot expand permissions, request secrets, change context routing or approve side effects;
- engine/provider fallback cannot bypass safety;
- session isolation proven;
- CDP/browser endpoints not publicly exposed by default;
- user challenges are handed to the user, not bypassed;
- irreversible external side effects remain approval gated.

### G. WebMCP readiness

WebMCP is not a blocker for core external-site browsing, but V1 must preserve the strategy defined in `webmcp-strategy.md`:

- owned interactive apps can expose semantic tools;
- stable API/MCP remains preferred when it already exists;
- WebMCP can become an allowed capability adapter/detection path;
- external sites continue through Browser Gateway;
- no project-wide permission expansion from page-provided tools.

If full WebMCP browser support is not reliable in the current environment, document/test the adapter boundary and leave the capability feature-flagged rather than blocking the V1.

### H. Usable local product UX

Juan or another developer/agent must be able to use the project from documentation.

Required:

- clean README/Quickstart;
- install/setup prerequisites;
- Obscura bootstrap/run instructions;
- Playwright install instructions;
- `.env.example` aliases/placeholders only;
- setup/diagnose command;
- health/capability command;
- commands/examples for public browse, forced fallback, auth bootstrap, session status/reuse, wait/resume and research;
- troubleshooting for typed outcomes;
- no need to inspect implementation source to learn how to run basic flows.

## Acceptance Criteria

### AC1 — Reproducible baseline

From a clean checkout of the branch, dependency installation and documented setup can reach build/test execution. CI no longer fails merely because the repo lacks a lockfile/cache prerequisite.

### AC2 — Secret-safe existing behavior

Existing MCP/browser tools no longer log or return sensitive raw form values/credentials. Automated tests prove redaction for representative secrets.

### AC3 — Obscura-first

A supported public structured browsing task attempts Obscura first and completes with `engine=obscura` plus telemetry.

### AC4 — Playwright fallback

A deterministic forced Obscura unsupported/error path falls back to Playwright exactly once according to policy and records the reason.

### AC5 — Manual final escalation

When both controlled engines cannot complete, return a typed `manual_escalation_required`; never pretend Codex Browser was invoked.

### AC6 — No policy bypass through fallback

Security, approval and invalid-request results cannot become allowed merely by switching engine/model/provider.

### AC7 — Persistent BrowserHost

BrowserHost survives the end of the initiating MCP/CLI call and supports status/reconnect semantics without automatically closing the browser.

### AC8 — Human pause/resume

A headed Playwright scenario reaches `WAITING_FOR_USER`; the browser remains open while waiting; a later resume command continues the same logical task and same live session/page.

### AC9 — Correct task resume

With at least two sessions/tasks, resume of one waiting task cannot resume or access the other task's browser/session state.

### AC10 — Durable auth

An authenticated SessionProfile can be persisted encrypted, gateway process restarted, session restored/reused and validated without exposing raw cookies/state to the LLM/tool caller.

### AC11 — Auth lifecycle

Missing, expired and revoked authentication produce distinct typed outcomes and require the correct bootstrap/reauth path.

### AC12 — Secret provider abstraction

Secret resolution is behind an interface and can be tested with a fake provider. The application/domain layer does not depend directly on Bitwarden/env APIs.

### AC13 — Deep Research standard flow

A standard/deep research run discovers multiple sources through SearchProviderRouter, reads them through Browser Gateway and produces an evidence-backed result.

### AC14 — Deep Research adversarial validation

Deep mode explicitly searches for contradictory/independent evidence for major conclusions and surfaces material disagreements.

### AC15 — Research budgets

Configured search/page/model/cost budgets are enforced deterministically and budget exhaustion yields a typed partial/blocked outcome rather than an unbounded loop.

### AC16 — Prompt-injection boundary

A hostile page/source fixture attempting to request secrets, expand capabilities or self-authorize an action cannot change the trusted Context/Policy state.

### AC17 — SSRF/private network

Private/loopback targets are denied by default at the trusted navigation policy level regardless of selected browser engine.

### AC18 — Session isolation

Authentication/browser state for session A is inaccessible to session B unless an explicit future sharing policy authorizes it.

### AC19 — Side-effect approval

A representative irreversible external action cannot execute without required approval, including after model/engine fallback.

### AC20 — DOM-first cost behavior

A normal DOM-readable browse/research scenario completes without requiring screenshots; telemetry records screenshot count.

### AC21 — LLM routing

Browser/research operator model/provider selection is configuration-driven and replaceable by fakes. No domain rule is hard-coded to a specific vendor.

### AC22 — Search routing

Search discovery is behind a provider-neutral contract. At least one provider/fake works end-to-end and another can be selected/fallback without changing research domain logic.

### AC23 — Usable MCP/CLI

The documented MCP/CLI interface can start a task, inspect status, resume/cancel where applicable and obtain final telemetry/result without duplicating browser-domain business logic.

### AC24 — Diagnostics

A documented diagnose/health command reports the readiness of Obscura, Playwright, configured LLM/search providers, secret/session infrastructure and important missing prerequisites without leaking secrets.

### AC25 — Clean-user smoke

Following the README from a clean environment (with required local prerequisites/credentials supplied) allows a developer to execute at least the public browse smoke and a deterministic fallback smoke.

### AC26 — Auth usability smoke

A repeatable headed auth/test flow demonstrates the wait/resume lifecycle. It may use a safe local/test fixture rather than a real social account in CI, but manual validation instructions for real LinkedIn/Facebook-like login must be documented.

### AC27 — Deep Research smoke

A repeatable safe research command produces an evidence report and telemetry. Network/billed-provider CI may use fakes/recorded fixtures, with optional live smoke documented separately.

### AC28 — Regression

Critical existing Playwright/MCP/session functionality touched by this migration remains green or any intentional breaking behavior is explicitly documented and accepted.

### AC29 — Observability

Every completed task exposes structured task/session/engine/model/provider/duration/status/fallback data; research includes search/source/cost data where available; no raw secret values are present.

### AC30 — Independent review

A fresh review finds no unresolved blocker/high issue in safety, secret handling, SSRF, prompt injection, session isolation, lifecycle, fallback or correctness.

### AC31 — WebMCP architecture preserved

The implementation does not block future WebMCP use and either exposes a feature-flagged adapter/detection boundary or explicitly demonstrates why current browser support is deferred. Owned-app WebMCP remains an integration capability, not a replacement for external-site Browser Gateway.

### AC32 — Release usability

The final project-lead report demonstrates that the system can be operated by Juan locally for the intended V1 workflows. A green compiler alone is insufficient evidence.

## Mandatory test matrix

The Project Lead must explicitly execute/document all applicable categories.

### Unit

Policies, routers, result types, redaction, safety, state machines, budgets, ranking/saturation.

### Integration/contract

Obscura, Playwright, MCP/CLI application boundary, BrowserHost/session registry, SessionVault, SecretProvider fake/provider adapter, SearchProvider fake/provider adapter, telemetry.

### E2E

Required scenarios are defined in `.agents/memory/browser-gateway-master-spec.md`, including Obscura success, forced Playwright fallback, manual escalation, human pause/resume, restart auth reuse, revoked auth, deep research, safety block and session isolation.

### Smoke

Startup/health, public browse, forced fallback, wait/resume, auth/session and research.

### Regression

Existing critical touched behavior.

### Security/abuse

Secret leakage, SSRF, prompt injection, capability escalation, fallback bypass, session isolation, invalid input and public endpoint exposure.

### Failure/recovery

Engine/provider crash/timeout, interruption/reconnect, lost live browser, malformed auth state, expired/revoked session, budget exhaustion and contradictory evidence.

### Persistence/restart

Session persistence/revocation and BrowserHost/coordinator recovery semantics.

### Human-in-the-loop

Browser remains open in `WAITING_FOR_USER`; explicit continuation resumes the correct task.

### Performance/cost/observability

No unbounded loops; record representative latency, fallback and estimated cost/successful task metrics.

If a test category is N/A, final evidence must say why.

## Autonomous execution contract

The agent must not stop after implementing one sub-story merely because that sub-story is green.

For this umbrella deliver:

```text
US-004
 -> baseline fixes
 -> complete/verify US-001
 -> BrowserHost + complete/verify US-002
 -> complete/verify US-003
 -> usable MCP/CLI/docs/diagnostics
 -> full test matrix
 -> independent review
 -> fix/retest loop
 -> final operational smoke
 -> done | blocked | failed
```

Continue automatically between reversible phases.

A `blocked` state is valid only for a genuinely human/external dependency. When blocked for login/MFA, preserve the browser/task state and tell Juan exactly what to do, then resume after his continuation signal.

## Definition of Done

`done` requires every applicable Acceptance Criterion with concrete evidence, full required validation matrix green, operational quickstart/smokes demonstrated, no unresolved blocker/high finding, and a final report mapping AC -> evidence.

The authoritative expanded Definition of Usable V1 is in `.agents/memory/browser-gateway-master-spec.md` and is part of this deliver.

After `done`, Juan + ChatGPT perform an independent audit before treating the release as accepted.