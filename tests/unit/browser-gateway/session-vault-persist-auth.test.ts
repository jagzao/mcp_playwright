import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BrowserHost } from '../../../lib/browser-gateway/application/browser-host.js';
import { FileSessionVault } from '../../../lib/browser-gateway/infrastructure/session-vault.js';
import { SessionVaultPersistAuth } from '../../../lib/browser-gateway/infrastructure/session-vault-persist-auth.js';
import type { BrowserRuntime } from '../../../lib/browser-gateway/domain/browser-runtime.js';
import type { BrowserEngineId } from '../../../lib/browser-gateway/domain/browser-result.js';
import type { SessionProfile } from '../../../lib/browser-gateway/domain/session-vault.js';

const MASTER_KEY = 'test-master-key-0123456789abcdef0123456789abcdef';

class FakeRuntime implements BrowserRuntime {
  readonly engine: BrowserEngineId = 'playwright';
  private readonly openSessions = new Set<string>();
  captured: unknown | undefined;

  async openSession(sessionId: string): Promise<void> {
    this.openSessions.add(sessionId);
  }
  async currentUrl(): Promise<string | undefined> {
    return 'https://facebook.com';
  }
  async isAlive(sessionId: string): Promise<boolean> {
    return this.openSessions.has(sessionId);
  }
  async closeSession(sessionId: string): Promise<void> {
    this.openSessions.delete(sessionId);
  }
  async closeAll(): Promise<void> {
    this.openSessions.clear();
  }
  async captureAuthState(): Promise<unknown | undefined> {
    return this.captured;
  }
}

describe('BrowserHost persistAuth hook -> SessionVault (US-002)', () => {
  let dir: string;
  let vault: FileSessionVault;
  let runtime: FakeRuntime;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'persist-auth-test-'));
    vault = new FileSessionVault(MASTER_KEY, dir);
    runtime = new FakeRuntime();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('after a successful human login, durable auth state is persisted encrypted when policy allows', async () => {
    const profile: SessionProfile = {
      profileId: 'facebook-personal',
      allowedDomains: ['facebook.com'],
      interactiveLoginPreferred: true,
    };
    vault.registerProfile(profile);

    const persistAuth = new SessionVaultPersistAuth(vault, runtime, () => 'facebook-personal');
    const host = new BrowserHost({ runtime, persistAuth: persistAuth.persistAuth });

    await host.createSession('s1', { headed: true });
    runtime.captured = {
      cookies: [{ name: 'session', value: 'SECRET_COOKIE_VALUE', domain: 'facebook.com' }],
      origins: [],
    };

    await host.suspendForUser('s1', 'login required');

    const status = await vault.getStatus('facebook-personal', 'playwright');
    expect(status).toBeDefined();
    expect(status?.status).toBe('healthy');
    expect(status?.domains).toEqual(['facebook.com']);
    // Raw state must not leak into metadata.
    expect(JSON.stringify(status)).not.toContain('SECRET_COOKIE_VALUE');
  });

  it('does not persist when no profile mapping exists', async () => {
    const persistAuth = new SessionVaultPersistAuth(vault, runtime, () => undefined);
    const host = new BrowserHost({ runtime, persistAuth: persistAuth.persistAuth });

    await host.createSession('s1', { headed: true });
    runtime.captured = { cookies: [], origins: [] };
    await host.suspendForUser('s1', 'login required');

    const status = await vault.getStatus('s1', 'playwright');
    expect(status).toBeUndefined();
  });

  it('does not persist when the runtime cannot capture auth state', async () => {
    const profile: SessionProfile = { profileId: 'p1', allowedDomains: ['x.com'] };
    vault.registerProfile(profile);
    const noCaptureRuntime: BrowserRuntime = {
      engine: 'playwright',
      openSession: async () => {},
      currentUrl: async () => 'https://x.com',
      isAlive: async () => true,
      closeSession: async () => {},
      closeAll: async () => {},
    };
    const persistAuth = new SessionVaultPersistAuth(vault, noCaptureRuntime, (id) => id);
    const host = new BrowserHost({ runtime: noCaptureRuntime, persistAuth: persistAuth.persistAuth });

    await host.createSession('s1', { headed: true });
    await host.suspendForUser('s1', 'login required');

    const status = await vault.getStatus('s1', 'playwright');
    expect(status).toBeUndefined();
  });
});
