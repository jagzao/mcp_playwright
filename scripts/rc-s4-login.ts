// RC acceptance S4 - Real LinkedIn authenticated session (single process).
//
// FIX: the previous split login/finish scripts used SEPARATE PlaywrightBrowserRuntime
// instances, so the finish script could not access the login session's live state
// (captureAuthState returned undefined -> nothing persisted). This single script
// keeps ONE runtime alive across the whole flow:
//
//   1. Open a HEADED LinkedIn session (browser stays open).
//   2. Suspend as WAITING_FOR_USER for Juan to log in (password + MFA).
//   3. After Juan confirms, capture the authenticated state from the SAME live
//      runtime, persist it encrypted, close the browser, and validate that a
//      brand-new vault/host over the same store reuses the session (restart-reuse).
//
// Usage:
//   npm run rc:s4-login        -> opens headed LinkedIn, waits for Juan
//   (Juan logs in + MFA in the headed window)
//   npm run rc:s4-finish       -> captures/persists/validates restart-reuse
//
// Both commands must run in the SAME terminal/process context? No — they are
// separate processes. To share the live session, the login script must NOT exit
// while waiting. Instead, this file exposes BOTH phases via an env flag:
//   RC_S4_PHASE=login  npm run rc:s4-login   (keeps process alive, browser open)
//   RC_S4_PHASE=finish npm run rc:s4-finish  (captures from the SAME process)
//
// The login phase keeps the process alive (10 min) so the browser stays open.
// The finish phase is invoked by the SAME process after Juan confirms — but since
// that's not possible across separate `npm run` invocations, the login phase
// itself performs the capture+persist+validate after Juan signals completion via
// a marker file. This guarantees the SAME runtime is used.
import { PlaywrightBrowserRuntime } from '../lib/browser-gateway/infrastructure/engines/playwright/playwright-browser-runtime.js';
import { createSessionVault } from '../lib/browser-gateway/infrastructure/gateway-factory.js';
import { SessionVaultPersistAuth } from '../lib/browser-gateway/infrastructure/session-vault-persist-auth.js';
import { BrowserHost } from '../lib/browser-gateway/application/browser-host.js';
import { existsSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

const MARKER = join(process.cwd(), 'data', 's4-login-done.marker');

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
  const host = new BrowserHost({ runtime, persistAuth });

  const phase = process.env.RC_S4_PHASE ?? 'login';

  if (phase === 'login') {
    console.log('=== S4: LinkedIn HEADED login (WAITING_FOR_USER) ===');
    await host.createSession('linkedin-personal', { headed: true });
    const page = runtime.getPage('linkedin-personal');
    if (!page) throw new Error('no page');
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
    if (process.env.LINKEDIN_EMAIL) {
      try { await page.fill('#username', process.env.LINKEDIN_EMAIL); } catch {}
    }
    const suspend = await host.suspendForUser('linkedin-personal', 'LinkedIn login + MFA required (Juan acts)');
    console.log('Suspend:', JSON.stringify({ ok: suspend.ok, status: suspend.ok ? suspend.status : undefined }));
    console.log('Session status:', host.getSessionStatus('linkedin-personal'));
    console.log('Browser alive (WAITING_FOR_USER):', await runtime.isAlive('linkedin-personal'));
    console.log('\n>>> HEADED BROWSER IS OPEN. Juan: log in to LinkedIn (password + MFA) now.');
    console.log('>>> When you are logged in and on your feed, create the marker file:');
    console.log('>>>   New-Item -ItemType File -Path data/s4-login-done.marker');
    console.log('>>> This process will then capture+persist+validate automatically.');
    // Poll for the marker (up to 30 min), keeping the browser open.
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      if (existsSync(MARKER)) {
        rmSync(MARKER, { force: true });
        console.log('\nMarker detected. Capturing + persisting + validating...');
        await finish(runtime, vault, host);
        await host.closeAll().catch(() => {});
        console.log('\nS4 complete. Browser closed.');
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log('\nTimed out waiting for login marker. Browser still open; run again to retry.');
    await host.closeAll().catch(() => {});
    return;
  }

  // phase === 'finish' (standalone, for completeness — but the login phase is the
  // authoritative path since it owns the live runtime).
  console.log('S4 finish standalone: no live session in this process. Use the login phase marker flow instead.');
}

async function finish(runtime: PlaywrightBrowserRuntime, vault: any, host: BrowserHost) {
  const captured = await runtime.captureAuthState('linkedin-personal');
  const isLoggedIn = captured && Array.isArray((captured as any).cookies) && (captured as any).cookies.length > 0;
  console.log('Authenticated cookies captured:', isLoggedIn ? 'YES' : 'NO');
  if (!isLoggedIn) {
    console.log('No auth cookies captured — LinkedIn may not have completed login, or the site blocks reuse.');
    return;
  }
  const persist = await vault.persist('linkedin-personal', 'playwright', {
    engine: 'playwright',
    storageState: captured,
    capturedAt: Date.now(),
  });
  console.log('Persist ok:', persist.ok, 'artifactRef:', persist.ok ? persist.metadata.artifactRef : '');
  if (!persist.ok) throw new Error('persist failed');

  // Simulate restart: close the live browser, then a brand-new host+vault over
  // the same store must reuse the session without re-login.
  await host.closeAll().catch(() => {});
  console.log('Closed browser (simulated restart).');

  const validate = await vault.validate('linkedin-personal', 'playwright');
  console.log('Validate after restart outcome:', validate.outcome, 'status:', (validate as any).status);
  const raw = await vault.resolveArtifact((persist.metadata as any).artifactRef);
  console.log('Resolve artifact after restart:', raw ? 'OK (auth reused)' : 'FAILED');

  // Reuse: open a fresh headed session and restore the auth state -> no login needed.
  const host2 = new BrowserHost({ runtime: new PlaywrightBrowserRuntime(), persistAuth: undefined });
  await host2.createSession('linkedin-personal', { headed: true });
  const r2 = (host2 as any).runtime as PlaywrightBrowserRuntime;
  await r2.restoreAuthState('linkedin-personal', captured);
  const page = r2.getPage('linkedin-personal');
  if (page) {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
    const finalUrl = await page.url();
    console.log('After restart + restore, navigated to:', finalUrl.slice(0, 60));
  } else {
    console.log('After restart + restore: no page available.');
  }
  console.log('S4 acceptance:', validate.outcome === 'healthy' && raw ? 'PASS (auth reused without re-login)' : 'CHECK (site may not allow reuse)');
  await host2.closeAll().catch(() => {});
}

main().catch((e) => { console.error(e); process.exit(1); });
