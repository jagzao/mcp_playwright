# browser-gateway-mvp

## Story

See `docs/user-stories/US-001-browser-gateway-mvp.md`.

## Architecture

See `docs/architecture/browser-gateway.md`.

## Key decisions

- Evolve this repository; do not create a parallel browser stack.
- TypeScript for MVP.
- Obscura preferred/default engine.
- Existing Playwright/Chromium implementation is the compatibility fallback.
- Codex Browser is external/manual final escalation only.
- LLM routing is configurable. Initial preference: DeepSeek V4 Flash -> Gemini 3.8 Flash -> GPT-5.6 Luna.
- Structured DOM/snapshots before screenshots.
- Session isolation, SSRF/private-network policy, secrets redaction and approval gates are mandatory.

## Definition of done

All AC in US-001 verified with evidence, quality gates green, fallback/safety paths tested, and final project-lead report produced.
