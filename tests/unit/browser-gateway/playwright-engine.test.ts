import { describe, expect, it, vi } from 'vitest';
import type { BrowserTask } from '../../../lib/browser-gateway/domain/browser-task.js';

function task(action: BrowserTask['action']): BrowserTask {
  return { taskId: 't-1', sessionId: 's-1', action };
}

// Mock the playwright runner module so unit tests never launch a real browser.
vi.mock('../../../mcp-server/src/tools/playwright/index.js', () => ({
  runNavigate: vi.fn(),
  runSnapshot: vi.fn(),
  runClick: vi.fn(),
  runFill: vi.fn(),
  runExtract: vi.fn(),
  runScreenshot: vi.fn(),
  runClose: vi.fn(),
}));

import { PlaywrightEngine } from '../../../lib/browser-gateway/infrastructure/engines/playwright/playwright-engine.js';
import * as runner from '../../../mcp-server/src/tools/playwright/index.js';

describe('PlaywrightEngine (US-001)', () => {
  it('supports() returns true for navigate/snapshot/click/fill/extract/screenshot', async () => {
    const engine = new PlaywrightEngine();
    expect(await engine.supports(task({ type: 'navigate', url: 'https://example.com' }))).toBe(true);
    expect(await engine.supports(task({ type: 'snapshot' }))).toBe(true);
    expect(await engine.supports(task({ type: 'click', target: '#btn' }))).toBe(true);
    expect(await engine.supports(task({ type: 'fill', target: '#input', value: 'x' }))).toBe(true);
    expect(await engine.supports(task({ type: 'extract', selector: 'h1' }))).toBe(true);
    expect(await engine.supports(task({ type: 'screenshot' }))).toBe(true);
  });

  it('maps browser-not-installed error to provider_unavailable', async () => {
    vi.mocked(runner.runNavigate).mockRejectedValue(
      new Error("Executable doesn't exist at .../chromium. Run npx playwright install"),
    );
    const engine = new PlaywrightEngine();
    const result = await engine.execute(task({ type: 'navigate', url: 'https://example.com' }));
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.category).toBe('provider_unavailable');
    }
  });

  it('maps invalid URL error to invalid_request', async () => {
    vi.mocked(runner.runNavigate).mockRejectedValue(new Error('Invalid URL: not-a-url'));
    const engine = new PlaywrightEngine();
    const result = await engine.execute(task({ type: 'navigate', url: 'not-a-url' }));
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.category).toBe('invalid_request');
    }
  });

  it('maps timeout error to timeout', async () => {
    vi.mocked(runner.runNavigate).mockRejectedValue(new Error('Timeout 30000ms exceeded'));
    const engine = new PlaywrightEngine();
    const result = await engine.execute(task({ type: 'navigate', url: 'https://example.com' }));
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.category).toBe('timeout');
    }
  });

  it('returns success with screenshotCount for screenshot action', async () => {
    vi.mocked(runner.runScreenshot).mockResolvedValue(Buffer.from('png'));
    const engine = new PlaywrightEngine();
    const result = await engine.execute(task({ type: 'screenshot' }));
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.screenshotCount).toBe(1);
    }
  });
});
