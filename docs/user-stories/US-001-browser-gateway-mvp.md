# US-001 — Browser Agent Gateway MVP

## Status

Ready for implementation

## User Story

**As** Juan and any authorized coding/automation agent in the CONTROL ecosystem,  
**I want** a shared browser gateway that uses Obscura as the preferred low-cost browser engine and automatically falls back to Playwright/Chromium when required,  
**so that** normal web research and browser automation no longer depend on the limited Codex built-in browser while preserving a reliable compatibility path.

## Business outcome

Reduce routine use of Codex Browser by moving navigation, DOM inspection, extraction and simple interaction to infrastructure we control, while measuring cost, latency, success rate and fallback frequency.

## Context

The repository already contains a working TypeScript/Node Playwright + MCP automation stack with session management, metrics, resilience and LLM integration. The MVP must evolve that codebase rather than rewrite it.

## Target architecture

```text
Client / Agent
      |
      v
Browser Gateway
      |
      +--> Session Manager
      +--> Approval / Safety Gate
      +--> LLM Router
      |      +--> DeepSeek V4 Flash      default target
      |      +--> Gemini 3.8 Flash       smart escalation target
      |      +--> GPT-5.6 Luna           alternate/fallback target
      |
      +--> Browser Engine Router
             +--> Obscura                preferred/default
             +--> Playwright/Chromium     compatibility fallback
             +--> manual escalation       if both fail
```

All models and priorities must be configuration, not hard-coded domain behavior.

## MVP scope

### 1. Browser engine abstraction

Create a provider-neutral contract supporting at least:

- create/close session;
- navigate;
- structured snapshot/DOM observation;
- click;
- fill/type;
- extract text/structured data;
- screenshot only when explicitly needed;
- health/capability reporting.

### 2. Obscura adapter

Add an Obscura adapter using its supported MCP/CDP integration path.

The implementation agent must verify the current Obscura integration contract against upstream documentation before coding it. Do not invent unsupported MCP method names.

### 3. Existing Playwright adapter

Wrap/reuse the repository's existing Playwright implementation behind the same browser-engine contract. Do not reimplement Playwright automation from scratch.

### 4. Automatic engine fallback

Default flow:

```text
Obscura
   |
   +-- success ----------------------> return result
   |
   +-- unsupported/error/timeout ----> Playwright
                                         |
                                         +-- success --> return result
                                         |
                                         +-- fail ----> manual_escalation_required
```

Fallback must be bounded and observable. No infinite retry/fallback loops.

### 5. LLM routing

Introduce a provider-neutral LLM operator interface suitable for tool-use/browser decisions.

Initial configurable policy:

1. `deepseek-v4-flash` — default high-volume browser operator.
2. `gemini-3.8-flash` — escalation for ambiguous/long-horizon browser reasoning.
3. `gpt-5.6-luna` — alternate/fallback provider.

The MVP does not need to call all three on every task. Escalation must be triggered by explicit conditions such as provider failure, invalid tool plan, repeated browser-action failure, or confidence/policy threshold.

### 6. Structured observations first

DOM/snapshot/tool data is the default observation format. Screenshots/vision are secondary and used only when structured data is insufficient.

### 7. Session isolation

Every browser task belongs to an explicit session identifier. Cookies/storage/auth state may persist inside that session but must not leak to unrelated sessions.

### 8. Safety gate

Classify browser actions into:

- read-only/reversible — may execute automatically;
- external side-effect — require explicit approval before execution.

Examples requiring approval: sending messages, submitting applications/forms with real-world effect, purchases, publishing content, destructive administrative changes.

### 9. Observability and cost

For every task capture at minimum:

- correlation/task ID;
- session ID (non-secret);
- selected browser engine;
- selected LLM provider/model;
- fallback reason and count;
- duration;
- success/failure;
- token usage when provider reports it;
- estimated LLM cost when pricing configuration is available;
- screenshot usage count;
- redacted error category.

Never log credentials, cookies, Authorization headers, API keys or sensitive page values.

### 10. Interfaces

The application layer must be transport-neutral. The MVP should expose the capability through the repository's MCP surface and keep it usable from CLI/tests without duplicating business logic.

## Acceptance Criteria

### AC1 — Obscura-first execution

Given a supported navigation/extraction task, when the gateway executes it, then Obscura is attempted first and the result records `engine=obscura` when successful.

### AC2 — Playwright fallback

Given a simulated or real Obscura unsupported/error/timeout condition, when the task is still eligible for automation, then the gateway attempts Playwright exactly as defined by the fallback policy and records the fallback reason.

### AC3 — Manual final escalation

Given both Obscura and Playwright fail, then the result is a typed `manual_escalation_required` outcome with diagnostics safe to show to another agent/user. The gateway must not pretend it can invoke Codex Browser itself.

### AC4 — Session isolation

Two independently created sessions must not share browser state unless an explicit future sharing feature is invoked. Automated tests must prove isolation at the gateway level.

### AC5 — Provider-neutral model routing

LLM provider/model selection is driven by configuration and interfaces. Unit tests can replace providers with fakes without network calls.

### AC6 — Cost-aware observation

For a normal DOM-readable page, the successful path must not require a screenshot. Telemetry records whether a screenshot was used.

### AC7 — Safety approval

An external side-effect action cannot execute without an approval token/decision in the request context. Unit tests prove the blocked and approved cases.

### AC8 — Security

Arbitrary navigation is validated by a URL/network policy. Private/local network access is denied by default unless explicitly allowed by trusted configuration. Secrets are redacted from logs.

### AC9 — Telemetry

Every completed task emits a structured execution summary containing engine, model/provider, duration, result status and fallback information.

### AC10 — Backward compatibility

Existing Playwright behavior used by current tests/CLI is not removed merely to introduce the gateway. Any intentional breaking change must be documented and approved.

### AC11 — Quality gates

The implementation passes:

```bash
npm run typecheck
npm run test:unit
npm run build
```

Relevant integration tests must also pass for browser/session/MCP changes.

### AC12 — Demonstration

Provide a repeatable smoke scenario that:

1. creates a session;
2. navigates to a safe public test page;
3. extracts structured content through Obscura when available;
4. demonstrates forced Playwright fallback using a deterministic test flag/fake capability response;
5. outputs the execution telemetry summary.

## Out of scope for US-001

- Replacing Chromium completely.
- Programmatically controlling the Codex built-in browser.
- Autonomous job applications, message sending or purchases.
- A web dashboard.
- Distributed session storage across multiple hosts.
- Full visual regression testing.
- Training/fine-tuning models.
- Rewriting the existing Playwright stack.
- Integrating Zavi Android directly; Zavi will consume the gateway later through the orchestrator/API.

## Suggested implementation slices

1. Domain contracts + typed outcomes.
2. Browser engine router + deterministic fallback policy.
3. Playwright adapter over existing implementation.
4. Obscura adapter + capability/health check.
5. Session isolation integration.
6. Safety approval gate.
7. LLM operator abstraction + configurable routing.
8. Telemetry/cost summary.
9. MCP/CLI integration.
10. Smoke/integration tests + docs.

## Definition of Done

All acceptance criteria are verified with evidence; automated quality gates pass; fallback and safety paths are tested; architecture docs reflect the implementation; the project lead produces a final report with measured results and limitations.
