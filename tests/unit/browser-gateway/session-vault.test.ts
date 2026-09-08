import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileSessionVault } from '../../../lib/browser-gateway/infrastructure/session-vault.js';
import { createSessionVault } from '../../../lib/browser-gateway/infrastructure/gateway-factory.js';
import { SecretsManager } from '../../../lib/security/secrets-manager.js';
import type { SessionProfile, BrowserAuthState } from '../../../lib/browser-gateway/domain/session-vault.js';

const MASTER_KEY = 'test-master-key-0123456789abcdef0123456789abcdef';

function makeProfile(overrides: Partial<SessionProfile> = {}): SessionProfile {
  return {
    profileId: 'facebook-personal',
    allowedDomains: ['facebook.com', 'www.facebook.com'],
    interactiveLoginPreferred: true,
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

function makeAuthState(engine: 'playwright' | 'obscura' = 'playwright'): BrowserAuthState {
  return {
    engine,
    storageState: {
      cookies: [{ name: 'session', value: 'SECRET_COOKIE_VALUE', domain: 'facebook.com' }],
      origins: [],
    },
    capturedAt: Date.now(),
  };
}

describe('SessionVault (US-002 / Phase D)', () => {
  let dir: string;
  let vault: FileSessionVault;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vault-test-'));
    vault = new FileSessionVault(MASTER_KEY, dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('AC10: durable auth — persist, restart (new vault instance), restore/reuse and validate WITHOUT exposing raw state', async () => {
    vault.registerProfile(makeProfile());
    const persist = await vault.persist('facebook-personal', 'playwright', makeAuthState());
    expect(persist.ok).toBe(true);
    if (!persist.ok) return;
    expect(persist.metadata.artifactRef).toContain('vault://browser-sessions/facebook-personal/playwright');
    // Metadata must not contain raw cookies.
    expect(JSON.stringify(persist.metadata)).not.toContain('SECRET_COOKIE_VALUE');

    // "Restart": a brand-new vault instance over the same directory.
    const restarted = new FileSessionVault(MASTER_KEY, dir);
    restarted.registerProfile(makeProfile());

    const validate = await restarted.validate('facebook-personal', 'playwright');
    expect(validate.outcome).toBe('healthy');
    if (validate.outcome === 'healthy') {
      expect(validate.metadata.artifactRef).toBe(persist.metadata.artifactRef);
    }

    // Raw state is only reachable through the trusted resolveArtifact path.
    const raw = await restarted.resolveArtifact(persist.metadata.artifactRef);
    expect(raw).toBeDefined();
    expect((raw as any).storageState.cookies[0].value).toBe('SECRET_COOKIE_VALUE');
  });

  it('AC11: auth lifecycle — missing/expired/revoked produce distinct typed outcomes', async () => {
    vault.registerProfile(makeProfile());

    // Missing -> bootstrap_required (interactive profile -> user_interaction_required).
    const missing = await vault.bootstrap('facebook-personal', 'playwright');
    expect(missing.outcome).toBe('user_interaction_required');

    // Persist a healthy session.
    await vault.persist('facebook-personal', 'playwright', makeAuthState());
    const healthy = await vault.validate('facebook-personal', 'playwright');
    expect(healthy.outcome).toBe('healthy');

    // Expired -> reauthentication_required.
    const expiredVault = new FileSessionVault(MASTER_KEY, dir);
    expiredVault.registerProfile(makeProfile({ maxAgeMs: 1 }));
    const expired = await expiredVault.validate('facebook-personal', 'playwright');
    expect(expired.outcome).toBe('reauthentication_required');

    // Revoked -> revoked.
    await vault.revoke('facebook-personal', 'playwright');
    const revoked = await vault.validate('facebook-personal', 'playwright');
    expect(revoked.outcome).toBe('revoked');
  });

  it('AC18: session isolation — auth state for session A is inaccessible to session B', async () => {
    vault.registerProfile(makeProfile({ profileId: 'profile-a' }));
    vault.registerProfile(makeProfile({ profileId: 'profile-b' }));

    await vault.persist('profile-a', 'playwright', makeAuthState());
    await vault.persist('profile-b', 'playwright', makeAuthState());

    const a = await vault.getStatus('profile-a', 'playwright');
    const b = await vault.getStatus('profile-b', 'playwright');
    expect(a?.artifactRef).toContain('profile-a');
    expect(b?.artifactRef).toContain('profile-b');
    expect(a?.artifactRef).not.toBe(b?.artifactRef);

    // Resolving A's artifact must not return B's state.
    const rawA = await vault.resolveArtifact(a!.artifactRef);
    expect(rawA).toBeDefined();
    const rawB = await vault.resolveArtifact(b!.artifactRef);
    expect(rawB).toBeDefined();
    expect(rawA).not.toBe(rawB);
  });

  it('revocation makes the stored session unusable', async () => {
    vault.registerProfile(makeProfile());
    const persist = await vault.persist('facebook-personal', 'playwright', makeAuthState());
    expect(persist.ok).toBe(true);
    if (!persist.ok) return;

    const revoke = await vault.revoke('facebook-personal', 'playwright');
    expect(revoke.ok).toBe(true);

    // resolveArtifact must refuse revoked artifacts.
    const raw = await vault.resolveArtifact(persist.metadata.artifactRef);
    expect(raw).toBeUndefined();

    const validate = await vault.validate('facebook-personal', 'playwright');
    expect(validate.outcome).toBe('revoked');
  });

  it('engine-specific artifacts: Playwright and Obscura are stored separately, not portable', async () => {
    vault.registerProfile(makeProfile());
    await vault.persist('facebook-personal', 'playwright', makeAuthState('playwright'));
    await vault.persist('facebook-personal', 'obscura', makeAuthState('obscura'));

    const pw = await vault.getStatus('facebook-personal', 'playwright');
    const ob = await vault.getStatus('facebook-personal', 'obscura');
    expect(pw?.engine).toBe('playwright');
    expect(ob?.engine).toBe('obscura');
    expect(pw?.artifactRef).not.toBe(ob?.artifactRef);

    // Revoking Playwright must not affect Obscura.
    await vault.revoke('facebook-personal', 'playwright');
    const obAfter = await vault.validate('facebook-personal', 'obscura');
    expect(obAfter.outcome).toBe('healthy');
  });

  it('no plaintext secrets in logs/results (redaction) — metadata and status never contain raw state', async () => {
    vault.registerProfile(makeProfile());
    const persist = await vault.persist('facebook-personal', 'playwright', makeAuthState());
    expect(persist.ok).toBe(true);
    if (!persist.ok) return;

    const status = await vault.getStatus('facebook-personal', 'playwright');
    const serialized = JSON.stringify({ persist: persist.metadata, status });
    expect(serialized).not.toContain('SECRET_COOKIE_VALUE');
    expect(serialized).not.toContain('cookies');
  });

  it('bootstrap returns healthy when a valid session already exists', async () => {
    vault.registerProfile(makeProfile());
    await vault.persist('facebook-personal', 'playwright', makeAuthState());
    const result = await vault.bootstrap('facebook-personal', 'playwright');
    expect(result.outcome).toBe('healthy');
  });

  it('persist rotates a prior artifact for the same profile+engine (reauthentication rotation)', async () => {
    vault.registerProfile(makeProfile());
    const first = await vault.persist('facebook-personal', 'playwright', makeAuthState());
    const second = await vault.persist('facebook-personal', 'playwright', makeAuthState());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // Same artifactRef (stable), but the underlying encrypted file is replaced.
    expect(second.metadata.artifactRef).toBe(first.metadata.artifactRef);
    const raw = await vault.resolveArtifact(second.metadata.artifactRef);
    expect(raw).toBeDefined();
  });

  it('encrypted-at-rest: the on-disk file contains no plaintext state', async () => {
    vault.registerProfile(makeProfile());
    await vault.persist('facebook-personal', 'playwright', makeAuthState());
    const path = join(dir, 'facebook-personal__playwright.vault');
    expect(existsSync(path)).toBe(true);
    const onDisk = readFileSync(path, 'utf-8');
    expect(onDisk).not.toContain('SECRET_COOKIE_VALUE');
    expect(onDisk).not.toContain('cookies');
  });
});

describe('SessionVault (BLOCKER-I: public placeholder MASTER_KEY must never configure)', () => {
  it('createSessionVault rejects the committed .env.example placeholder', () => {
    const prev = process.env.MASTER_KEY;
    try {
      process.env.MASTER_KEY = 'your-32-character-master-key-here';
      expect(createSessionVault()).toBeUndefined();
      expect(createSessionVault('your-32-character-master-key-here')).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.MASTER_KEY = prev;
      else delete process.env.MASTER_KEY;
    }
  });

  it('SecretsManager throws on the committed .env.example placeholder', () => {
    expect(() => new SecretsManager('your-32-character-master-key-here')).toThrow();
  });

  it('SecretsManager throws on an all-same-char key', () => {
    expect(() => new SecretsManager('a'.repeat(32))).toThrow();
  });

  it('createSessionVault accepts a strong random key', () => {
    const prev = process.env.MASTER_KEY;
    try {
      process.env.MASTER_KEY = 'master-key-0123456789abcdef0123456789abcdef';
      expect(createSessionVault()).toBeDefined();
    } finally {
      if (prev !== undefined) process.env.MASTER_KEY = prev;
      else delete process.env.MASTER_KEY;
    }
  });
});
