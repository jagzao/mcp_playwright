# 🤖 Browser Agent Gateway

A locally runnable **Browser Agent Gateway** for Juan's agent ecosystem. It gives coding agents, Interview Nail, Marketing and OrquestadorZao a controlled browser/research capability without depending on the limited Codex built-in browser.

> **Obscura-first, Playwright fallback.** Normal machine-driven browser work prefers the low-cost **Obscura** engine. When Obscura is unavailable or a human must take over (login / MFA / CAPTCHA), the gateway deterministically falls back to a persistent **Playwright/Chromium** session.

## What the gateway provides

- **Obscura-first browsing** — cheap structured DOM/snapshot-first observation through the Obscura engine (configured via `OBSCURA_MCP_COMMAND`).
- **Playwright fallback** — a compatibility engine that reuses the existing Playwright automation. Also the engine used for human takeover.
- **Persistent BrowserHost** — browsers stay open across turns. A session is only closed by an explicit close, never on task/turn completion.
- **Durable authenticated sessions** — encrypted-at-rest browser auth state (AES-256-GCM) via the `SessionVault`, with profile/domain isolation, expiry, validation and revocation.
- **Deep Research** — quick / standard / deep evidence-backed research through a provider-neutral `SearchProviderRouter` + Browser Gateway + Evidence Ledger, with bounded budgets.
- **Stable MCP + CLI surface** — the same application logic is exposed over both transports (no duplicated business logic).
- **Observability** — every task emits structured telemetry (engine, model/provider, fallback count/reason, duration, screenshot count, cost).

---

## Prerequisites

- **Node.js >= 20** ([nodejs.org](https://nodejs.org/))
- **Playwright chromium browser** — `npx playwright install chromium`
- **Obscura** (optional) — set `OBSCURA_MCP_COMMAND` to enable the primary engine. Without it, the gateway uses the Playwright fallback (still fully usable).
- **MASTER_KEY** — a 32+ character random string. Required for durable encrypted sessions (`SessionVault`).
- **LLM provider API keys** (optional) — `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY` for browser-operator LLM routing.
- **Search provider API keys** (optional) — `SEARCH_BRAVE_API_KEY`, `SEARCH_EXA_API_KEY`, `SEARCH_TAVILY_API_KEY` for Deep Research. Offline smoke uses a fake provider, so no key is required to try research.

---

## Install & setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#   - Set MASTER_KEY to a 32+ char random string
#   - Optionally set OBSCURA_MCP_COMMAND and provider API keys

# 3. Install the Playwright chromium browser
npx playwright install chromium

# 4. Compile TypeScript
npm run build

# 5. Verify readiness
npm run diagnose
```

`npm run diagnose` reports the readiness of Obscura, Playwright, LLM/search providers and the secret/session infrastructure — **without leaking any secret values**.

---

## MCP tools

The gateway is exposed as MCP tools (all prefixed `gateway_`). These are thin transport adapters over the same application logic.

### Sessions & execution

| Tool | Purpose |
| --- | --- |
| `gateway_create_session` | Create (or fetch) an isolated browser gateway session. |
| `gateway_health` | Report gateway and engine health/capabilities. |
| `gateway_execute` | Execute a browser task (Obscura first, Playwright fallback, safety + SSRF enforced). |
| `gateway_close_session` | Close an isolated browser gateway session. |

### Persistent BrowserHost / human-in-the-loop

| Tool | Purpose |
| --- | --- |
| `gateway_host_create_session` | Create a persistent BrowserHost session (browser stays open across turns). |
| `gateway_suspend_for_user` | Suspend a session for a human (login/MFA/CAPTCHA). Browser stays open; returns a resumable checkpoint. |
| `gateway_resume` | Resume a suspended session from its checkpoint (reconstructed continuity — see note below). |
| `gateway_list_waiting` | List sessions currently waiting for a human. |
| `gateway_session_status` | Report the status of a BrowserHost session. |
| `gateway_host_close_session` | Explicitly close a persistent BrowserHost session (always wins). |

### Durable authenticated sessions (SessionVault)

| Tool | Purpose |
| --- | --- |
| `gateway_session_register_profile` | Register a `SessionProfile` (allowed domains, permissions, approval policy). |
| `gateway_session_bootstrap` | Bootstrap a durable authenticated session. Returns a typed outcome (`healthy` \| `bootstrap_required` \| `user_interaction_required`). |
| `gateway_session_validate` | Validate a persisted session. Returns a typed outcome (`healthy` \| `reauthentication_required` \| `bootstrap_required` \| `revoked`). |
| `gateway_session_revoke` | Revoke a persisted session, making it unusable. |
| `gateway_vault_status` | Report safe SessionVault metadata (status, domains, timestamps, artifactRef). Never returns raw auth state. |

### Deep Research

| Tool | Purpose |
| --- | --- |
| `gateway_research` | Run quick/standard/deep web research through SearchProviderRouter + Browser Gateway + Evidence Ledger. Bounded budgets enforced deterministically. |

---

## CLI commands

The same capabilities are available from the command line (all prefixed `gateway:`).

### Persistent BrowserHost / human-in-the-loop

```bash
npm run dev -- gateway:host-create <sessionId> [--headed]
npm run dev -- gateway:suspend <sessionId> <reason> [--activity <id>] [--instructions <text>]
npm run dev -- gateway:resume <sessionId> <checkpointId>
npm run dev -- gateway:waiting
npm run dev -- gateway:status <sessionId>
npm run dev -- gateway:host-close <sessionId>
```

### Durable authenticated sessions

```bash
npm run dev -- gateway:session-register <profileId> [--domains a.com,b.com] [--interactive] [--max-age <ms>]
npm run dev -- gateway:session-bootstrap <profileId> <engine>        # engine: playwright|obscura
npm run dev -- gateway:session-validate <profileId> <engine>
npm run dev -- gateway:session-revoke <profileId> <engine>
npm run dev -- gateway:session-status <profileId> <engine>
```

### Deep Research

```bash
npm run dev -- research "<question>" [--mode quick|standard|deep] [--session <id>] [--max-search <n>]
```

> The `npm run dev` script runs the console client with `tsx watch`. You can also invoke the compiled client directly with `npm start -- <command> ...`.

---

## Example flows

### Public browse (Obscura-first, Playwright fallback)

```bash
npm run smoke:gateway
```

This creates a session, reports health, navigates to `https://example.com` (falling back to Playwright when Obscura isn't configured), prints the execution telemetry, and runs an offline quick-research smoke.

### Forced fallback

When `OBSCURA_MCP_COMMAND` is unset, the gateway deterministically falls back to Playwright exactly once and records the reason in telemetry (`fallbackCount: 1`, `fallbackReason: provider_unavailable`). The smoke script demonstrates this path.

### Auth bootstrap

```bash
# Register a profile for a protected site
npm run dev -- gateway:session-register linkedin --domains linkedin.com --interactive

# Bootstrap a durable session (returns a typed outcome)
npm run dev -- gateway:session-bootstrap linkedin playwright
#   → healthy | bootstrap_required | user_interaction_required

# Validate / revoke later
npm run dev -- gateway:session-validate linkedin playwright
npm run dev -- gateway:session-revoke linkedin playwright
```

### Session status / reuse

```bash
npm run dev -- gateway:status <sessionId>          # live BrowserHost session
npm run dev -- gateway:session-status <profileId> <engine>   # persisted auth metadata
```

### Wait / resume (human takeover)

```bash
# 1. Create a headed persistent session
npm run dev -- gateway:host-create my-task --headed

# 2. Suspend for a human (login/MFA/CAPTCHA). Browser stays open.
npm run dev -- gateway:suspend my-task "login required" --instructions "Sign in manually"

# 3. List waiting sessions
npm run dev -- gateway:waiting

# 4. Resume from the checkpoint (reconstructed continuity — see note below)
npm run dev -- gateway:resume my-task <checkpointId>
```

> **Note on headless → headed takeover (reconstructed continuity):** when a session is promoted from headless to headed for a human takeover, the gateway does **not** guarantee the literal same `Page`/process survives. It captures the useful page URL + auth state, closes the headless browser, reopens headed, and restores the URL + storage. This is **reconstructed continuity** — the same logical task/session continues, but it is a new browser/context. For critical authenticated workflows that will need human takeover, start the session headed from the beginning.

### Research quick / standard / deep

```bash
npm run dev -- research "What is the Browser Agent Gateway?" --mode quick
npm run dev -- research "Compare Playwright and Obscura for browser automation" --mode standard
npm run dev -- research "Deep dive: SSRF protections in browser automation" --mode deep
```

---

## Approval flow (side effects & raw clicks)

A raw `click` and any irreversible external side effect (`submit`, `send`, `publish`) are **never** auto-executed. A bare `approval: { approved: true }` on a task is **not** trusted and is always rejected — a hostile agent could self-approve any side effect. Instead, the gateway uses a **trusted, one-time human approval workflow**:

```text
approval_required -> pending approval -> trusted human/operator approval
  -> one-time token -> execute the exact approved action once
```

1. **Task is blocked.** `gateway_execute` returns `status: "blocked"`, `category: "approval_required"`, and a `pendingId` (the pending approval created for the exact task/session/action/target).
2. **Operator lists pending approvals** (local control-plane, not exposed to MCP callers):
   ```bash
   npm run dev -- gateway:approval-pending
   ```
3. **Trusted human/operator approves** the exact pending request and receives a **one-time token**:
   ```bash
   npm run dev -- gateway:approve <pendingId>
   # prints: One-time token: { "approvalId": "...", "signature": "..." }
   ```
   The token is bound to the exact `taskId`/`sessionId`/`actionType`/`target`, expires after a TTL, and can be revoked. It is **one-time** — replaying it is rejected.
4. **Retry the exact action** with the token:
   ```json
   {
     "taskId": "...",
     "sessionId": "...",
     "action": { "type": "click", "target": "#delete-account" },
     "approval": { "approved": true, "approvalId": "<approvalId>", "signature": "<signature>" }
   }
   ```
   The action executes **exactly once**. The same token cannot approve a different target/task/session, and cannot be replayed.

> **Security:** the `approve` step is only reachable through the local operator CLI (`gateway:approve`). The MCP `gateway_execute` surface only *verifies* tokens — an untrusted MCP caller can never self-approve.

### Safe navigation: use `follow_link`, not raw `click`

Because a raw `click` can fire a page's `onclick` JavaScript (which may perform an irreversible action even on a link that *looks* like navigation), raw clicks are always approval-required. For **safe, reversible navigation**, use the dedicated semantic action `follow_link`, which resolves a link's `href` and navigates **without** firing the element's `onclick` JS:

```json
{ "type": "follow_link", "href": "https://example.com/about" }
```

`follow_link` is read-only/reversible and auto-allowed (subject to the SSRF/private-network policy). Prefer it over `click` whenever you only need to follow a link.

---

## Troubleshooting typed outcomes

The gateway returns **typed outcomes** you can branch on. Here is what each means and what to do.

| Outcome | Meaning | What to do |
| --- | --- | --- |
| `bootstrap_required` | No persisted authenticated session exists for this profile/engine. | Run `gateway:session-bootstrap` (or `gateway_session_bootstrap`). |
| `reauthentication_required` | The persisted session is expired or the live browser was lost. | Re-authenticate: suspend for a human and resume, or re-bootstrap. |
| `user_interaction_required` | A human must intervene (login/MFA/CAPTCHA). | Use the wait/resume flow (`gateway:suspend` → human acts → `gateway:resume`). |
| `manual_escalation_required` | Both controlled engines could not complete the task. | The task needs manual handling; the gateway never pretends the Codex browser was invoked. |
| `security_blocked` | Navigation was denied by the network/SSRF policy (e.g. private/loopback target). | Use a public `http(s)` URL, or explicitly allow private network if appropriate. |
| `approval_required` | An irreversible external side-effect (or any raw `click`) requires human approval. | Use the real approval flow below — a bare `approval: { approved: true }` is **never** sufficient. |

---

## Security notes

- **Secrets are never logged.** API keys, cookies, auth headers, form values and browser-state artifacts are redacted from logs and tool results.
- **SSRF denied by default.** Private/loopback/link-local targets are blocked at the trusted navigation policy level, regardless of engine.
- **Session isolation.** Browser/auth state for one session is never shared with another unless an explicit future policy authorizes it.
- **Approval gates.** Irreversible external actions (submit, send, publish) require explicit approval and cannot be bypassed by switching engines/models/providers.
- **Page content is untrusted.** A hostile page cannot expand tool permissions, request secrets, change routing or approve side effects.
- **Durable auth is encrypted at rest** (AES-256-GCM) and only opaque `artifactRef` values are returned to callers — never raw auth state.

---

## Project structure

```
mcp_playwright/
├── mcp-server/           # MCP server (gateway_* tools + legacy playwright_* tools)
├── console-client/       # CLI (gateway:* commands, research, agent, record, replay)
├── lib/browser-gateway/  # Gateway domain/application/infrastructure
│   ├── domain/           # Contracts: engine, task, result, session, vault
│   ├── application/      # BrowserGateway, BrowserHost, ResearchAgent, routers, policies
│   └── infrastructure/   # Obscura/Playwright engines, SessionVault, secret/search providers
├── scripts/              # diagnose, gateway-smoke, setup helpers
├── tests/unit/           # Unit tests (incl. browser-gateway/)
└── docs/                 # Architecture, security, user stories
```

## Development

```bash
npm run typecheck          # TypeScript type check
npm run test:unit          # Unit tests
npm run build              # Compile TypeScript
npm run diagnose           # Readiness diagnostics
npm run smoke:gateway      # Repeatable gateway smoke
```

## License

MIT — see [LICENSE](LICENSE).
