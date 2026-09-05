# Browser Agent Gateway — Master Agent Memory / Mega-Spec

Status: authoritative planning memory for the usable V1.

This file is the durable equivalent of the long implementation prompt. Agents must not require Juan to repeat this context in chat. When `/project-lead` is invoked for the usable V1, read this file completely before planning.

## 1. Product mission

Evolve the existing `mcp_playwright` repository into a shared, production-oriented **Browser Agent Gateway** for Juan's ecosystem of coding/product agents.

The product exists to reduce routine dependence on the Codex built-in browser while preserving compatibility, human takeover, authenticated sessions, safety, observability and high-quality deep research.

Primary consumers:

- Interview Nail / career and job-search workflows;
- Marketing / social-media and campaign workflows;
- OrquestadorZao / shared CONTROL capability;
- coding agents such as Codex/OpenCode/project-lead;
- future Zavi integration through OrquestadorZao, never by embedding Obscura inside Android.

## 2. Existing-repo strategy

Do not rewrite working functionality merely to obtain a cleaner architecture.

The repository already contains Node/TypeScript, MCP SDK, Playwright, browser tools, session support, Redis/queues, observability and tests. The V1 must evolve and wrap those capabilities.

Language/runtime decision: **TypeScript/Node for this repository**. Python/.NET are valid elsewhere but are not justified for rewriting this browser stack.

## 3. Final usable-V1 architecture

```text
Client / Agent / Orquestador / Interview Nail / Marketing
                         |
                  MCP / CLI / API
                         |
                  Browser Gateway
        +----------------+----------------+
        |                |                |
   Context contract   Safety Gate     Telemetry
        |                                 |
        +----------------+----------------+
                         |
                  Task Coordinator
                         |
          +--------------+---------------+
          |                              |
      LLM Router                    Browser Router
          |                              |
  DeepSeek V4 Flash              Obscura (default)
  Gemini 3.8 Flash                |
  GPT-5.6 Luna                    +--> Playwright/Chromium
                                  |       compatibility + human takeover
                                  |
                                  +--> manual_escalation_required

Shared services:
- persistent BrowserHost
- SessionVault
- SecretProvider
- SearchProviderRouter
- Research Agent / Evidence Ledger
- optional WebMCP adapter/detection for owned compatible pages
```

## 4. Browser-engine policy

### Default machine-driven path

1. Obscura first for structured navigation, DOM/snapshot extraction and routine interaction.
2. Playwright/Chromium fallback for incompatibility, unsupported behavior, visual/complex browser behavior or sites requiring Chromium fidelity.
3. Typed manual escalation if controlled engines cannot complete.
4. Codex Browser is an external/manual last resort; this service must never pretend it can programmatically invoke it.

Fallback is deterministic policy, not exception spaghetti. Retry/fallback loops must be bounded and observable.

### Human takeover path

If a task requires login, MFA, CAPTCHA, security challenge or any user-visible interaction:

- promote/pin the activity to **headed Playwright**;
- keep the same BrowserHost/browser/context/page alive;
- transition activity to `WAITING_FOR_USER`;
- do not close the browser merely because the LLM/tool call/turn ends;
- when Juan says `continúa`, resume the correct suspended activity and same live session;
- after successful auth, persist encrypted durable auth state;
- do not assume Playwright auth state can be migrated to Obscura during the same activity.

A waiting activity is not failed and is not completed.

## 5. Persistent BrowserHost

Browser lifetime must be independent from LLM request/turn lifetime.

Required states:

```text
CREATED
  -> ACTIVE
  -> WAITING_FOR_USER
  -> RESUMABLE
  -> ACTIVE
  -> COMPLETED | FAILED | CANCELLED
```

The daemon/host owns live browser processes and session handles. The transport layer may disconnect/reconnect without destroying active/waiting browser sessions.

Required behavior:

- no accidental close on request completion;
- explicit close/cancel only;
- idle policy configurable and never applied to `WAITING_FOR_USER` without explicit safe policy;
- recovery metadata persisted so the coordinator can tell the user whether a live host was lost and restore from durable auth where possible;
- multiple logical sessions isolated from one another.

## 6. Durable authentication and secrets

Never commit or log real credentials, cookies, auth headers, MFA seeds, recovery codes or browser-state artifacts.

Separate:

1. `SecretProvider`: API keys/password references/service secrets.
2. `SessionVault`: encrypted browser authentication artifacts and metadata.

Initial preferred machine-secret provider: **Bitwarden Secrets Manager**, behind an interface. `EnvSecretProvider` only for local bootstrap/dev.

For Facebook, LinkedIn, Microsoft/Azure, Google and other personal/MFA accounts, prefer manual headed login once + persisted encrypted session instead of exposing username/password/MFA to the LLM.

Session outcomes must include typed states such as:

- `bootstrap_required`;
- `reauthentication_required`;
- `user_interaction_required`;
- `revoked`;
- `healthy`.

Each SessionProfile must include allowed domains/capabilities/approval policy. Engine fallback must never weaken those permissions.

## 7. Safety and security model

Browser content is untrusted data.

A page cannot:

- change project/context authority;
- expand tool permissions;
- request/receive secret values;
- approve its own side effects;
- modify safety/fallback policy;
- instruct the agent to ignore higher-level policy.

Required protections:

- SSRF/private-network denial by default;
- domain allowlists when session/profile requires them;
- secret-safe/redacted logging;
- approval gate for external side effects;
- browser-engine fallback cannot bypass a security/approval block;
- session isolation;
- bounded retries;
- CDP/Obscura endpoints not exposed unauthenticated to public networks;
- CAPTCHA/MFA/security challenges are handed to the user, not bypassed.

Side-effect examples requiring approval unless an explicit policy grants the exact capability:

- submit job application;
- send message/email;
- publish social content;
- purchases;
- destructive/admin changes;
- irreversible forms/workflows.

## 8. Context/project ownership

Browser Gateway is a capability, not the durable source of truth for business/project knowledge.

Authority routing:

- career/CV/interview/job-search -> `jagzao/interview_nail`;
- marketing/social/client/campaign -> `jagzao/Marketing`;
- project implementation/QA -> target repository;
- cross-project/global orchestration -> `jagzao/OrquestadorZao`.

Orquestador/caller should send a bounded `ContextBundle` with intent, source project, refs, sensitivity, allowed capabilities and approval policy. Never send raw secrets/session artifacts in the bundle.

Browser Gateway must not crawl entire repos on every action.

## 9. Interview Nail target workflow

V1 must be capable of supporting this scenario:

```text
Juan: busca trabajo
 -> Interview Nail provides verified CV/preferences context
 -> research/discovery finds candidate jobs
 -> Browser Gateway opens LinkedIn/job site
 -> if authenticated, continue
 -> if login required, headed Playwright + WAITING_FOR_USER
 -> Juan logs in/MFA
 -> Juan says "continúa"
 -> same task/session resumes
 -> research/extraction continues
 -> results returned to Interview Nail
 -> real submission remains approval-gated
```

The browser must not close while Juan is authenticating.

## 10. Marketing target workflow

Marketing remains source of truth for clients/campaigns/posts and should prefer official platform APIs for writes when stable APIs exist.

Browser Gateway provides:

- research/read workflows;
- authenticated inspection of Facebook/Meta/LinkedIn/etc.;
- UI-only admin actions not exposed by API;
- QA/verification;
- compatibility fallback.

Publishing is a side effect and remains approval/policy gated.

## 11. Deep Research architecture

Do not implement deep research as `LLM opens Google and browses randomly`.

Pipeline:

```text
research request
 -> decompose question/subquestions
 -> SearchProviderRouter discovers candidate sources
 -> rank authority/relevance/freshness/independence
 -> Browser Gateway reads sources (Obscura first, Playwright/auth fallback)
 -> Evidence Ledger records claim/source/locator/metadata
 -> iterative bounded gap search
 -> contradiction/adversarial pass in deep mode
 -> citation/evidence validation
 -> synthesis/report
```

Initial configurable discovery candidates:

- Brave Search API: broad default candidate;
- Exa: semantic/people/company/scholarly/code fallback;
- Gemini Grounding with Google Search: optional model-coupled discovery;
- Tavily: optional alternative if benchmarks justify it.

Provider selection must be configuration/benchmark-driven.

Research modes:

- `quick`: few sources, low budget;
- `standard`: multi-source verification;
- `deep`: decomposition, iterative evidence gathering, contradiction pass, stronger saturation criteria.

Every run has explicit budgets: search calls, pages, LLM calls/tokens, screenshots, wall-clock limits and estimated USD where possible.

Stop deterministically on evidence saturation, budget, success, or a real human/external block.

## 12. LLM routing

Initial configurable policy, not hard-coded domain behavior:

1. `deepseek-v4-flash` — high-volume browser operator/default candidate.
2. `gemini-3.8-flash` — escalation for ambiguous/long-horizon browser/research reasoning.
3. `gpt-5.6-luna` — alternate/fallback provider.
4. flagship/Codex Browser only for rare/manual escalation outside the normal cheap loop.

Routing triggers include provider error, repeated invalid action, confidence/policy threshold, ambiguous state and long-horizon task complexity.

Do not call all models for every step.

Primary cost-quality metric: **cost per successful completed task**, not raw token price.

## 13. Structured observations first

Prefer:

- semantic snapshot/DOM;
- accessibility/interactive-element data;
- extracted structured data;

before screenshots/vision.

Use screenshots/vision only when structured state is insufficient or visual fidelity is itself the requirement.

Track screenshot count and model/tool usage.

## 14. WebMCP policy

WebMCP is useful for owned web applications, but is still experimental/draft and is not a replacement for Browser Gateway on external websites.

Owned interactive apps should evaluate `ui.webmcp-agent-tools = ENABLED` when there are meaningful agent actions.

Rollout order:

1. Interview Nail pilot.
2. Marketing pilot.
3. Reusable React/Vue helper/package if pilot proves value.
4. Audit remaining owned interactive web apps.

Priority on owned pages:

1. existing stable application/API/MCP capability;
2. WebMCP semantic tool when available/allowed;
3. structured DOM/browser operation;
4. visual browser operation.

Browser Gateway should eventually detect/use allowed WebMCP tools on compatible pages but must not make them a hard dependency of core V1 browser execution.

## 15. Public interfaces required for usable V1

Keep application logic transport-neutral. Expose at least MCP and CLI; HTTP/API may be added if already natural in the repo.

Required capabilities conceptually:

- create/list/status/close browser sessions;
- start task;
- get task state;
- resume waiting task;
- cancel task;
- navigate/snapshot/extract/click/fill/screenshot;
- bootstrap authenticated session;
- validate/revoke persisted session;
- execute research quick/standard/deep;
- get execution/research telemetry;
- health/capability report for engines/providers.

Exact names may follow repository conventions.

## 16. Usability requirement

A developer on Juan's machine must be able to clone/pull the repo, configure documented prerequisites/secrets, run a setup/diagnose command and execute repeatable smoke flows without reading internal implementation code.

Provide:

- updated README/quickstart;
- `.env.example` with aliases/placeholders only;
- dependency lockfile/reproducible install;
- setup/diagnose scripts;
- Obscura install/run instructions or automated local bootstrap where reasonable;
- Playwright browser installation instructions;
- SecretProvider/session bootstrap instructions;
- example commands for public browsing, forced fallback, login pause/resume and deep research;
- troubleshooting for expected typed states.

The product is not `usable` if only tests know how to invoke it.

## 17. Observability

Every task/research run should produce structured evidence containing where applicable:

- task/correlation/session IDs;
- source project/context reference (non-secret);
- browser engine;
- model/provider;
- search provider;
- operations/actions;
- duration/p50/p95 aggregate support;
- retries/fallback count/reason;
- waiting-for-user transitions;
- screenshot count;
- token usage and estimated cost;
- success/failure/typed outcome;
- redacted error category.

Core product KPI: **% of browser tasks completed without Codex Browser/manual escalation**.

Secondary KPIs:

- Obscura success rate;
- Playwright fallback rate;
- human takeover frequency;
- auth rebootstrap frequency;
- cost/successful task;
- LLM calls/task;
- research sources/task;
- p50/p95 latency.

## 18. Known existing problems the agent must not ignore

Planning already found:

- current MCP server logs complete tool arguments; this risks leaking secrets/form values and must be redacted;
- current GitHub CI uses npm cache/npm-ci but repository lacks a dependency lockfile, so CI fails before compilation; reproducible dependency baseline must be fixed;
- current Playwright implementation holds singleton `browser/context/page` process variables; this is insufficient for multi-session persistent BrowserHost semantics;
- current session save/restore is not equivalent to keeping a live browser open while waiting for Juan;
- `playwright_fill` currently has LinkedIn-specific env credential replacement and returns the filled value in the result; this must be redesigned so secret values do not leak through tool results/logs;
- explicit `playwright_close` must not be called automatically on ordinary task/turn completion;
- Obscura and Playwright auth persistence are not assumed portable between engines.

Treat these as concrete migration/security requirements.

## 19. Implementation order for usable V1

The Project Lead should execute in dependency order, continuously unless a real human-only block occurs:

### Phase A — stable baseline

- fix dependency lock/CI baseline;
- redaction/security logging blocker;
- preserve backward compatibility and regression baseline.

### Phase B — US-001 browser gateway core

- domain/application contracts;
- typed outcomes;
- Obscura adapter/capability check;
- Playwright adapter over existing code;
- deterministic engine fallback;
- LLM operator abstraction/routing;
- safety gate;
- telemetry;
- MCP/CLI integration;
- smoke/forced fallback.

### Phase C — persistent BrowserHost + auth

- multi-session BrowserHost independent from request lifetime;
- activity/session state machine;
- `WAITING_FOR_USER -> RESUME` semantics;
- persistent headed Playwright takeover;
- SessionVault;
- SecretProvider;
- auth profile lifecycle/revocation/expiry;
- restart/recovery behavior.

### Phase D — Deep Research

- SearchProvider abstraction/router;
- Evidence Ledger;
- quick/standard/deep workflows;
- source ranking/saturation/contradiction/citation validation;
- budgets/cost telemetry;
- authenticated private-source path.

### Phase E — usable product surface

- clean MCP/CLI UX;
- setup/diagnose;
- README/quickstart;
- repeatable real smoke scenarios;
- example integration contract for Interview Nail/Marketing/Orquestador;
- optional WebMCP detection/adapter only where the implementation is stable and does not block core V1.

### Phase F — full validation + independent review

- complete mandatory test matrix;
- security/adversarial review;
- regression;
- operational usability test from clean setup;
- fix/retest loop until final state.

## 20. Mandatory validation matrix

For every applicable area, tests are explicit requirements rather than optional cleanup:

### Unit tests

- engine fallback policy;
- retry classification;
- typed outcomes;
- safety/approval policy;
- URL/private-network rules;
- redaction;
- session/task state machines;
- LLM/search routing;
- research ranking/saturation/budgets;
- WebMCP capability policy if implemented.

### Integration/contract tests

- Obscura adapter;
- Playwright adapter;
- MCP transport;
- BrowserHost/session registry;
- SessionVault encryption/read/write/revocation;
- SecretProvider contract with fake provider;
- SearchProvider contracts with fakes/recorded responses;
- telemetry pipeline.

### E2E

At minimum:

1. public DOM-readable browse/extract through Obscura;
2. deterministic forced fallback to Playwright;
3. both engines unavailable -> `manual_escalation_required`;
4. headed login simulation -> `WAITING_FOR_USER` -> same live session resumed;
5. saved auth state survives process restart and is reused;
6. expired/revoked auth produces typed reauth result;
7. deep research produces evidence-backed report;
8. side effect without approval is blocked even after engine fallback;
9. session A cannot access session B auth state;
10. transport/agent disconnect does not automatically close a waiting BrowserHost session.

### Smoke

Repeatable commands/scripts for:

- startup/health;
- public browse/extract;
- forced Playwright fallback;
- session bootstrap/status;
- wait/resume demo;
- research quick/deep demo using safe test targets/providers/fakes where external billing is undesirable.

### Regression

All existing critical Playwright/session/CLI/MCP behavior touched by the migration remains green or intentional breaking changes are explicitly approved/documented.

### Security/abuse

- secrets never appear in logs/results/traces;
- current LinkedIn credential handling leakage removed;
- SSRF/private/local targets blocked by default;
- prompt injection cannot request secrets/change routing/approve side effects;
- fallback cannot bypass policy;
- SessionVault isolation/revocation;
- malicious/invalid URLs/selectors/input handled safely;
- public CDP exposure prevented/documented;
- no hardcoded secrets.

### Failure/recovery

- Obscura crash/timeout;
- Playwright crash/timeout;
- provider unavailable/rate limited;
- task interrupted/reconnected;
- browser host lost while waiting -> safe typed recovery path;
- malformed session artifact;
- expired auth;
- research budget exhausted;
- partial evidence/contradictory sources.

### Persistence/restart

- durable session survives gateway restart;
- waiting task metadata survives coordinator restart where designed;
- live-browser loss is detected rather than pretending the same page survived;
- revocation persists.

### Human-in-the-loop

Prove the browser remains open while task is `WAITING_FOR_USER` and resumes only the correct activity/session on explicit continuation.

### Performance/cost/observability

Record baseline task latency/cost and ensure no unbounded loops. At minimum capture successful-task cost and fallback metrics for benchmark scenarios.

## 21. Validation/autofix loop

The agent must work autonomously:

```text
read master spec + US + architecture
 -> map AC to implementation/tests/evidence
 -> implement slice
 -> run relevant tests
 -> if fail: reproduce -> diagnose -> fix -> rerun
 -> next slice
 -> full UT/integration/E2E/smoke/regression/security
 -> independent review
 -> fix blocker/high
 -> rerun affected + regression
 -> operational usability smoke
 -> done | blocked | failed
```

Do not stop because the work takes many iterations. Do not ask Juan whether to run tests, build, refactor or continue to the next reversible implementation step.

Only pause for genuinely human-only dependencies such as MFA/login takeover, unavailable credential bootstrap, irreversible business decision or external outage that cannot be safely simulated.

When blocked on human takeover, preserve state and explicitly tell Juan what action to perform; after he says continue, resume without asking him to restate the task.

## 22. Definition of Usable V1

The project may be called `done/usable` only when:

- Obscura path is genuinely working for supported tasks;
- Playwright fallback genuinely works;
- browser lifecycle is independent from LLM turn lifetime;
- human login pause/resume is demonstrated without browser close;
- encrypted durable sessions work across restart;
- secrets are not leaked to Git/logs/tool output;
- research quick/standard/deep has evidence/citation support and bounded costs;
- MCP/CLI invocation is documented and usable by another agent/developer;
- safety/prompt-injection/SSRF/session-isolation gates are proven;
- required UT/integration/E2E/smoke/regression/security/failure/persistence/HITL tests are green;
- existing critical behavior regression is green;
- independent review has no blocker/high unresolved;
- README/setup/diagnostics are sufficient for Juan to run it locally;
- final report maps every acceptance area to concrete evidence.

If any of those is missing, do not call the product usable.

## 23. Cross-repo handoff

This repo must produce clean integration contracts, but OrquestadorZao remains owner of cross-project routing and capabilities.

After usable V1 is green here, OrquestadorZao Issue #20 integrates the gateway and routes Interview Nail/Marketing/target-project ContextBundles.

Interview Nail and Marketing then add their domain-specific adapters/WebMCP tools without duplicating browser infrastructure.

## 24. Agent kickoff contract

Juan should not need a mega-prompt in chat. This file **is** the mega-prompt.

Normal instruction:

`Ejecuta /project-lead sobre la tarea activa. Lee la Master Agent Memory y llévala de inicio a fin hasta done/blocked/failed.`

The agent must discover all details from Git memory/specs/docs and work continuously.