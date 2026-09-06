import { describe, expect, it } from 'vitest';
import { BrowserHost } from '../../../lib/browser-gateway/application/browser-host.js';
import { PlaywrightBrowserRuntime } from '../../../lib/browser-gateway/infrastructure/engines/playwright/playwright-browser-runtime.js';

/**
 * Integration test for the persistent BrowserHost + human-in-the-loop flow.
 *
 * Uses real Playwright. If the browser is not installed (`npx playwright install`
 * has not been run), the test skips gracefully instead of failing.
 */
async function browserAvailable(): Promise<boolean> {
  const runtime = new PlaywrightBrowserRuntime();
  try {
    await runtime.openSession('__probe__', { headed: false });
    await runtime.closeSession('__probe__');
    return true;
  } catch {
    return false;
  }
}

describe('BrowserHost persistent lifecycle + HITL (integration)', () => {
  it('headed Playwright reaches WAITING_FOR_USER, browser stays open, resume continues same session', async () => {
    if (!(await browserAvailable())) {
      console.warn('SKIP: Playwright browser not installed. Run `npx playwright install` to enable.');
      return;
    }

    const runtime = new PlaywrightBrowserRuntime();
    const host = new BrowserHost({ runtime });

    try {
      // 1) Create a headed session and navigate to a login page.
      await host.createSession('it-s1', { headed: true });
      const page = runtime.getPage('it-s1');
      expect(page).toBeDefined();
      if (!page) return;
      await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });

      // 2) Suspend for a human.
      const suspend = await host.suspendForUser('it-s1', 'login required');
      expect(suspend.ok).toBe(true);
      if (!suspend.ok) return;
      expect(host.getSessionStatus('it-s1')).toBe('waiting_for_user');

      // 3) Browser remains open while waiting (no close happened).
      expect(await runtime.isAlive('it-s1')).toBe(true);

      // 4) Resume continues the same logical session/page.
      const resume = await host.resumeSession('it-s1', suspend.checkpoint.checkpointId);
      expect(resume.ok).toBe(true);
      if (resume.ok) {
        expect(resume.recovery).toBe('live_continuity');
        expect(resume.url).toContain('example.com');
      }
      expect(host.getSessionStatus('it-s1')).toBe('active');
    } finally {
      await host.closeAll();
    }
  }, 120000);

  it('headless -> headed promotion preserves the useful page (URL restored, page alive) for a human', async () => {
    if (!(await browserAvailable())) {
      console.warn('SKIP: Playwright browser not installed. Run `npx playwright install` to enable.');
      return;
    }

    const runtime = new PlaywrightBrowserRuntime();
    const host = new BrowserHost({ runtime });

    try {
      // 1) Start NON-headed (machine-driven). Use distinct content that
      //    survives promotion so we can prove the same useful page is back.
      await host.createSession('it-promo', { headed: false });
      const page = runtime.getPage('it-promo');
      expect(page).toBeDefined();
      if (!page) return;
      await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
      const originalUrl = page.url();

      // 2) Trigger human takeover. This is the real headless -> headed transition.
      const suspend = await host.suspendForUser('it-promo', 'login required');
      expect(suspend.ok).toBe(true);
      if (!suspend.ok) return;
      expect(host.getSessionStatus('it-promo')).toBe('waiting_for_user');
      expect(host.getSession('it-promo')?.headed).toBe(true);

      // 3) The checkpoint must record the ORIGINAL (pre-promotion) URL.
      expect(suspend.checkpoint.url).toBe(originalUrl);

      // 4) The useful page is still available after promotion: alive and on the
      //    same URL (restored into the headed session).
      expect(await runtime.isAlive('it-promo')).toBe(true);
      const promotedPage = runtime.getPage('it-promo');
      expect(promotedPage).toBeDefined();
      if (!promotedPage) return;
      expect(await promotedPage.url()).toContain('example.com');

      // 5) Resume continues the same logical session with URL continuity.
      const resume = await host.resumeSession('it-promo', suspend.checkpoint.checkpointId);
      expect(resume.ok).toBe(true);
      if (resume.ok) {
        expect(resume.recovery).toBe('live_continuity');
        expect(resume.url).toContain('example.com');
      }
      expect(host.getSessionStatus('it-promo')).toBe('active');
    } finally {
      await host.closeAll();
    }
  }, 120000);

  it('restoreAuthState restores localStorage/origins, not just cookies, across a close/reopen', async () => {
    if (!(await browserAvailable())) {
      console.warn('SKIP: Playwright browser not installed. Run `npx playwright install` to enable.');
      return;
    }

    const runtime = new PlaywrightBrowserRuntime();
    const host = new BrowserHost({ runtime });

    try {
      // 1) Open a session, navigate, and seed localStorage + a cookie.
      await host.createSession('it-auth', { headed: false });
      const page = runtime.getPage('it-auth');
      expect(page).toBeDefined();
      if (!page) return;
      await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        window.localStorage.setItem('session_token', 'spa-token-123');
        window.localStorage.setItem('user', 'juan');
      });
      await runtime.getPage('it-auth')!.context().addCookies([
        { name: 'sess', value: 'cookie-456', domain: 'example.com', path: '/' },
      ]);

      // 2) Capture the full storageState (cookies + origins/localStorage).
      const captured = await runtime.captureAuthState('it-auth');
      expect(captured).toBeDefined();
      const storage = captured as { cookies: unknown[]; origins: unknown[] };
      expect(storage.cookies.length).toBeGreaterThan(0);
      expect(storage.origins.length).toBeGreaterThan(0);

      // 3) Simulate the headless -> headed promotion: close, reopen, restore.
      await runtime.closeSession('it-auth');
      await runtime.openSession('it-auth', { headed: true });
      await runtime.restoreAuthState('it-auth', captured);

      // 4) Navigate back to the origin and verify localStorage survived.
      const restoredPage = runtime.getPage('it-auth');
      expect(restoredPage).toBeDefined();
      if (!restoredPage) return;
      await restoredPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });
      const restored = await restoredPage.evaluate(() => ({
        token: window.localStorage.getItem('session_token'),
        user: window.localStorage.getItem('user'),
      }));
      expect(restored.token).toBe('spa-token-123');
      expect(restored.user).toBe('juan');

      // 5) Cookies were restored too.
      const cookies = await restoredPage.context().cookies('https://example.com');
      expect(cookies.some((c) => c.name === 'sess' && c.value === 'cookie-456')).toBe(true);
    } finally {
      await host.closeAll();
    }
  }, 120000);

  it('HIGH-A: restoreAuthState is origin-scoped — no cross-origin localStorage contamination, correct per-origin restore', async () => {
    if (!(await browserAvailable())) {
      console.warn('SKIP: Playwright browser not installed. Run `npx playwright install` to enable.');
      return;
    }

    const runtime = new PlaywrightBrowserRuntime();
    const host = new BrowserHost({ runtime });

    try {
      // 1) Open a session and seed DISTINCT localStorage on two different origins.
      await host.createSession('it-origins', { headed: false });

      // Origin A (example.com) holds token A.
      await runtime.getPage('it-origins')!.goto('https://example.com', { waitUntil: 'domcontentloaded' });
      await runtime.getPage('it-origins')!.evaluate(() => {
        window.localStorage.setItem('session_token', 'origin-a-token');
        window.localStorage.setItem('user', 'alice');
      });

      // Origin B (example.org) holds token B.
      await runtime.getPage('it-origins')!.goto('https://example.org', { waitUntil: 'domcontentloaded' });
      await runtime.getPage('it-origins')!.evaluate(() => {
        window.localStorage.setItem('session_token', 'origin-b-token');
        window.localStorage.setItem('lang', 'en');
      });

      // 2) Capture the full storageState — both origins and their localStorage.
      const captured = await runtime.captureAuthState('it-origins');
      expect(captured).toBeDefined();
      const storage = captured as { origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> };
      const originSet = new Set(storage.origins.map((o) => o.origin));
      expect(originSet.has('https://example.com')).toBe(true);
      expect(originSet.has('https://example.org')).toBe(true);

      // 3) Simulate promotion: close, reopen, restore.
      await runtime.closeSession('it-origins');
      await runtime.openSession('it-origins', { headed: true });
      await runtime.restoreAuthState('it-origins', captured);

      // 4) Visit origin A: only A's values present; B's values ABSENT (no contamination).
      await runtime.getPage('it-origins')!.goto('https://example.com', { waitUntil: 'domcontentloaded' });
      const a = await runtime.getPage('it-origins')!.evaluate(() => ({
        token: window.localStorage.getItem('session_token'),
        user: window.localStorage.getItem('user'),
        lang: window.localStorage.getItem('lang'),
      }));
      expect(a.token).toBe('origin-a-token');
      expect(a.user).toBe('alice');
      // B's language flag must NOT leak into A.
      expect(a.lang).toBeNull();

      // 5) Visit origin B: only B's values present; A's values ABSENT.
      await runtime.getPage('it-origins')!.goto('https://example.org', { waitUntil: 'domcontentloaded' });
      const b = await runtime.getPage('it-origins')!.evaluate(() => ({
        token: window.localStorage.getItem('session_token'),
        lang: window.localStorage.getItem('lang'),
        user: window.localStorage.getItem('user'),
      }));
      expect(b.token).toBe('origin-b-token');
      expect(b.lang).toBe('en');
      // A's user must NOT leak into B.
      expect(b.user).toBeNull();

      // 6) Re-visiting A still yields A's values (per-origin restoration is stable).
      await runtime.getPage('it-origins')!.goto('https://example.com', { waitUntil: 'domcontentloaded' });
      const a2 = await runtime.getPage('it-origins')!.evaluate(() => window.localStorage.getItem('session_token'));
      expect(a2).toBe('origin-a-token');
    } finally {
      await host.closeAll();
    }
  }, 120000);
});
