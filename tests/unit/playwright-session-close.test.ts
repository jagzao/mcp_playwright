import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the browser launcher so unit tests never launch a real browser.
const closeSpy = vi.fn();
const contextCloseSpy = vi.fn();

function makePage() {
  return {
    url: vi.fn(() => 'https://example.com'),
    title: vi.fn(() => 'Example'),
    goto: vi.fn(),
    click: vi.fn(),
    fill: vi.fn(),
    screenshot: vi.fn(),
    textContent: vi.fn(),
    waitForSelector: vi.fn(),
    evaluate: vi.fn(() => 'body'),
    route: vi.fn(),
  };
}

function makeContext() {
  return {
    newPage: vi.fn(() => makePage()),
    close: contextCloseSpy,
  };
}

const contexts: any[] = [];
const fakeBrowser = {
  newContext: vi.fn(() => {
    const ctx = makeContext();
    contexts.push(ctx);
    return ctx;
  }),
  close: closeSpy,
};

vi.mock('../../lib/browser-gateway/infrastructure/engines/playwright/launch-with-fallback.js', () => ({
  launchWithFallback: vi.fn(() => Promise.resolve(fakeBrowser)),
}));

vi.mock('../../lib/browser-gateway/infrastructure/engines/playwright/request-guard.js', () => ({
  attachRequestGuard: vi.fn(),
}));

// Import AFTER mocks are registered.
import {
  runNavigate,
  runCloseSession,
  runSnapshot,
} from '../../mcp-server/src/tools/playwright/index.js';

describe('runCloseSession (per-session isolation, AC18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contexts.length = 0;
  });

  it('closes only the target session and leaves other sessions usable', async () => {
    // Create two isolated sessions.
    await runNavigate('https://a.example', 'load', 'session-a');
    await runNavigate('https://b.example', 'load', 'session-b');

    expect(contexts.length).toBe(2);

    // Close ONLY session-a.
    const result = await runCloseSession('session-a');
    expect(result).toEqual({ success: true });

    // session-a's context was closed.
    expect(contextCloseSpy).toHaveBeenCalledTimes(1);

    // session-b must still be usable (its context was NOT closed).
    const bSnapshot = await runSnapshot('session-b');
    expect(bSnapshot.success).toBe(true);
    expect(bSnapshot.url).toBe('https://example.com');

    // The browser must NOT have been closed while session-b still exists.
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('closes the browser when the last session is closed', async () => {
    await runNavigate('https://a.example', 'load', 'session-a');
    await runNavigate('https://b.example', 'load', 'session-b');

    await runCloseSession('session-a');
    expect(closeSpy).not.toHaveBeenCalled();

    await runCloseSession('session-b');
    // Last session closed -> browser torn down as an optimization.
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
