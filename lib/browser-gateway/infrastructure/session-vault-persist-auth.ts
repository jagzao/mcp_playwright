import type { BrowserRuntime } from '../domain/browser-runtime.js';
import type { BrowserCheckpoint } from '../domain/browser-session.js';
import type { SessionVault, BrowserAuthState } from '../domain/session-vault.js';
import { logger } from '../../observability/logger.js';

/**
 * Adapter that wires the BrowserHost `persistAuth` hook to the SessionVault.
 *
 * After a successful human login (session suspended for user, then resumed),
 * the host calls this hook. It captures the live browser's auth state via the
 * runtime and persists it encrypted when a profile mapping exists and policy
 * allows. Best-effort — never blocks the suspension.
 *
 * The mapping from a browser sessionId to a logical profileId is provided by
 * the caller (e.g. the gateway facade / factory). If no mapping exists, nothing
 * is persisted.
 */
export class SessionVaultPersistAuth {
  constructor(
    private readonly vault: SessionVault,
    private readonly runtime: BrowserRuntime,
    private readonly profileForSession: (sessionId: string) => string | undefined,
  ) {}

  /**
   * The hook passed to BrowserHost. Captures and persists auth state for the
   * session's profile when a mapping exists and the runtime can capture state.
   */
  persistAuth = async (sessionId: string, _checkpoint: BrowserCheckpoint): Promise<void> => {
    const profileId = this.profileForSession(sessionId);
    if (!profileId) return;

    if (!this.runtime.captureAuthState) {
      logger.debug('Runtime cannot capture auth state; skipping persist', { sessionId });
      return;
    }

    const profile = this.vault.getProfile(profileId);
    if (!profile) {
      logger.debug('No registered profile; skipping persist', { profileId });
      return;
    }

    const storageState = await this.runtime.captureAuthState(sessionId);
    if (!storageState) {
      logger.debug('No auth state captured; skipping persist', { sessionId, profileId });
      return;
    }

    const authState: BrowserAuthState = {
      engine: this.runtime.engine,
      storageState,
      capturedAt: Date.now(),
    };

    const result = await this.vault.persist(profileId, this.runtime.engine, authState, {
      domains: profile.allowedDomains,
    });
    if (!result.ok) {
      logger.warn('Failed to persist auth state', { sessionId, profileId, reason: result.reason });
    }
  };
}
