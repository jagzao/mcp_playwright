// RC acceptance S4 - Real LinkedIn authenticated session (manual login + MFA).
// Launches a HEADED browser, navigates to LinkedIn login, fills the username,
// and suspends as WAITING_FOR_USER for Juan to complete password + MFA. The
// browser stays OPEN. After login, run: npm run rc:s4-finish to persist and
// validate restart-reuse.
import { BrowserHost } from '../lib/browser-gateway/application/browser-host.js';
import { PlaywrightBrowserRuntime } from '../lib/browser-gateway/infrastructure/engines/playwright/playwright-browser-runtime.js';
import { createSessionVault } from '../lib/browser-gateway/infrastructure/gateway-factory.js';
import { SessionVaultPersistAuth } from '../lib/browser-gateway/infrastructure/session-vault-persist-auth.js';

async function main() {
  const runtime = new PlaywrightBrowserRuntime();
  const vault = createSessionVault();
  const persistAuth = vault
    ? new SessionVaultPersistAuth(vault, runtime, (sessionId) =>
        vault.getProfile(sessionId) ? sessionId : undefined
      ).persistAuth
    : undefined;
  const host = new BrowserHost({ runtime, persistAuth });

  if (vault) {
    vault.registerProfile({
      profileId: 'linkedin-personal',
      allowedDomains: ['linkedin.com', 'www.linkedin.com'],
      interactiveLoginPreferred: true,
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    });
  }

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
  console.log('>>> Keep this process running. After login, run `npm run rc:s4-finish`.');
  // Keep the process alive so the browser stays open.
  await new Promise((r) => setTimeout(r, 10 * 60 * 1000));
  await host.closeAll().catch(() => {});
}

main().catch((e) => { console.error(e); process.exit(1); });
