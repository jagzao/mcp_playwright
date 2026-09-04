# AGENTS.md

This repository is evolving from a Playwright-only automation project into a shared **Browser Agent Gateway** for Juan's agent ecosystem.

## Source of truth

- Current MVP story: `docs/user-stories/US-001-browser-gateway-mvp.md`
- Architecture: `docs/architecture/browser-gateway.md`
- Project lead rules: `.agents/project-lead.md`
- Architecture decisions: `docs/adr/`

## Required workflow

1. Read the active User Story and architecture docs before editing code.
2. Inspect existing code and reuse working capabilities before creating replacements.
3. Produce a short implementation plan mapped to acceptance criteria.
4. Implement in small vertical slices.
5. Add or update tests with each slice.
6. Run typecheck, unit tests, relevant integration tests, and build before declaring done.
7. Report evidence: commands executed, results, remaining risks, and any fallback path not exercised.

## Non-negotiable rules

- Do not rewrite the existing Playwright stack just to introduce a new abstraction.
- Obscura is the preferred low-cost browser engine; Playwright/Chromium remains the compatibility fallback.
- The Codex built-in browser is an external/manual final fallback, not something this service can assume it can invoke programmatically.
- Browser engines and LLM providers must be behind interfaces/adapters. No provider-specific logic in domain/application code.
- Default browser work should prefer structured DOM/snapshots over screenshots when possible to reduce token cost.
- Sessions must be isolated. Never share cookies/storage between unrelated tasks or agents unless explicitly requested.
- Never log credentials, cookies, auth headers, API keys, or page secrets.
- Preserve SSRF/private-network protections when navigating arbitrary URLs.
- Cost, latency, retries, engine choice, model choice, and fallback reason must be observable.
- Human approval is required before irreversible external actions such as submitting applications, sending messages, purchases, destructive changes, or publishing content.
- Do not mark a story Done because code compiles. Acceptance criteria and quality gates are the definition of done.

## Quality gates

Minimum before completion:

```bash
npm run typecheck
npm run test:unit
npm run build
```

Run integration/E2E tests when the changed slice touches browser execution, sessions, MCP transport, or external providers.
