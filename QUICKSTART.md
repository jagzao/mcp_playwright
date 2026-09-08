# 🚀 Browser Agent Gateway — Get running in 5 minutes

This guide gets you from a fresh checkout to a working public-browse and research smoke in about 5 minutes.

## 1. Install dependencies

```bash
npm install
npx playwright install chromium
```

## 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at least:

```bash
MASTER_KEY=your-32-character-random-string-here   # 32+ chars, required for encrypted sessions
```

Optional (the gateway works without them, using Playwright fallback + offline research):

```bash
OBSCURA_MCP_COMMAND=            # enable Obscura as the primary engine
DEEPSEEK_API_KEY=               # LLM operator routing
SEARCH_BRAVE_API_KEY=           # Deep Research search provider
```

## 3. Verify readiness

```bash
npm run diagnose
```

This reports Obscura, Playwright, LLM/search provider and secret/session readiness — without leaking secrets. If it says Playwright chromium is missing, run `npx playwright install chromium`.

## 4. Run a public browse smoke

```bash
npm run smoke:gateway
```

This creates a session, reports health, navigates to `https://example.com` (falling back to Playwright when Obscura isn't configured), prints the execution telemetry, and runs an offline quick-research smoke.

## 5. Run a research smoke

```bash
npm run dev -- research "What is the Browser Agent Gateway?" --mode quick
```

The offline smoke uses a fake search provider, so no API key is needed. To use real search providers, set `SEARCH_BRAVE_API_KEY` (or `SEARCH_EXA_API_KEY` / `SEARCH_TAVILY_API_KEY`) and re-run.

## Next steps

- 📖 Read the [full README](README.md) for MCP tools, CLI commands, example flows and troubleshooting.
- 🔒 Learn about [secrets and authenticated sessions](docs/security/secrets-and-authenticated-sessions.md).
- 🧠 Read the [deep research architecture](docs/architecture/deep-research.md).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Playwright chromium is not installed` | Run `npx playwright install chromium` |
| `MASTER_KEY` too short | Set a 32+ character random string in `.env` |
| Research returns `no_search_provider_available` | Set a search API key, or use the offline smoke (fake provider) |
| Navigation returns `security_blocked` | Use a public `http(s)` URL (private/loopback is denied by default) |
| `approval_required` | A raw `click` or irreversible side effect needs human approval. A bare `approval: { approved: true }` is **never** enough. Run `npm run dev -- gateway:approval-pending`, then `npm run dev -- gateway:approve <pendingId>` to get a one-time token, and retry the exact action with it. See the README "Approval flow" section. |

## Approving a side-effect / raw-click action

Raw clicks and irreversible actions are never auto-executed. To approve one:

```bash
# 1. See what needs approval
npm run dev -- gateway:approval-pending

# 2. Approve the exact pending request (trusted human/operator action)
npm run dev -- gateway:approve <pendingId>
#   → prints a one-time token { approvalId, signature }

# 3. Retry the exact action with the token (approval.approvalId + approval.signature)
```

For safe navigation, prefer `follow_link` (navigates to a link's href without firing its `onclick` JS) over a raw `click`.

> **Headless → headed takeover** is **reconstructed continuity**: the gateway captures the URL + auth state, reopens headed, and restores them in a new browser/context. It is not a literal guarantee of the same `Page`/process. For critical authenticated workflows, start headed from the beginning.
