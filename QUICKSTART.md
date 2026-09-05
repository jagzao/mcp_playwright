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
