import type { BrowserEngine, BrowserEngineHealth } from '../../../domain/browser-engine.js';
import type { BrowserTask } from '../../../domain/browser-task.js';
import type { BrowserEngineId, BrowserEngineResult, BrowserFailureCategory } from '../../../domain/browser-result.js';
import {
  runNavigate,
  runSnapshot,
  runClick,
  runFill,
  runExtract,
  runScreenshot,
  runClose,
} from '../../../../../mcp-server/src/tools/playwright/index.js';

/**
 * Playwright adapter wrapping the existing Playwright automation.
 *
 * This does NOT reimplement Playwright. It maps the BrowserEngine contract onto
 * the existing runner functions in `mcp-server/src/tools/playwright/index.ts`
 * (which already apply the input sanitizer for URL/selector validation and
 * share the browser/page lifecycle), so backward-compatible Playwright behavior
 * is preserved and no business logic is duplicated.
 */

function toCategory(error: unknown): BrowserFailureCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (/browser.*not.*installed|executable doesn't exist|playwright.*install/i.test(message)) {
    return 'provider_unavailable';
  }
  if (/invalid url|invalid selector/i.test(message)) {
    return 'invalid_request';
  }
  if (/timeout/i.test(message)) {
    return 'timeout';
  }
  if (/not found|no element|detached/i.test(message)) {
    return 'transient';
  }
  return 'unknown';
}

export class PlaywrightEngine implements BrowserEngine {
  readonly id: BrowserEngineId = 'playwright';

  async createSession(sessionId: string): Promise<void> {
    // Session is lazily created on first navigation via the shared ensureBrowser().
    return;
  }

  async closeSession(sessionId: string): Promise<void> {
    await runClose();
  }

  async health(): Promise<BrowserEngineHealth> {
    return {
      healthy: true,
      details: 'playwright adapter is available and will launch chromium on demand',
    };
  }

  async supports(task: BrowserTask): Promise<boolean> {
    return [
      'navigate',
      'snapshot',
      'click',
      'fill',
      'extract',
      'screenshot',
    ].includes(task.action.type);
  }

  async execute<T = unknown>(task: BrowserTask): Promise<BrowserEngineResult<T>> {
    const start = Date.now();
    let screenshotCount = 0;
    if (task.action.type === 'screenshot') screenshotCount = 1;

    try {
      let data: unknown;
      switch (task.action.type) {
        case 'navigate':
          data = await runNavigate(task.action.url);
          break;
        case 'snapshot':
          data = await runSnapshot();
          break;
        case 'click':
          data = await runClick(task.action.target);
          break;
        case 'fill':
          data = await runFill(task.action.target, task.action.value);
          break;
        case 'extract':
          data = await runExtract(task.action.selector);
          break;
        case 'screenshot':
          data = await runScreenshot(undefined, task.action.fullPage);
          break;
        default:
          return {
            status: 'failure',
            engine: this.id,
            category: 'unsupported',
            message: `playwright does not support action ${task.action.type}`,
            durationMs: Date.now() - start,
          };
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
