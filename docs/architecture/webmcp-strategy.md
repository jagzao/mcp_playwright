# WebMCP Strategy

Status: exploratory/optional capability.

## What WebMCP is

WebMCP is a draft browser API that lets a web application register typed tools for AI agents through `document.modelContext`. It is page-scoped and browser-mediated. It is not the same thing as the MCP wire protocol, though bridges can expose WebMCP tools to MCP clients.

As of September 2026 it is a W3C Community Group draft, not a W3C Standard.

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
    -> Obscura first
    -> Playwright fallback
```

## Integration rule

Browser Gateway should eventually be able to detect WebMCP tools when visiting a compatible page and prefer them for supported operations, but WebMCP remains an optional capability adapter rather than a hard dependency.

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

## Adoption recommendation

Do not make WebMCP part of Browser Gateway US-001. Add support after the core browser/session lifecycle is stable.

Pilot it in one owned web project first (Interview Nail is the strongest candidate), measure whether it reduces DOM actions/tokens/failures, then standardize a reusable React/Vue helper if the result is positive.
