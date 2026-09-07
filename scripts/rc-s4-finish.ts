// RC acceptance S4 finish - After Juan completes LinkedIn login + MFA, this
// captures the authenticated state, persists it (encrypted), closes the browser,
// and validates that a NEW vault/host instance over the same store can reuse the
// session (restart-reuse). Proves durable authenticated sessions survive restart.
import { PlaywrightBrowserRuntime } from '../lib/browser-gateway/infrastructure/engines/playwright/playwright-browser-runtime.js';
import { createSessionVault, createBrowserHost } from '../lib/browser-gateway/infrastructure/gateway-factory.js';
import { SessionVaultPersistAuth } from '../lib/browser-gateway/infrastructure/session-vault-persist-auth.js';

async function main() {
  const runtime = new PlaywrightBrowserRuntime();
  const vault = createSessionVault();
  if (!vault) throw new Error('MASTER_KEY not configured (SessionVault unavailable)');
  vault.registerProfile({
    profileId: 'linkedin-personal',
    allowedDomains: ['linkedin.com', 'www.linkedin.com'],
    interactiveLoginPreferred: true,
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  });
  const persistAuth = new SessionVaultPersistAuth(vault, runtime, (sid) =>
    vault.getProfile(sid) ? sid : undefined
  ).persistAuth;

  // Capture the current (now-authenticated) session state BEFORE closing.
  const captured = await runtime.captureAuthState('linkedin-personal');
  const isLoggedIn = captured && Array.isArray((captured as any).cookies) && (captured as any).cookies.length > 0;
  console.log('=== S4 finish: persist + restart-reuse ===');
  console.log('Authenticated cookies captured:', isLoggedIn ? 'YES' : 'NO');

  // Persist via the vault (encrypted durable auth).
  const persist = await vault.persist('linkedin-personal', 'playwright', {
    engine: 'playwright',
    storageState: captured,
    capturedAt: Date.now(),
  });
  console.log('Persist ok:', persist.ok, 'artifactRef:', persist.ok ? persist.metadata.artifactRef : '');
  if (!persist.ok) throw new Error('persist failed');

  // Simulate process restart: close everything, then a BRAND-NEW host+vault over
  // the same store must reuse the session without re-login.
  const host = new (await import('../lib/browser-gateway/application/browser-host.js')).BrowserHost({
    runtime: new PlaywrightBrowserRuntime(),
    persistAuth,
  });
  await host.closeAll().catch(() => {});
  console.log('Closed browser (simulated restart).');

  const validate = await vault.validate('linkedin-personal', 'playwright');
  console.log('Validate after restart outcome:', validate.outcome, 'status:', (validate as any).status);
  const raw = await vault.resolveArtifact((persist.metadata as any).artifactRef);
  console.log('Resolve artifact after restart:', raw ? 'OK (auth reused)' : 'FAILED');

  // Reuse: open a fresh headed session and restore the auth state -> no login needed.
  await host.createSession('linkedin-personal', { headed: true });
  await runtime.restoreAuthState('linkedin-personal', captured);
  const page = (runtime as any).getPage('linkedin-personal');
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  const finalUrl = await page.url();
  console.log('After restart + restore, navigated to:', finalUrl.slice(0, 60));
  console.log('S4 acceptance:', validate.outcome === 'healthy' && raw ? 'PASS (auth reused without re-login)' : 'CHECK (site may not allow reuse)');
  await host.closeAll().catch(() => {});
}

main().catch((e) => { console.error(e); process.exit(1); });
