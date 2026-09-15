import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the playwright module so we never launch a real browser in unit tests.
const launchMock = vi.fn();
vi.mock('playwright', () => ({
  chromium: { launch: (...args: unknown[]) => launchMock(...args) },
}));

import { launchWithFallback } from '../../../lib/browser-gateway/infrastructure/engines/playwright/launch-with-fallback.js';

const missingBrowserError = new Error(
  "Executable doesn't exist at .../chromium. Run npx playwright install",
);

describe('launchWithFallback', () => {
  beforeEach(() => {
    launchMock.mockReset();
  });

  it('launches bundled chromium on first attempt when available', async () => {
    const fakeBrowser = { id: 'chromium' };
    launchMock.mockResolvedValueOnce(fakeBrowser);

    const browser = await launchWithFallback({ headless: true });

    expect(browser).toBe(fakeBrowser);
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(launchMock).toHaveBeenCalledWith({ headless: true });
  });

  it('retries with channel chrome when primary launch reports browser not installed', async () => {
    const fakeBrowser = { id: 'chrome' };
    launchMock.mockRejectedValueOnce(missingBrowserError);
    launchMock.mockResolvedValueOnce(fakeBrowser);

    const browser = await launchWithFallback({ headless: true, args: ['--flag'] });

    expect(browser).toBe(fakeBrowser);
    expect(launchMock).toHaveBeenCalledTimes(2);
    // Second call keeps the same options and adds the chrome channel.
    expect(launchMock).toHaveBeenLastCalledWith({
      headless: true,
      args: ['--flag'],
      channel: 'chrome',
    });
  });

  it('rethrows the original error when both attempts fail', async () => {
    launchMock.mockRejectedValueOnce(missingBrowserError);
    launchMock.mockRejectedValueOnce(new Error('chrome also failed'));

    await expect(launchWithFallback({ headless: true })).rejects.toBe(missingBrowserError);
    expect(launchMock).toHaveBeenCalledTimes(2);
  });

  it('rethrows non-browser-missing errors without attempting the chrome fallback', async () => {
    const otherError = new Error('some unrelated launch failure');
    launchMock.mockRejectedValueOnce(otherError);

    await expect(launchWithFallback({ headless: true })).rejects.toBe(otherError);
    expect(launchMock).toHaveBeenCalledTimes(1);
  });
});
