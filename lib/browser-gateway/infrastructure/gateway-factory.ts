import { BrowserGateway, type GatewayOptions } from '../application/browser-gateway.js';
import { BrowserHost, type BrowserHostOptions } from '../application/browser-host.js';
import { LlmOperatorRouter } from '../application/llm-operator-router.js';
import { HmacApprovalRegistry, type ApprovalRegistry } from '../application/approval-registry.js';
import { FileApprovalRegistry } from './approval-registry-file.js';
import { ObscuraEngine } from './engines/obscura/obscura-engine.js';
import { PlaywrightEngine } from './engines/playwright/playwright-engine.js';
import { PlaywrightBrowserRuntime } from './engines/playwright/playwright-browser-runtime.js';
import { createEnvOperators } from './llm/env-operators.js';
import { FileSessionVault } from './session-vault.js';
import { SessionVaultPersistAuth } from './session-vault-persist-auth.js';
import { isValidMasterKey } from '../../security/secret-resolver.js';
import type { SessionVault } from '../domain/session-vault.js';
/**
 * Factory that wires a ready-to-use gateway from configuration. Transport
 * layers (MCP, CLI) consume this so business logic is not duplicated.
 */
export function createGateway(overrides?: Partial<GatewayOptions>): BrowserGateway {
  const primary = overrides?.primaryEngine ?? new ObscuraEngine();
  const fallback = overrides?.fallbackEngine ?? new PlaywrightEngine();

  const envOps = createEnvOperators();
  const llmRouter =
    overrides?.llmRouter ??
    new LlmOperatorRouter({
      primary: envOps.primary,
      escalation: envOps.escalation,
      alternate: envOps.alternate,
    });

  const options: GatewayOptions = {
    primaryEngine: primary,
    fallbackEngine: fallback,
    llmRouter,
    requireApprovalForSideEffects:
      process.env.BROWSER_REQUIRE_APPROVAL_FOR_SIDE_EFFECTS !== 'false',
    approvalRegistry: createApprovalRegistry(),
  };

  if (overrides?.safetyGate) options.safetyGate = overrides.safetyGate;
  if (overrides?.networkPolicy) options.networkPolicy = overrides.networkPolicy;
  if (overrides?.telemetry) options.telemetry = overrides.telemetry;
  if (overrides?.requireApprovalForSideEffects !== undefined) {
    options.requireApprovalForSideEffects = overrides.requireApprovalForSideEffects;
  }
  if (overrides?.approvalRegistry) options.approvalRegistry = overrides.approvalRegistry;

  return new BrowserGateway(options);
}

/**
 * Create the default approval registry. Prefers the file-backed registry so the
 * operator CLI (a separate process) can see and approve pending requests
 * created by the MCP server. Falls back to the in-memory registry if the file
 * store is unavailable.
 */
export function createApprovalRegistry(): ApprovalRegistry {
  try {
    return new FileApprovalRegistry();
  } catch (error: any) {
    // Fall back to in-memory if the file store is unavailable.
    return new HmacApprovalRegistry();
  }
}

/**
 * Factory that wires a ready-to-use persistent BrowserHost from configuration.
 * Uses the Playwright runtime by default (the human-takeover engine). Transport
 * layers (MCP, CLI) consume this so business logic is not duplicated.
 *
 * When a SessionVault is provided (or created from MASTER_KEY), the host's
 * `persistAuth` hook is wired so durable auth state is persisted encrypted
 * after a successful human login.
 */
export function createBrowserHost(
  overrides?: Partial<BrowserHostOptions> & {
    /** Map a browser sessionId to a registered profileId for durable-auth persistence. */
    profileForSession?: (sessionId: string) => string | undefined;
  },
): BrowserHost {
  const runtime = overrides?.runtime ?? new PlaywrightBrowserRuntime();
  const options: BrowserHostOptions = {
    runtime,
    idleTtlMs: overrides?.idleTtlMs ?? 0,
  };
  if (overrides?.persistAuth) {
    options.persistAuth = overrides.persistAuth;
  } else {
    const vault = createSessionVault();
    if (vault) {
      // Default mapping: a sessionId that matches a registered profileId maps
      // to itself. Callers may inject a richer sessionId->profileId mapping via
      // `profileForSession` (e.g. host sessions registered as profiles).
      const profileForSession =
        overrides?.profileForSession ??
        ((sessionId: string) => (vault.getProfile(sessionId) ? sessionId : undefined));
      const persistAuth = new SessionVaultPersistAuth(vault, runtime, profileForSession);
      options.persistAuth = persistAuth.persistAuth;
    }
  }
  return new BrowserHost(options);
}

/**
 * Create a SessionVault from the configured MASTER_KEY, or undefined if no
 * master key is available (vault is optional — the host still works without it).
 */
export function createSessionVault(masterKey?: string): SessionVault | undefined {
  const key = masterKey ?? process.env.MASTER_KEY;
  // BLOCKER-I: reject known placeholders/weak keys via the shared resolver, not
  // just a raw length check. The public `.env.example` placeholder must never
  // become a usable vault key.
  if (!isValidMasterKey(key)) return undefined;
  return new FileSessionVault(key as string);
}
