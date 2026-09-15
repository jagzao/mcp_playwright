# Browser Agent Gateway — Target Architecture

## Purpose

Turn the existing Playwright/MCP automation project into a shared browser capability for Juan, coding agents, OrquestadorZao and future Zavi integrations.

The gateway owns **routing, sessions, safety, cost and observability**. Browser engines and LLM providers are replaceable adapters.

## Why TypeScript for the MVP

This repository already uses Node 20, TypeScript, the MCP SDK, Playwright, Vitest, Redis and existing browser/session infrastructure. Obscura is consumed as an external browser/MCP/CDP capability, so introducing Python or .NET would add a second runtime without solving an MVP requirement.

Python remains a valid future choice for a separate AI-heavy service if one emerges. .NET remains a valid future choice for enterprise integrations, but neither justifies rewriting the current browser stack.

## Logical components

```text
                    Clients
        Codex / OpenCode / Project Lead / CLI
                       |
                       v
                Transport adapters
                  MCP / CLI / API
                       |
                       v
                BrowserGateway
       +---------------+----------------+
       |               |                |
       v               v                v
 SessionManager    SafetyGate       Telemetry
       |                                |
       +---------------+----------------+
                       |
                       v
               BrowserEngineRouter
                 /             \
                v               v
          ObscuraEngine   PlaywrightEngine
              default          fallback
                       |
                       v
                   Web target

BrowserGateway also collaborates with an LLMOperatorRouter for tasks that
require model-driven planning/decision making.
```

## Target module structure

```text
lib/browser-gateway/
  domain/
    browser-engine.ts
    browser-task.ts
    browser-result.ts
    browser-session.ts
    approval.ts
  application/
    browser-gateway.ts
    browser-engine-router.ts
    fallback-policy.ts
    llm-operator-router.ts
    safety-gate.ts
  infrastructure/
    engines/
      obscura/
      playwright/
    llm/
      deepseek/
      gemini/
      openai/
    telemetry/
    security/
  index.ts

tests/
  unit/browser-gateway/
  integration/browser-gateway/
```

The implementation may adapt this shape to existing repository conventions, but dependency direction must remain domain/application -> interfaces, infrastructure -> implementations.

## Core contracts

### BrowserEngine

Must expose capabilities rather than forcing every engine to pretend it supports identical browser behavior. Expected concepts:

- `createSession`
- `closeSession`
- `navigate`
- `snapshot`
- `click`
- `fill`
- `extract`
- `screenshot`
- `health`
- `capabilities`

### Browser result

Every operation returns a typed result rather than relying on thrown strings. Results must distinguish at least:

- success;
- unsupported capability;
- timeout/transient failure;
- security policy blocked;
- approval required;
- provider unavailable;
- final/manual escalation required.

## Fallback policy

Fallback is policy, not exception spaghetti.

Initial engine order:

1. Obscura.
2. Playwright/Chromium.
3. Typed manual escalation.

The router must understand whether an error is retryable, engine-specific, security-related or approval-related. Security/approval blocks must never be bypassed by switching engines.

## LLM policy

Initial configurable preference:

1. DeepSeek V4 Flash — high-volume operator.
2. Gemini 3.8 Flash — reasoning escalation.
3. GPT-5.6 Luna — alternate provider/fallback.

The router owns provider choice. Browser engines do not know which model is in use.

## Sessions

A gateway session is the isolation boundary for:

- cookies;
- local/session storage;
- browser context;
- target history;
- agent task metadata.

Session IDs may be logged. Session secrets and browser state must not be logged.

## Safety

Navigation policy denies local/private targets by default. Side-effect actions require approval. Switching from Obscura to Playwright must not weaken the safety policy.

## Observability

Emit one structured execution summary per task plus optional spans per operation.

Important dimensions:

- task/session/correlation IDs;
- engine;
- LLM provider/model;
- operation;
- duration;
- retries;
- fallback reason;
- token usage/cost estimate;
- screenshot count;
- outcome category.

The key product metric for the first phase is:

**percentage of browser tasks completed without Codex Browser/manual escalation.**

Secondary metrics:

- Obscura success rate;
- Playwright fallback rate;
- cost/task;
- p50/p95 latency;
- LLM calls/task;
- screenshots/task.

## Integration with OrquestadorZao and Zavi

Browser Gateway remains an independent capability. OrquestadorZao may route tasks to it. Zavi Android should not embed Obscura; a future Zavi integration calls the gateway through the orchestrator/network boundary.
