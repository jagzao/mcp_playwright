# Current Task

## Slug

`browser-gateway-usable-v1`

## Status

`ready`

## Source

`docs/user-stories/US-004-browser-gateway-usable-v1.md`

## Master memory

`.agents/memory/browser-gateway-master-spec.md`

## Branch

`feat/browser-gateway-mvp`

## Goal

Deliver a genuinely usable Browser Agent Gateway V1 on Juan's machine, not only a core abstraction.

The active deliver includes, in dependency order:

1. reproducible/secure baseline fixes;
2. Browser Gateway core / US-001;
3. persistent BrowserHost and human `WAITING_FOR_USER -> RESUME` behavior;
4. secure authenticated sessions + SecretProvider / US-002;
5. Deep Research + SearchProviderRouter + Evidence Ledger / US-003;
6. MCP/CLI setup/diagnostics/README and repeatable smoke flows;
7. WebMCP-ready capability boundary for owned web applications without making it a core external-site dependency;
8. full UT/integration/E2E/smoke/regression/security/failure/persistence/HITL/usability validation;
9. independent review + autofix/retest loop.

## Entry point

Run/use `/project-lead`.

The Project Lead **must first read**:

1. `AGENTS.md`;
2. this file;
3. `.agents/memory/browser-gateway-master-spec.md` completely;
4. `docs/user-stories/US-004-browser-gateway-usable-v1.md` completely;
5. all architecture/security/ADR docs referenced by them.

Do not ask Juan for the mega-prompt. Git is the source of truth.

## Current stage

`implementation-planning`

## Completion rule

Do not stop because US-001, US-002 or US-003 individually becomes green. Those are sub-scopes of this umbrella release.

Return exactly one state:

- `done` only when US-004 usable-V1 AC + applicable validation matrix + operational usability smoke are proven;
- `blocked` only for a genuinely human/external dependency, preserving resumable state when applicable;
- `failed` only after repeated diagnosis/fix cycles no longer make measurable progress and evidence explains why.

## Human-interaction reminder

If implementation/testing reaches a real login/MFA/user takeover flow:

- keep the headed Playwright BrowserHost open;
- set task/session to `WAITING_FOR_USER`;
- tell Juan the exact action required;
- after Juan says `continúa`, resume the correct same task/session without asking him to repeat the original request;
- continue the umbrella deliver automatically afterward.

## Cross-repo handoff after this repo is usable

After this release is complete and audited:

1. `jagzao/OrquestadorZao` Issue #20 integrates Browser Gateway as a shared CONTROL capability/context router.
2. Interview Nail consumes it for career/job-search flows and becomes the first WebMCP owned-app pilot.
3. Marketing consumes it for research/authenticated browser workflows and becomes the second WebMCP pilot.

Cross-repo implementation is a follow-on handoff, but this repository must expose/document the integration contracts needed for those projects.