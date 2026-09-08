import type { BrowserRuntime } from '../domain/browser-runtime.js';
import type { SessionVault, BrowserAuthState } from '../domain/session-vault.js';
import type { BrowserEngineId } from '../domain/browser-result.js';
import { logger } from '../../observability/logger.js';

/**
 * Typed result of a trusted restore attempt. This is the ONLY thing a caller
 * (MCP/CLI/future consumer) receives. It never contains raw auth state, cookies
 * or storageState — only the outcome plus safe metadata.
 */
export type RestoreAuthResult =
  | { outcome: 'healthy'; sessionId: string; profileId: string; engine: BrowserEngineId; domains: string[]; artifactRef: string }
  | { outcome: 'bootstrap_required'; reason: string }
  | { outcome: 'reauthentication_required'; reason: string }
  | { outcome: 'revoked'; reason: string }
  | { outcome: 'user_interaction_required'; reason: string };

/**
 * Adapter that wires the RESTORE direction of the SessionVault to a live
 * BrowserRuntime — the mirror of `SessionVaultPersistAuth`.
 *
 * A caller requests an authenticated session by `sessionId` (mapped to a
 * registered `profileId`). The bridge:
 *   1. validates the persisted session in the vault;
 *   2. resolves the encrypted artifact (trusted infrastructure only);
 *   3. verifies engine/profile/domain consistency;
 *   4. opens a NEW browser session and restores the auth state into it.
 *
 * The caller receives only a typed outcome + safe metadata. Raw cookies /
 * storageState never cross this boundary.
 */
export class SessionVaultRestoreAuth {
  constructor(
    private readonly vault: SessionVault,
    private readonly runtime: BrowserRuntime,
    private readonly profileForSession: (sessionId: string) => string | undefined,
  ) {}

  /**
   * Restore an authenticated session for `sessionId` from the vault artifact.
   * Returns a typed outcome; never raw auth state.
   */
  async restoreAuth(sessionId: string, opts?: { headed?: boolean }): Promise<RestoreAuthResult> {
    // 1. Map sessionId -> profileId.
    const profileId = this.profileForSession(sessionId);
    if (!profileId) {
      return { outcome: 'bootstrap_required', reason: `no profile mapping for session: ${sessionId}` };
    }

    // 2. Get the profile.
    const profile = this.vault.getProfile(profileId);
    if (!profile) {
      return { outcome: 'bootstrap_required', reason: `unknown profile: ${profileId}` };
    }

    // 3. Validate the persisted session.
    const validate = await this.vault.validate(profileId, this.runtime.engine);
    if (validate.outcome !== 'healthy') {
      if (validate.outcome === 'reauthentication_required') {
        return { outcome: 'reauthentication_required', reason: validate.reason };
      }
      if (validate.outcome === 'revoked') {
        return { outcome: 'revoked', reason: validate.reason };
      }
      // bootstrap_required: no session for the requested engine. If the profile
      // has a persisted session under a DIFFERENT engine, surface a clear
      // engine-mismatch outcome rather than a generic bootstrap_required.
      const mismatch = await this.detectEngineMismatch(profileId);
      if (mismatch) {
        return {
          outcome: 'reauthentication_required',
          reason: `no ${this.runtime.engine} session; profile has a ${mismatch} artifact (engine mismatch)`,
        };
      }
      return { outcome: 'bootstrap_required', reason: validate.reason };
    }
    const metadata = validate.metadata;

    // 4. Resolve the encrypted artifact (trusted infrastructure only).
    const authState: BrowserAuthState | undefined = await this.vault.resolveArtifact(metadata.artifactRef);
    if (!authState) {
      return { outcome: 'reauthentication_required', reason: 'artifact could not be resolved' };
    }

    // 5. Verify engine/profile/domain consistency.
    if (authState.engine !== this.runtime.engine) {
      return {
        outcome: 'reauthentication_required',
        reason: `artifact engine (${authState.engine}) does not match runtime engine (${this.runtime.engine})`,
      };
    }
    if (!profile.allowedDomains || profile.allowedDomains.length === 0) {
      return { outcome: 'reauthentication_required', reason: `profile ${profileId} has no allowed domains` };
    }

    // 6. Open a NEW browser session.
    await this.runtime.openSession(sessionId, { headed: opts?.headed });

    // 7. Restore the auth state into the new session.
    if (this.runtime.restoreAuthState) {
      await this.runtime.restoreAuthState(sessionId, authState.storageState);
    } else {
      logger.warn('Runtime cannot restore auth state; session opened without auth', { sessionId, profileId });
    }

    // 8. Return only safe metadata — never raw auth state.
    return {
      outcome: 'healthy',
      sessionId,
      profileId,
      engine: this.runtime.engine,
      domains: profile.allowedDomains,
      artifactRef: metadata.artifactRef,
    };
  }

  /**
   * Detect whether the profile has a persisted session under a different engine
   * than the runtime's. Returns the other engine id, or undefined if none.
   */
  private async detectEngineMismatch(profileId: string): Promise<BrowserEngineId | undefined> {
    const other: BrowserEngineId = this.runtime.engine === 'playwright' ? 'obscura' : 'playwright';
    const status = await this.vault.getStatus(profileId, other);
    return status ? other : undefined;
  }
}
