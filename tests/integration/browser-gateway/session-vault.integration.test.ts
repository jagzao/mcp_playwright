import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileSessionVault } from '../../../lib/browser-gateway/infrastructure/session-vault.js';
import type { SessionProfile } from '../../../lib/browser-gateway/domain/session-vault.js';

const MASTER_KEY = 'test-master-key-0123456789abcdef0123456789abcdef';

/**
 * Integration test for durable authenticated sessions (US-002).
 *
 * This test does NOT require a real browser — it proves the persistence/restart
 * contract of the SessionVault, which is the durable-auth core. A saved auth
 * state survives a "gateway/vault process restart" (a brand-new vault instance
 * over the same encrypted store) and is reused.
 */
describe('SessionVault durable auth survives restart (US-002)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vault-restart-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('a saved auth state survives a vault process restart and is reused', async () => {
    const profile: SessionProfile = {
      profileId: 'facebook-personal',
      allowedDomains: ['facebook.com'],
      interactiveLoginPreferred: true,
    };

    // --- "Process 1": persist a healthy session -----------------------------
    const vault1 = new FileSessionVault(MASTER_KEY, dir);
    vault1.registerProfile(profile);
    const persist = await vault1.persist('facebook-personal', 'playwright', {
      engine: 'playwright',
      storageState: {
        cookies: [{ name: 'session', value: 'SECRET_COOKIE_VALUE', domain: 'facebook.com' }],
        origins: [],
      },
      capturedAt: Date.now(),
    });
    expect(persist.ok).toBe(true);
    if (!persist.ok) return;
    const artifactRef = persist.metadata.artifactRef;

    // --- "Process 2": a brand-new vault instance over the same store --------
    const vault2 = new FileSessionVault(MASTER_KEY, dir);
    vault2.registerProfile(profile);

    // The session is reused: validate returns healthy and the artifact resolves.
    const validate = await vault2.validate('facebook-personal', 'playwright');
    expect(validate.outcome).toBe('healthy');
    if (validate.outcome !== 'healthy') return;
    expect(validate.metadata.artifactRef).toBe(artifactRef);

    const raw = await vault2.resolveArtifact(artifactRef);
    expect(raw).toBeDefined();
    expect((raw as any).storageState.cookies[0].value).toBe('SECRET_COOKIE_VALUE');
  });
});
