# ADR-001 — Use TypeScript for the Browser Gateway MVP

## Status

Accepted

## Context

The Browser Gateway could be implemented in .NET, Python or TypeScript. The existing repository already contains:

- Node 20 + TypeScript;
- MCP SDK integration;
- Playwright automation;
- session management;
- resilience utilities;
- logging/metrics;
- Vitest/Playwright tests.

Obscura is intended to be consumed as an external engine through MCP/CDP rather than embedded as an application library.

## Decision

Implement the MVP in **TypeScript inside the existing `mcp_playwright` repository**, evolving it into a multi-engine Browser Agent Gateway.

## Why not Python now

Python is excellent for greenfield AI/agent services and would be a reasonable default if no implementation existed. In this project it would introduce a second runtime and require rebuilding browser/session/telemetry capabilities already present in TypeScript.

Python remains acceptable for a future independent AI-heavy component when a concrete requirement justifies it.

## Why not .NET now

.NET would provide strong service/runtime characteristics and fits Juan's backend expertise, but MCP/browser automation integration would require more adaptation while offering little MVP advantage over the existing TypeScript stack.

.NET remains acceptable for future enterprise/control-plane integration if required.

## Consequences

### Positive

- fastest path to a working MVP;
- maximum reuse of current Playwright code;
- native fit with the repository's MCP SDK and tests;
- lower migration risk;
- one runtime for current browser infrastructure.

### Negative

- the service remains coupled operationally to Node.js;
- Python-specific agent libraries are not directly available without an external service;
- architecture must be disciplined so future provider/engine extraction remains possible.

## Revisit when

Reconsider this ADR only if one of these becomes true:

- the gateway requires an AI library available only/practically in Python;
- throughput/runtime requirements justify moving a service boundary;
- enterprise integration strongly favors .NET;
- the existing TypeScript stack is intentionally retired.
