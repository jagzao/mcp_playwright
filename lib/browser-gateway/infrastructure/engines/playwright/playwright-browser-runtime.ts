import { type Browser, type BrowserContext, type Page } from 'playwright';
import type { BrowserRuntime } from '../../../domain/browser-runtime.js';
import type { BrowserEngineId } from '../../../domain/browser-result.js';
import { launchWithFallback } from './launch-with-fallback.js';
import { attachRequestGuard } from './request-guard.js';

interface LiveSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

/**
 * Playwright-backed BrowserRuntime owned by the persistent BrowserHost.
 *
 * Each session gets its own isolated browser context + page so session A can
 * never observe session B's cookies/storage/tabs. The browser is launched headed
 * when a human takeover is required and is kept open until explicitly closed —
 * never auto-closed on task/turn completion.
 *
 * This runtime is independent of the legacy global `mcp-server/.../playwright`
 * runner so the host can own multiple isolated live sessions.
 */
export class PlaywrightBrowserRuntime implements BrowserRuntime {
  readonly engine: BrowserEngineId = 'playwright';
  private readonly sessions = new Map<string, LiveSession>();

  async openSession(sessionId: string, opts?: { headed?: boolean }): Promise<void> {
    if (this.sessions.has(sessionId)) return;

    const headed = opts?.headed ?? process.env.HEADLESS === 'false';
    const browser = await launchWithFallback({
      headless: !headed,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'es-MX',
    });
    const page = await context.newPage();
    // HIGH-4: enforce the network policy on every request (redirects +
    // subresources), not just the initial navigate URL.
    attachRequestGuard(page);
    this.sessions.set(sessionId, { browser, context, page });
  }

  async currentUrl(sessionId: string): Promise<string | undefined> {
    const live = this.sessions.get(sessionId);
    if (!live) return undefined;
    try {
      return live.page.url();
    } catch {
      return undefined;
    }
  }

  /** Expose the live page for a session (used by integration tests / tooling). */
  getPage(sessionId: string): Page | undefined {
    return this.sessions.get(sessionId)?.page;
  }

  async isAlive(sessionId: string): Promise<boolean> {
    const live = this.sessions.get(sessionId);
    if (!live) return false;
    try {
      return !live.browser.isConnected() ? false : !live.page.isClosed();
    } catch {
      return false;
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) return;
    this.sessions.delete(sessionId);
    try {
      await live.browser.close();
    } catch {
      // Already closed/crashed — nothing to release.
    }
  }

  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.closeSession(id)));
  }

  /**
   * Capture the Playwright storageState (cookies + localStorage + origins) for
   * a session. This is the sensitive payload persisted encrypted by the
   * SessionVault — never logged or returned to tool callers.
   */
  async captureAuthState(sessionId: string): Promise<unknown | undefined> {
    const live = this.sessions.get(sessionId);
    if (!live) return undefined;
    try {
      return await live.context.storageState();
    } catch {
      return undefined;
    }
  }

  async restoreAuthState(sessionId: string, state: unknown): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) return;

    const storage = state as {
      cookies?: Array<{ name: string; value: string }>;
      origins?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
    };

    // Restore cookies first so they are present for any navigation that follows.
    const cookies = storage.cookies ?? [];
    if (cookies.length > 0) {
      await live.context.addCookies(cookies);
    }

    // Restore localStorage per origin. The host navigates back to the original
    // URL after restore, so seed each captured origin's localStorage via
    // addInitScript — it runs before the page scripts on every navigation,
    // guaranteeing SPA/localStorage-backed auth survives the promotion.
    const origins = storage.origins ?? [];
    for (const origin of origins) {
      const entries = origin.localStorage ?? [];
      if (entries.length === 0) continue;
      const seed = Object.fromEntries(entries.map((e) => [e.name, e.value]));
      await live.context.addInitScript((data) => {
        try {
          window.localStorage.clear();
          for (const [key, value] of Object.entries(data)) {
            window.localStorage.setItem(key, value);
          }
        } catch {
          // Origin not yet loaded / storage unavailable — best-effort seed.
        }
      }, seed);
    }
  }

  async navigateTo(sessionId: string, url: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) return;
    try {
      await live.page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch {
      // Preserve takeover even if navigation fails; the tab stays open.
    }
  }
}
