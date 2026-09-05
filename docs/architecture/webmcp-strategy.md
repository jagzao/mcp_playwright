# WebMCP Strategy

Status: recommended capability with staged adoption; experimental browser feature.

## What WebMCP is

WebMCP is a draft browser API that lets a web application register typed tools for AI agents through `document.modelContext`. It is page-scoped and browser-mediated. It is not the same thing as the MCP wire protocol, though bridges can expose WebMCP tools to MCP clients.

As of September 2026 it is a W3C Community Group draft and Chrome exposes it through an origin trial/testing path, so it must not be treated as a universally available production dependency yet.

## Policy for Juan's projects

WebMCP becomes a **standard recommended capability** for owned interactive web applications, not an unconditional requirement for every repository/page.

### Default classification

- Interactive owned SPA/web app with meaningful agent actions -> `ENABLED` / recommended.
- New owned interactive web app -> design WebMCP readiness from the beginning when useful tools can be identified.
- Existing interactive web app -> assess and adopt incrementally; do not block unrelated delivery merely to retrofit WebMCP everywhere.
- Static marketing/landing/docs-only site -> usually `NOT_APPLICABLE` unless there is a concrete agent workflow.
- Backend/API/library/mobile-only project -> `NOT_APPLICABLE`.
- A project may mark it `REQUIRED` only through explicit project policy after the capability proves stable and valuable for that project.

This policy avoids a mass migration to an experimental browser API while making agent-friendly interfaces a default architectural consideration going forward.

## Where it helps us

WebMCP is most valuable on web applications we own because the application can expose stable semantic actions instead of forcing agents to scrape/click the DOM.

Examples:

- Interview Nail web UI: `search_jobs`, `get_profile_summary`, `prepare_application_draft`, `resume_waiting_browser_task`.
- Marketing web UI: `list_clients`, `draft_post`, `schedule_post`, `get_campaign_metrics`.
- SaaS Store/admin apps: domain-specific CRUD/workflow tools.
- Portfolio/homelab web apps: read-only agent-facing navigation/inspection tools where useful.

WebMCP should not be added mechanically to every page. Expose only actions that have clear agent value, validation, authorization and audit semantics.

## Where it does NOT replace Browser Gateway

External sites we do not control (LinkedIn, Facebook, Azure portal, job boards, vendor dashboards) will usually not expose the tools we need. For those, Browser Gateway still uses Obscura/Playwright and authenticated sessions.

```text
Owned app with WebMCP
    -> semantic page tools first
    -> DOM/browser fallback only when necessary

External app
    -> Browser Gateway
    -> Obscura for normal machine-driven work
    -> Playwright for compatibility/human takeover
```

## Integration rule

Browser Gateway should eventually be able to detect WebMCP tools when visiting a compatible owned page and prefer them for supported operations, but WebMCP remains an optional capability adapter rather than a hard dependency.

Proposed engine/tool priority for owned pages:

1. direct application/API/MCP capability when already available;
2. WebMCP page tool;
3. structured browser/DOM operation;
4. visual browser operation.

This avoids duplicating stable backend APIs in the browser merely for agent access.

## Security

- Page-provided tools are untrusted capability descriptions until allowed by gateway/orchestrator policy.
- A WebMCP tool cannot grant itself more permissions than the current `ContextBundle`/Capability Matrix allows.
- Side-effect tools still require approval where policy requires it.
- Tool outputs are page content and therefore remain subject to prompt-injection boundaries.
- Tool registration must not expose secrets or privileged functions merely because the current user is authenticated.

## Adoption sequence

1. Stabilize Browser Gateway core and persistent browser lifecycle.
2. Pilot WebMCP in Interview Nail because it has clear agent workflows and human/browser handoff requirements.
3. Measure DOM actions avoided, LLM/tool calls, tokens, latency, failures and developer complexity.
4. Pilot Marketing second for content/client/campaign actions.
5. If both pilots are positive, extract a reusable React/Vue helper/package and an OrquestadorZao capability template.
6. Audit the remaining owned web apps and classify each as `ENABLED`, `DISABLED` or `NOT_APPLICABLE`; retrofit only where value is concrete.

Do not implement WebMCP in every existing project simultaneously. Prove the convention first, then roll it out systematically.
