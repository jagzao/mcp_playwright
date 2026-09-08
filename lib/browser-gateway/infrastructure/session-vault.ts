import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import { SecretsManager } from '../../security/secrets-manager.js';
import { logger } from '../../observability/logger.js';
import type {
  SessionVault,
  SessionProfile,
  SessionMetadata,
  BrowserAuthState,
  BootstrapResult,
  PersistResult,
  ValidateResult,
  RevokeResult,
} from '../domain/session-vault.js';
import type { BrowserEngineId } from '../domain/browser-result.js';

/**
 * Encrypted-at-rest SessionVault (US-002 / Phase D).
 *
 * Stores browser auth artifacts + metadata per profile and per engine, using
 * AES-256-GCM via the existing `SecretsManager`. Each profile+engine pair is
 * isolated in its own encrypted file, so:
 *  - session A can never read session B's state (AC18);
 *  - Playwright and Obscura artifacts are stored separately and never assumed
 *    portable between engines.
 *
 * Raw auth state is only returned through `resolveArtifact`, which is intended
 * for trusted infrastructure — never for LLM/tool callers. All public methods
 * return only opaque `artifactRef` values and safe metadata.
 */
export class FileSessionVault implements SessionVault {
  private readonly profiles = new Map<string, SessionProfile>();
  private readonly secretsManager: SecretsManager;
  private readonly vaultDir: string;

  constructor(masterKey: string, vaultDir?: string) {
    this.secretsManager = new SecretsManager(masterKey);
    this.vaultDir = vaultDir ?? join(process.cwd(), 'data', 'browser-sessions');
    if (!existsSync(this.vaultDir)) {
      mkdirSync(this.vaultDir, { recursive: true });
    }
  }

  // --- Profiles -------------------------------------------------------------

  registerProfile(profile: SessionProfile): void {
    this.profiles.set(profile.profileId, profile);
  }

  getProfile(profileId: string): SessionProfile | undefined {
    return this.profiles.get(profileId);
  }

  // --- Bootstrap ------------------------------------------------------------

  async bootstrap(profileId: string, engine: BrowserEngineId): Promise<BootstrapResult> {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return { outcome: 'bootstrap_required', reason: `unknown profile: ${profileId}` };
    }

    const existing = await this.readEntry(profileId, engine);
    if (existing) {
      const outcome = this.evaluateStatus(existing.metadata, profile);
      if (outcome === 'healthy') {
        return { outcome: 'healthy', metadata: existing.metadata };
      }
      if (outcome === 'reauthentication_required') {
        return { outcome: 'reauthentication_required', reason: 'existing session expired' };
      }
      if (outcome === 'revoked') {
        return { outcome: 'bootstrap_required', reason: 'existing session revoked' };
      }
    }

    if (profile.interactiveLoginPreferred) {
      return {
        outcome: 'user_interaction_required',
        reason: 'interactive login required for this profile',
      };
    }
    return { outcome: 'bootstrap_required', reason: 'no persisted session for profile' };
  }

  // --- Persist ---------------------------------------------------------------

  async persist(
    profileId: string,
    engine: BrowserEngineId,
    authState: BrowserAuthState,
    opts?: { domains?: string[] },
  ): Promise<PersistResult> {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return { ok: false, reason: `unknown profile: ${profileId}` };
    }

    const now = Date.now();
    const artifactRef = `vault://browser-sessions/${profileId}/${engine}`;
    const metadata: SessionMetadata = {
      profileId,
      engine,
      domains: opts?.domains ?? profile.allowedDomains,
      createdAt: now,
      lastValidatedAt: now,
      status: 'healthy',
      artifactRef,
    };

    const entry = { metadata, artifact: authState };
    const encrypted = this.secretsManager.encrypt(entry);

    try {
      this.atomicWrite(profileId, engine, encrypted);
      logger.info('Session persisted', {
        profileId,
        engine,
        artifactRef,
        domainCount: metadata.domains.length,
      });
      return { ok: true, metadata };
    } catch (error: any) {
      logger.error('Failed to persist session', {
        profileId,
        engine,
        error: error.message,
      });
      return { ok: false, reason: `failed to persist: ${error.message}` };
    }
  }

  // --- Validate --------------------------------------------------------------

  async validate(profileId: string, engine: BrowserEngineId): Promise<ValidateResult> {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      return { outcome: 'bootstrap_required', reason: `unknown profile: ${profileId}` };
    }

    const existing = await this.readEntry(profileId, engine);
    if (!existing) {
      return { outcome: 'bootstrap_required', reason: 'no persisted session' };
    }

    const status = this.evaluateStatus(existing.metadata, profile);
    if (status === 'healthy') {
      // Refresh lastValidatedAt.
      existing.metadata.lastValidatedAt = Date.now();
      await this.writeEntry(profileId, engine, existing);
      return { outcome: 'healthy', status: 'healthy', metadata: existing.metadata };
    }
    if (status === 'reauthentication_required') {
      return {
        outcome: 'reauthentication_required',
        status: 'reauthentication_required',
        metadata: existing.metadata,
        reason: 'session expired',
      };
    }
    return {
      outcome: 'revoked',
      status: 'revoked',
      metadata: existing.metadata,
      reason: 'session revoked',
    };
  }

  // --- Revoke ----------------------------------------------------------------

  async revoke(profileId: string, engine: BrowserEngineId): Promise<RevokeResult> {
    const existing = await this.readEntry(profileId, engine);
    if (!existing) {
      return { ok: false, reason: 'no persisted session to revoke' };
    }

    existing.metadata.status = 'revoked';
    try {
      await this.writeEntry(profileId, engine, existing);
      logger.info('Session revoked', { profileId, engine });
      return { ok: true, metadata: existing.metadata };
    } catch (error: any) {
      logger.error('Failed to revoke session', {
        profileId,
        engine,
        error: error.message,
      });
      return { ok: false, reason: `failed to revoke: ${error.message}` };
    }
  }

  // --- Status ----------------------------------------------------------------

  async getStatus(profileId: string, engine: BrowserEngineId): Promise<SessionMetadata | undefined> {
    const existing = await this.readEntry(profileId, engine);
    return existing?.metadata;
  }

  // --- Resolve (trusted infrastructure only) ---------------------------------

  async resolveArtifact(artifactRef: string): Promise<BrowserAuthState | undefined> {
    const parsed = this.parseArtifactRef(artifactRef);
    if (!parsed) return undefined;
    const existing = await this.readEntry(parsed.profileId, parsed.engine);
    if (!existing) return undefined;
    if (existing.metadata.status === 'revoked') return undefined;
    return existing.artifact;
  }

  // --- Internals -------------------------------------------------------------

  private entryPath(profileId: string, engine: BrowserEngineId): string {
    return join(this.vaultDir, `${profileId}__${engine}.vault`);
  }

  private async readEntry(
    profileId: string,
    engine: BrowserEngineId,
  ): Promise<{ metadata: SessionMetadata; artifact: BrowserAuthState } | undefined> {
    const path = this.entryPath(profileId, engine);
    if (!existsSync(path)) return undefined;
    try {
      const encrypted = readFileSync(path, 'utf-8');
      return this.secretsManager.decrypt(encrypted);
    } catch (error: any) {
      logger.error('Failed to read session entry', {
        profileId,
        engine,
        error: error.message,
      });
      return undefined;
    }
  }

  private async writeEntry(
    profileId: string,
    engine: BrowserEngineId,
    entry: { metadata: SessionMetadata; artifact: BrowserAuthState },
  ): Promise<void> {
    const encrypted = this.secretsManager.encrypt(entry);
    this.atomicWrite(profileId, engine, encrypted);
  }

  /** Atomic write: write to a temp file then rename over the target. */
  private atomicWrite(profileId: string, engine: BrowserEngineId, encrypted: string): void {
    const path = this.entryPath(profileId, engine);
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, encrypted, 'utf-8');
    renameSync(tmp, path);
  }

  private evaluateStatus(metadata: SessionMetadata, profile: SessionProfile): 'healthy' | 'reauthentication_required' | 'revoked' {
    if (metadata.status === 'revoked') return 'revoked';
    const maxAge = profile.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000; // default 7 days
    if (Date.now() - metadata.lastValidatedAt > maxAge) {
      return 'reauthentication_required';
    }
    return 'healthy';
  }

  private parseArtifactRef(
    artifactRef: string,
  ): { profileId: string; engine: BrowserEngineId } | undefined {
    const prefix = 'vault://browser-sessions/';
    if (!artifactRef.startsWith(prefix)) return undefined;
    const rest = artifactRef.slice(prefix.length);
    const [profileId, engine] = rest.split('/');
    if (!profileId || (engine !== 'playwright' && engine !== 'obscura')) return undefined;
    return { profileId, engine };
  }
}
