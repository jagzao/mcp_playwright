# Known / Accepted Runtime Vulnerabilities

This document records runtime dependency vulnerabilities that remain open after
`npm audit fix` and the `@modelcontextprotocol/sdk` upgrade, with an explicit
justification for each. The CI **Security Audit gate** (`npm audit --omit=dev
--audit-level=high`) is a real gate: it fails on any high/critical runtime
finding. As of this writing it passes (exit 0) with only **moderate** runtime
findings remaining.

## Gate

- **Real gate:** `npm audit --omit=dev --audit-level=high` (fails on high/critical runtime deps).
- **Informational:** `npm audit` (full, including dev deps) — non-failing, for visibility.

## Remaining runtime findings (all moderate — non-blocking)

### 1. `qs` — DoS via array-limit bypass / isBuffer (moderate)

- **Advisories:** GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g
- **Path:** `express` → `body-parser` → `qs`
- **Justification:** `qs` is a transitive dependency of `express`, which is
  used only for the optional local HTTP/WS server surface. The Browser Gateway
  MCP transport runs over **stdio** (local, not exposed to a public network).
  The DoS requires an attacker to control query-string input to an HTTP server;
  the gateway's primary MCP surface is not HTTP. `npm audit fix` cannot clear it
  without a breaking `express` major upgrade. Accepted as moderate, non-blocking.

### 2. `uuid` — missing buffer bounds check in v3/v5/v6 (moderate)

- **Advisory:** GHSA-w5hq-g745-h8pq
- **Path:** `bull`, `exceljs`, `node-cron` (transitive)
- **Justification:** The vulnerable code path requires passing a caller-supplied
  `buf` to `uuid.v3/v5/v6`. The gateway does not use these UUID variants with
  caller-controlled buffers; it uses `randomBytes` for approval ids. The fix
  requires a breaking `bull` major upgrade. Accepted as moderate, non-blocking.

## Resolved

- **`@modelcontextprotocol/sdk` DNS-rebinding (HIGH, GHSA-w48q-cv73-mx4w):**
  **RESOLVED** by upgrading `@modelcontextprotocol/sdk` from `^0.5.0` to
  `^1.30.0`. The MCP server API (`Server`, `StdioServerTransport`,
  `CallToolRequestSchema`, `ListToolsRequestSchema`) is compatible; typecheck,
  build and unit tests pass. Additionally, the server runs over stdio (local
  transport), so DNS rebinding is not remotely exploitable in the default
  deployment.

## Policy

The Browser Gateway/MCP must not release with open **high/critical** runtime
findings without an explicit, documented exception. Moderate findings are
tracked here and re-evaluated on each dependency upgrade.
