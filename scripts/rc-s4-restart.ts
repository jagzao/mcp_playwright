// RC acceptance S4 restart-only — restore from the REAL LinkedIn artifact already
// on disk, using a BRAND-NEW SessionVault instance (new process) over the same
// encrypted store. This is the BLOCKER-K fix: the restore must come from the
// vault ARTIFACT, not an in-memory variable.
//
// Flow:
//   1. Create a brand-new SessionVault over the same encrypted store.
//   2. Register the `linkedin-personal` profile.
//   3. Call the restore bridge to validate + resolve the artifact + open a NEW
//      Playwright runtime + restore the auth state.
//   4. Navigate to https://www.linkedin.com/feed/.
//   5. PASS only if the final URL is NOT /login, NOT authwall, NOT a checkpoint.
//      If it lands on login/authwall/checkpoint -> FAIL (the vault saying
//      `healthy` is NOT sufficient).
//   6. Print the typed outcome + final URL + PASS/FAIL verdict.
//      Never prints raw cookies.
//
// Usage:
//   npm run rc:s4-restart
import { PlaywrightBrowserRuntime } from '../lib/browser-gateway/infrastructure/engines/playwright/playwright-browser-runtime.js';
import { createSessionVault } from '../lib/browser-gateway/infrastructure/gateway-factory.js';
import { SessionVaultRestoreAuth } from '../lib/browser-gateway/infrastructure/session-vault-restore-auth.js';

const PROFILE_ID = 'linkedin-personal';
const FEED_URL = 'https://www.linkedin.com/feed/';

function isBlockedUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes('/login') ||
    lower.includes('authwall') ||
    lower.includes('checkpoint') ||
    lower.includes('auth/login')
  );
}

async function main() {
  // 1. Brand-new vault over the same encrypted store (new process).
  const vault = createSessionVault();
  if (!vault) throw new Error('MASTER_KEY not configured (SessionVault unavailable)');

  // 2. Register the profile.
  vault.registerProfile({
    profileId: PROFILE_ID,
    allowedDomains: ['linkedin.com', 'www.linkedin.com'],
    interactiveLoginPreferred: true,
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  });

  // 3. Restore bridge: validate + resolve artifact + open NEW runtime + restore.
  const runtime = new PlaywrightBrowserRuntime();
  const bridge = new SessionVaultRestoreAuth(vault, runtime, (sid) =>
    vault.getProfile(sid) ? sid : undefined,
  );
  const result = await bridge.restoreAuth(PROFILE_ID, { headed: true });
  console.log('Restore outcome:', result.outcome);
  if (result.outcome !== 'healthy') {
    console.log('Reason:', (result as any).reason);
    console.log('FAIL: session not healthy. Run `npm run rc:s4-login` to re-bootstrap the WAITING_FOR_USER headed login.');
    await runtime.closeAll().catch(() => {});
    process.exit(1);
  }
  console.log('profileId:', result.profileId, '| engine:', result.engine);
  console.log('domains:', result.domains.join(', '));
  console.log('artifactRef:', result.artifactRef);

  // 4. Navigate to the feed.
  const page = runtime.getPage(PROFILE_ID);
  if (!page) throw new Error('no page after restore');
  await page.goto(FEED_URL, { waitUntil: 'domcontentloaded' });
  const finalUrl = await page.url();
  console.log('Final URL:', finalUrl.slice(0, 120));

  // 5. PASS/FAIL verdict — the vault saying `healthy` is NOT sufficient.
  const pass = !isBlockedUrl(finalUrl);
  console.log(pass ? 'PASS: authenticated session restored from vault artifact (not /login, not authwall, not checkpoint).' : 'FAIL: landed on login/authwall/checkpoint — auth was NOT reused.');

  await runtime.closeAll().catch(() => {});
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
