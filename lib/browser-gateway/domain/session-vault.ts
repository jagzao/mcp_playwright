import type { BrowserEngineId } from './browser-result.js';

/**
 * Durable authentication domain types (US-002 / Phase D).
 *
 * Two distinct concerns are kept separate:
 *  1. `SecretProvider` — API keys / password references / service secrets.
 *  2. `SessionVault` — encrypted browser authentication artifacts + metadata.
 *
 * The vault NEVER returns raw auth state to an LLM/tool caller. It only returns
 * opaque `artifactRef` values and safe metadata. Raw state is resolved only by
 * trusted infrastructure through `resolveArtifact`.
 */

/**
 * Stored auth status for a persisted session profile.
 */
export type AuthStatus =
  | 'healthy'
  | 'degraded'
  | 'reauthentication_required'
  | 'revoked';

/**
 * Typed session outcome returned to callers. These are the actionable results
 * an agent/coordinator can branch on (AC11).
 */
export type SessionOutcome =
  | 'bootstrap_required'
  | 'reauthentication_required'
  | 'user_interaction_required'
  | 'revoked'
  | 'healthy';

/**
 * Permission policy for a session profile. Engine fallback must never weaken
 * these permissions — they are enforced by the application layer regardless of
 * which engine produced the artifact.
 */
export interface SessionProfilePermissions {
  read?: 'allow' | 'deny';
  draft?: 'allow' | 'deny';
  publish?: 'allow' | 'approval_required' | 'deny';
  message?: 'allow' | 'approval_required' | 'deny';
  account_security_change?: 'allow' | 'deny';
}

/**
 * A logical session profile. Defines the allowed domains, capabilities and
 * approval policy for a protected site. Possession of an authenticated session
 * is NOT permission to perform every action available in that account.
 */
export interface SessionProfile {
  profileId: string;
  /** Domains this profile is allowed to operate on. */
  allowedDomains: string[];
  /**
   * Which agents/projects may request this profile.
   *
   * NOTE (out-of-scope): this field is currently NOT enforced. Enforcing it
   * requires a trusted caller identity to be threaded through the vault entry
   * points (bootstrap/validate/persist/resolveArtifact), which does not exist
   * yet in the MCP/CLI transport layer. Until a caller-identity mechanism is
   * introduced, treat this as documentation of intent only. See the security
   * review finding MEDIUM-7.
   */
  allowedCallers?: string[];
  permissions?: SessionProfilePermissions;
  /** Prefer manual interactive login bootstrap over exposing credentials. */
  interactiveLoginPreferred?: boolean;
  /** Max age of a persisted session before reauthentication is required. */
  maxAgeMs?: number;
}

/**
 * Safe metadata persisted for a session artifact. Contains no raw cookies,
 * storage state or secrets — only opaque references and timestamps.
 */
export interface SessionMetadata {
  profileId: string;
  engine: BrowserEngineId;
  domains: string[];
  createdAt: number;
  lastValidatedAt: number;
  status: AuthStatus;
  /** Opaque reference to the encrypted artifact. Not a filesystem path exposed to agents. */
  artifactRef: string;
}

/**
 * Result of a bootstrap attempt.
 */
export type BootstrapResult =
  | { outcome: 'healthy'; metadata: SessionMetadata }
  | { outcome: 'bootstrap_required'; reason: string }
  | { outcome: 'reauthentication_required'; reason: string }
  | { outcome: 'user_interaction_required'; reason: string };

/**
 * Result of persisting auth state after a successful login.
 */
export type PersistResult =
  | { ok: true; metadata: SessionMetadata }
  | { ok: false; reason: string };

/**
 * Result of validating a persisted session.
 */
export type ValidateResult =
  | { outcome: 'healthy'; status: 'healthy'; metadata: SessionMetadata; reason?: string }
  | { outcome: 'reauthentication_required'; status: AuthStatus; metadata?: SessionMetadata; reason: string }
  | { outcome: 'bootstrap_required'; status?: undefined; reason: string }
  | { outcome: 'revoked'; status: 'revoked'; metadata?: SessionMetadata; reason: string };

/**
 * Result of revoking a persisted session.
 */
export type RevokeResult =
  | { ok: true; metadata?: SessionMetadata }
  | { ok: false; reason: string };

/**
 * The raw browser auth state captured from a live browser. This is the
 * sensitive payload that is encrypted at rest and never returned to callers.
 */
export interface BrowserAuthState {
  engine: BrowserEngineId;
  /** Playwright storageState (cookies + localStorage + origins). */
  storageState?: unknown;
  /** Engine-specific sealed state (e.g. Obscura storage directory). */
  engineState?: unknown;
  capturedAt: number;
}

/**
 * SessionVault contract — encrypted-at-rest browser auth artifacts + metadata.
 *
 * Responsibilities:
 *  - encrypted-at-rest browser state (AES-256-GCM);
 *  - per-profile and per-engine isolation;
 *  - expiry / last-validation metadata;
 *  - atomic read/write;
 *  - revocation;
 *  - rotation after reauthentication;
 *  - never returning raw state to the LLM.
 *
 * The application/domain layer depends on this interface, never on a concrete
 * filesystem/encryption implementation.
 */
export interface SessionVault {
  /** Register a session profile (its policy). */
  registerProfile(profile: SessionProfile): void;
  /** Look up a registered profile. */
  getProfile(profileId: string): SessionProfile | undefined;

  /**
   * Start a bootstrap for a profile/engine. Returns a typed outcome. If a
   * healthy session already exists it is returned; otherwise the caller is
   * told bootstrap (or interactive login) is required.
   */
  bootstrap(profileId: string, engine: BrowserEngineId): Promise<BootstrapResult>;

  /**
   * Persist encrypted auth state after a successful login. Rotates any prior
   * artifact for the same profile+engine. Returns only metadata.
   */
  persist(
    profileId: string,
    engine: BrowserEngineId,
    authState: BrowserAuthState,
    opts?: { domains?: string[] },
  ): Promise<PersistResult>;

  /**
   * Validate a persisted session. Returns a typed outcome (AC11):
   * missing -> bootstrap_required; expired -> reauthentication_required;
   * revoked -> revoked; healthy -> healthy.
   */
  validate(profileId: string, engine: BrowserEngineId): Promise<ValidateResult>;

  /** Revoke a persisted session, making it unusable. */
  revoke(profileId: string, engine: BrowserEngineId): Promise<RevokeResult>;

  /** Return safe metadata for a profile+engine, or undefined if none. */
  getStatus(profileId: string, engine: BrowserEngineId): Promise<SessionMetadata | undefined>;

  /**
   * Resolve the raw decrypted auth state for an artifactRef. TRUSTED
   * INFRASTRUCTURE ONLY — never exposed to LLM/tool callers.
   */
  resolveArtifact(artifactRef: string): Promise<BrowserAuthState | undefined>;
}
