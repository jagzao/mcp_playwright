import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileSessionVault } from '../../../lib/browser-gateway/infrastructure/session-vault.js';
import { SessionVaultRestoreAuth } from '../../../lib/browser-gateway/infrastructure/session-vault-restore-auth.js';
import type { BrowserRuntime } from '../../../lib/browser-gateway/domain/browser-runtime.js';
import type { SessionProfile } from '../../../lib/browser-gateway/domain/session-vault.js';

const MASTER_KEY = 'test-master-key-0123456789abcdef0123456789abcdef';

/**
 * Fake BrowserRuntime that keeps an in-memory `restoredState` map. No real
 * browser is needed — the test proves the bridge restores from the VAULT
 * ARTIFACT, not an in-memory variable.
 */
class FakeRuntime implements BrowserRuntime {
  readonly engine = 'playwright' as const;
  readonly restoredState = new Map<string, unknown>();
  readonly opened = new Set<string>();

  async openSession(sessionId: string): Promise<void> {
    this.opened.add(sessionId);
  }
  async currentUrl(): Promise<string | undefined> {
    return undefined;
  }
  async isAlive(): Promise<boolean> {
    return true;
  }
  async closeSession(sessionId: string): Promise<void> {
    this.opened.delete(sessionId);
  }
  async closeAll(): Promise<void> {
    this.opened.clear();
  }
  async captureAuthState(): Promise<unknown | undefined> {
    return undefined;
  }
  async restoreAuthState(sessionId: string, state: unknown): Promise<void> {
    this.restoredState.set(sessionId, state);
  }
}

const PROFILE: SessionProfile = {
  profileId: 'linkedin-personal',
  allowedDomains: ['linkedin.com', 'www.linkedin.com'],
  interactiveLoginPreferred: true,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
};

describe('SessionVaultRestoreAuth restores from the vault artifact (BLOCKER-K)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'session-restore-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('Test A: restores from the vault artifact, not an in-memory variable', async () => {
    // --- "Process 1": persist a healthy session via vault1 -------------------
    const vault1 = new FileSessionVault(MASTER_KEY, dir);
    vault1.registerProfile(PROFILE);
    const persist = await vault1.persist('linkedin-personal', 'playwright', {
      engine: 'playwright',
      storageState: {
        cookies: [{ name: 'li_at', value: 'VAULT_RESTORED_COOKIE', domain: 'linkedin.com' }],
        origins: [],
      },
      capturedAt: Date.now(),
    });
    expect(persist.ok).toBe(true);
    if (!persist.ok) return;
    const artifactRef = persist.metadata.artifactRef;

    // --- "Process 2": a BRAND-NEW vault + BRAND-NEW runtime -----------------
    // The in-memory `captured` variable from process 1 is NOT in scope here.
    const vault2 = new FileSessionVault(MASTER_KEY, dir);
    vault2.registerProfile(PROFILE);
    const runtime = new FakeRuntime();
    const bridge = new SessionVaultRestoreAuth(vault2, runtime, (sid) =>
      vault2.getProfile(sid) ? sid : undefined,
    );

    const result = await bridge.restoreAuth('linkedin-personal');

    // Outcome is healthy and the session was opened.
    expect(result.outcome).toBe('healthy');
    if (result.outcome !== 'healthy') return;
    expect(result.profileId).toBe('linkedin-personal');
    expect(result.engine).toBe('playwright');
    expect(result.domains).toEqual(['linkedin.com', 'www.linkedin.com']);
    expect(result.artifactRef).toBe(artifactRef);
    expect(runtime.opened.has('linkedin-personal')).toBe(true);

    // The restored state contains the distinctive cookie value — proving it
    // came from the vault artifact, not an in-memory variable.
    const restored = runtime.restoredState.get('linkedin-personal') as {
      cookies?: Array<{ name: string; value: string }>;
    };
    expect(restored).toBeDefined();
    const cookie = restored.cookies?.find((c) => c.name === 'li_at');
    expect(cookie?.value).toBe('VAULT_RESTORED_COOKIE');

    // The returned result does NOT contain the raw cookie value.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('VAULT_RESTORED_COOKIE');
    expect(serialized).not.toContain('li_at');
  });

  it('Test B: typed outcomes — no artifact -> bootstrap_required', async () => {
    const vault = new FileSessionVault(MASTER_KEY, dir);
    vault.registerProfile(PROFILE);
    const runtime = new FakeRuntime();
    const bridge = new SessionVaultRestoreAuth(vault, runtime, (sid) =>
      vault.getProfile(sid) ? sid : undefined,
    );

    const result = await bridge.restoreAuth('linkedin-personal');
    expect(result.outcome).toBe('bootstrap_required');
  });

  it('Test B: typed outcomes — revoked -> revoked', async () => {
    const vault = new FileSessionVault(MASTER_KEY, dir);
    vault.registerProfile(PROFILE);
    await vault.persist('linkedin-personal', 'playwright', {
      engine: 'playwright',
      storageState: { cookies: [{ name: 'li_at', value: 'x', domain: 'linkedin.com' }], origins: [] },
      capturedAt: Date.now(),
    });
    await vault.revoke('linkedin-personal', 'playwright');

    const runtime = new FakeRuntime();
    const bridge = new SessionVaultRestoreAuth(vault, runtime, (sid) =>
      vault.getProfile(sid) ? sid : undefined,
    );
    const result = await bridge.restoreAuth('linkedin-personal');
    expect(result.outcome).toBe('revoked');
  });

  it('Test B: typed outcomes — expired -> reauthentication_required', async () => {
    const vault = new FileSessionVault(MASTER_KEY, dir);
    // maxAgeMs = 0 forces immediate expiry.
    vault.registerProfile({ ...PROFILE, maxAgeMs: 0 });
    await vault.persist('linkedin-personal', 'playwright', {
      engine: 'playwright',
      storageState: { cookies: [{ name: 'li_at', value: 'x', domain: 'linkedin.com' }], origins: [] },
      capturedAt: Date.now(),
    });

    const runtime = new FakeRuntime();
    const bridge = new SessionVaultRestoreAuth(vault, runtime, (sid) =>
      vault.getProfile(sid) ? sid : undefined,
    );
    const result = await bridge.restoreAuth('linkedin-personal');
    expect(result.outcome).toBe('reauthentication_required');
  });

  it('Test C: engine mismatch — artifact for obscura requested with a playwright runtime -> reauthentication_required', async () => {
    const vault = new FileSessionVault(MASTER_KEY, dir);
    vault.registerProfile(PROFILE);
    await vault.persist('linkedin-personal', 'obscura', {
      engine: 'obscura',
      engineState: { dir: '/tmp/obscura' },
      capturedAt: Date.now(),
    });

    const runtime = new FakeRuntime(); // engine = 'playwright'
    const bridge = new SessionVaultRestoreAuth(vault, runtime, (sid) =>
      vault.getProfile(sid) ? sid : undefined,
    );
    const result = await bridge.restoreAuth('linkedin-personal');
    expect(result.outcome).toBe('reauthentication_required');
  });
});
