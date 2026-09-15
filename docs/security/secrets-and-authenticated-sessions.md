# Secrets and Authenticated Sessions

Status: proposed for Browser Gateway MVP.

## Goal

Allow authorized agents to work with protected sites and APIs without storing plaintext credentials in Git, prompts, logs or general agent memory.

The system distinguishes two different things:

1. **Secrets** — passwords, API keys, OAuth client secrets, service-account credentials, recovery codes.
2. **Authenticated browser state** — cookies, localStorage, IndexedDB/session artifacts created after a successful login.

They must not be handled the same way.

## Non-negotiable rule

No file committed to this repository may contain a real password, API key, cookie, Authorization header, MFA seed, recovery code or browser storage-state artifact.

Documentation may contain only **secret references/aliases**.

Example catalog entry:

```yaml
id: facebook.personal
purpose: Personal Facebook browser session bootstrap
secretProvider: bitwarden
secretRef: browser/facebook-personal
sessionProfile: facebook-personal
allowedDomains:
  - facebook.com
  - www.facebook.com
interactiveLoginPreferred: true
mfa: user_interactive
```

The catalog tells the system *where* a credential/session belongs. It never contains the credential value.

## Recommended secret-provider architecture

```text
Browser Gateway / Agent
        |
        v
   SecretProvider
    /     |      \
   v      v       v
Bitwarden Env   Future provider
(default) (dev)  (1Password/etc.)
```

### Initial recommendation

Use **Bitwarden Secrets Manager** as the preferred machine-secret provider because it supports machine accounts and a cross-platform CLI. Keep the integration behind `SecretProvider` so the product is not coupled to Bitwarden.

`EnvSecretProvider` is allowed only for local development/bootstrap and must never be treated as the long-term source of truth.

## Browser session strategy

For personal interactive accounts (Facebook, LinkedIn, Microsoft/Azure portals, Google, etc.) prefer **manual login bootstrap + persisted browser session** over giving passwords and MFA secrets to an LLM.

```text
User starts session bootstrap
        |
        v
Playwright headed browser
        |
   user logs in / MFA
        |
        v
Session Vault encrypts engine-specific auth state
        |
        +--> Playwright sealed storage state
        +--> Obscura sealed storage directory/state
        |
        v
future agent task reuses logical session profile
```

### Why engine-specific state

Obscura and Chromium/Playwright do not currently have identical persistence contracts. The Gateway exposes one logical `SessionProfile`, but the Session Vault may keep separate encrypted artifacts per engine.

The agent must never assume a Playwright `storageState` file is directly portable to Obscura.

## Session Vault

`SessionVault` is responsible for:

- encrypted-at-rest browser state;
- per-profile and per-engine isolation;
- expiry/last-validation metadata;
- atomic read/write;
- revocation;
- rotation after reauthentication;
- never returning raw state to the LLM.

Suggested metadata (safe to persist):

```json
{
  "profileId": "facebook-personal",
  "engine": "playwright",
  "domains": ["facebook.com"],
  "createdAt": "...",
  "lastValidatedAt": "...",
  "status": "healthy",
  "artifactRef": "vault://browser-sessions/facebook-personal/playwright"
}
```

`artifactRef` resolves inside trusted infrastructure. It is not a filesystem path exposed to agents.

## Authentication lifecycle

Session states:

```text
missing
  -> bootstrap_required
  -> healthy
  -> degraded
  -> reauthentication_required
  -> healthy
  -> revoked
```

If a site requests CAPTCHA, MFA, password confirmation or suspicious-login verification, automation must return `reauthentication_required` or `user_interaction_required`. It must not attempt to bypass the challenge.

## Permission boundary

Each `SessionProfile` defines:

- allowed domains;
- allowed task categories;
- read-only vs side-effect permissions;
- whether publication/message/submission requires approval;
- which agents/projects may request it.

Example:

```yaml
profileId: facebook-personal
allowedCallers:
  - OrquestadorZao
  - Marketing
permissions:
  read: allow
  draft: allow
  publish: approval_required
  message: approval_required
  account_security_change: deny
```

Possession of an authenticated session is **not** permission to perform every action available in that account.

## Logging and telemetry

Never log:

- secret values;
- cookies;
- full storage state;
- Authorization headers;
- password/form values;
- MFA or recovery data.

Allowed telemetry includes:

- secret alias/id (not value);
- session profile id;
- engine;
- domain;
- auth status (`healthy`, `reauthentication_required`, etc.);
- operation category;
- approval decision id;
- timestamps and latency.

The existing MCP logger that records complete tool arguments is a security blocker and must be replaced with structured redacted metadata.

## Secret catalog — initial aliases

This is a catalog of expected references, NOT credentials.

| Alias | Owner/use | Preferred mechanism |
|---|---|---|
| `llm.deepseek` | Browser operator API | SecretProvider |
| `llm.gemini` | escalation/research | SecretProvider |
| `llm.openai` | alternate escalation | SecretProvider |
| `search.brave` | web discovery | SecretProvider |
| `search.exa` | semantic/deep search fallback | SecretProvider |
| `marketing.meta` | Facebook/Instagram official APIs | SecretProvider / Marketing project |
| `marketing.linkedin` | LinkedIn API where supported | SecretProvider / Marketing project |
| `browser.facebook.personal` | personal Facebook interactive access | SessionProfile, manual bootstrap preferred |
| `browser.linkedin.personal` | personal LinkedIn interactive access | SessionProfile, manual bootstrap preferred |
| `browser.microsoft.personal` | Microsoft/Azure portal interactive access | SessionProfile, manual bootstrap preferred |

Actual aliases may be renamed by the implementation, but real values never go in this document.

## Repository hygiene

Required:

- `.env*` with real values ignored;
- browser auth directories ignored;
- encrypted artifacts ignored unless explicitly stored in a dedicated external vault;
- dependency lockfile MUST be committed (do not ignore `package-lock.json` once the project uses npm reproducibly);
- secret scanning in CI;
- no screenshots/traces containing sensitive pages uploaded as CI artifacts by default.

## Definition of done for authenticated browsing

A protected-site capability is not considered complete until tests prove:

1. session state survives a process restart;
2. unrelated sessions cannot read it;
3. switching engines cannot bypass permissions;
4. logs contain no session material or form secrets;
5. expired auth returns a typed reauthentication outcome;
6. revocation makes the stored session unusable;
7. an external side effect still requires approval even with a valid session.
