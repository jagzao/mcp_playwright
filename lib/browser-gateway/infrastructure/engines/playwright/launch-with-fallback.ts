import { chromium, type Browser, type LaunchOptions } from 'playwright';

/**
 * Launch a Playwright browser, falling back to the system Chrome channel when
 * the bundled chromium is not installed.
 *
 * The bundled chromium download (`npx playwright install chromium`) can fail or
 * loop on some machines. When it is unavailable Playwright throws a
 * "browser not installed / executable doesn't exist" error. In that case we
 * retry with `channel: 'chrome'`, which Playwright resolves to the system
 * Google Chrome automatically (no hardcoded path is used).
 *
 * The same `headless` and `args` options are kept in both attempts. If both
 * attempts fail, the original (primary) error is rethrown so callers see the
 * real root cause.
 */
export async function launchWithFallback(options: LaunchOptions): Promise<Browser> {
  try {
    return await chromium.launch(options);
  } catch (primaryError) {
    const message = primaryError instanceof Error ? primaryError.message : String(primaryError);
    const looksLikeMissingBrowser =
      /browser.*not.*installed|executable doesn't exist|playwright.*install|chromium.*not.*found/i.test(
        message,
      );
    if (!looksLikeMissingBrowser) {
      throw primaryError;
    }
    try {
      return await chromium.launch({ ...options, channel: 'chrome' });
    } catch {
      // Both attempts failed — surface the original error.
      throw primaryError;
    }
  }
}
