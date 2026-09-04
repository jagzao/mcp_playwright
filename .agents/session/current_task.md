# Current Task

## Slug

`browser-gateway-mvp`

## Status

`ready`

## Source

`docs/user-stories/US-001-browser-gateway-mvp.md`

## Branch

`feat/browser-gateway-mvp`

## Goal

Implement the Browser Agent Gateway MVP: Obscura-first browser automation, deterministic Playwright fallback, configurable LLM routing, isolated sessions, safety approval gates and cost/fallback observability.

## Entry point

Run/use the `project-lead` skill and treat US-001 acceptance criteria as the definition of done.

## Current stage

`implementation-planning`

## Follow-on roadmap (do not absorb into US-001 unless required by an AC)

1. Issue #2 / US-002 — secure authenticated sessions, SessionVault and SecretProvider.
2. Issue #3 / US-003 — Deep Research, SearchProviderRouter and Evidence Ledger.
3. `jagzao/OrquestadorZao` Issue #20 — register Browser Gateway and route bounded context from Interview Nail, Marketing and target projects.

Architectural docs to preserve while implementing US-001:

- `docs/security/secrets-and-authenticated-sessions.md`
- `docs/architecture/context-routing.md`
- `docs/architecture/deep-research.md`
