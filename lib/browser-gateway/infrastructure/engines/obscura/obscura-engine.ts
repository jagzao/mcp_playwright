import type { BrowserEngine, BrowserEngineHealth } from '../../../domain/browser-engine.js';
import type { BrowserTask } from '../../../domain/browser-task.js';
import type {
  BrowserEngineId,
  BrowserEngineResult,
  BrowserFailureCategory,
} from '../../../domain/browser-result.js';
import { chromium, type Browser, type Page } from 'playwright';
import { loadObscura } from 'obscura-node';

/**
 * Obscura adapter — REAL CDP-backed engine.
 *
 * Obscura is launched via the `obscura-node` package's `loadObscura()`, which
 * starts a Rust headless-browser CDP server (`obscura serve`). This engine then
 * connects to that CDP endpoint with Playwright's `chromium.connectOverCDP` and
 * drives the page directly. This is the same drop-in CDP path verified manually
 * against Obscura on this machine: `chromium.connectOverCDP(endpoint)` ->
 * `page.goto()` -> `page.title()`.
 *
 * Contract:
 *  - Enabled when the `obscura-node` package resolves AND the binary can launch.
 *    NOT gated on `OBSCURA_MCP_COMMAND` (that was an unverified legacy contract).
 *  - `supports()` returns true only when Obscura is available AND the action is
 *    implemented here (navigate / follow_link / snapshot / extract / screenshot).
 *    For `click` / `fill` it returns false so the gateway router deterministically
 *    falls back to Playwright (the forced-fallback demonstration).
 *  - Per-session browser instances: each `sessionId` gets its own Obscura launch
 *    + CDP connection, tracked in a Map. `closeSession` tears down only that
 *    session's Obscura+CDP.
 *  - `health()` launches+closes Obscura quickly. healthy:true when it works,
 *    healthy:false (provider_unavailable) when the package/binary is unavailable.
 */

/** Actions this engine can actually execute on the CDP-backed Obscura page. */
const IMPLEMENTED_ACTIONS = new Set<BrowserTask['action']['type']>([
  'navigate',
  'follow_link',
  'snapshot',
  'extract',
  'screenshot',
]);

export interface ObscuraEngineOptions {
  /** Timeout for Obscura CDP server startup (ms). Defaults to 10s. */
  startupTimeoutMs?: number;
}

interface ObscuraInstance {
  endpoint: string;
  wsEndpoint: string;
  close: () => Promise<void>;
}

interface SessionRuntime {
  obscura: ObscuraInstance;
  browser: Browser;
  page: Page;
}

function toCategory(error: unknown): BrowserFailureCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (/invalid url|invalid selector/i.test(message)) {
    return 'invalid_request';
  }
  if (/timeout/i.test(message)) {
    return 'timeout';
  }
  if (/binary not found|unable to resolve|reinstall|executable doesn't exist/i.test(message)) {
    return 'provider_unavailable';
  }
  if (/not found|no element|detached|navigation/i.test(message)) {
    return 'transient';
  }
  return 'unknown';
}

export class ObscuraEngine implements BrowserEngine {
  readonly id: BrowserEngineId = 'obscura';

  private readonly sessions = new Map<string, SessionRuntime>();
  private availabilityProbe: Promise<boolean> | null = null;

  constructor(private readonly options: ObscuraEngineOptions = {}) {}

  /** Launch an Obscura CDP server. Kept as a method so unit tests can mock it. */
  protected async launchObscura(): Promise<ObscuraInstance> {
    return loadObscura({
      startupTimeoutMs: this.options.startupTimeoutMs ?? 10000,
    });
  }

  /** Cached probe: is Obscura available right now? */
  private ready(): Promise<boolean> {
    this.availabilityProbe ??= this.probe();
    return this.availabilityProbe;
  }

  private async probe(): Promise<boolean> {
    try {
      const obscura = await this.launchObscura();
      await obscura.close().catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  private async getOrCreatePage(sessionId: string): Promise<Page> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing.page;
    }
    const obscura = await this.launchObscura();
    const browser = await chromium.connectOverCDP(obscura.wsEndpoint);
    const page = await browser.newPage();
    this.sessions.set(sessionId, { obscura, browser, page });
    return page;
  }

  async createSession(_sessionId: string): Promise<void> {
    // No-op: each session's Obscura+CDP is launched lazily on first execution.
    return;
  }

  async closeSession(sessionId: string): Promise<void> {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) return;
    this.sessions.delete(sessionId);
    try {
      await runtime.browser.close();
    } catch {
      // Best-effort: CDP may already be gone.
    }
    try {
      await runtime.obscura.close();
    } catch {
      // Best-effort: the Obscura process may already be gone.
    }
  }

  async health(): Promise<BrowserEngineHealth> {
    try {
      const obscura = await this.launchObscura();
      await obscura.close().catch(() => undefined);
      return {
        healthy: true,
        details: `obscura is available via obscura-node (CDP at ${obscura.endpoint})`,
      };
    } catch (error) {
      return {
        healthy: false,
        details: `obscura provider unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  async supports(task: BrowserTask): Promise<boolean> {
    if (!IMPLEMENTED_ACTIONS.has(task.action.type)) {
      // click/fill are intentionally unsupported here so the gateway router
      // deterministically falls back to Playwright.
      return false;
    }
    return this.ready();
  }

  async execute<T = unknown>(task: BrowserTask): Promise<BrowserEngineResult<T>> {
    const start = Date.now();
    let screenshotCount = 0;
    if (task.action.type === 'screenshot') screenshotCount = 1;

    if (task.action.type === 'click' || task.action.type === 'fill') {
      return {
        status: 'failure',
        engine: this.id,
        category: 'unsupported',
        message: `obscura does not support action ${task.action.type}; playwright fallback applies`,
        durationMs: Date.now() - start,
      };
    }

    if (!IMPLEMENTED_ACTIONS.has(task.action.type)) {
      return {
        status: 'failure',
        engine: this.id,
        category: 'unsupported',
        message: `obscura does not support action ${task.action.type}`,
        durationMs: Date.now() - start,
      };
    }

    if (!(await this.ready())) {
      return {
        status: 'failure',
        engine: this.id,
        category: 'provider_unavailable',
        message: 'obscura is not available (obscura-node binary could not launch)',
        durationMs: Date.now() - start,
      };
    }

    try {
      const page = await this.getOrCreatePage(task.sessionId);
      let data: unknown;

      switch (task.action.type) {
        case 'navigate':
          await page.goto(task.action.url, { waitUntil: 'load', timeout: 30000 });
          data = { url: page.url(), title: await page.title() };
          break;
        case 'follow_link':
          await page.goto(task.action.href, { waitUntil: 'load', timeout: 30000 });
          data = { url: page.url(), title: await page.title() };
          break;
        case 'snapshot': {
          const title = await page.title();
          const url = page.url();
          const bodyText = await page
            .evaluate(() => document.body?.innerText ?? '')
            .then((text: string) => text.slice(0, 4000));
          data = { title, url, bodyText };
          break;
        }
        case 'extract': {
          let text: string;
          if (task.action.selector) {
            text = await page.evaluate(
              (sel: string) => document.querySelector(sel)?.textContent ?? '',
              task.action.selector,
            );
          } else {
            text = await page.evaluate(() => document.body?.innerText ?? '');
          }
          data = { text };
          break;
        }
        case 'screenshot': {
          const buffer = await page.screenshot({ fullPage: task.action.fullPage });
          data = { size: buffer.length };
          break;
        }
        default:
          data = undefined;
      }

      return {
        status: 'success',
        engine: this.id,
        data: data as T,
        durationMs: Date.now() - start,
        screenshotCount,
      };
    } catch (error) {
      return {
        status: 'failure',
        engine: this.id,
        category: toCategory(error),
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
        screenshotCount,
      };
    }
  }
}
