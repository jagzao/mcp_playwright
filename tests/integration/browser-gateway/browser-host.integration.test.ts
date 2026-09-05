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
  });
});
