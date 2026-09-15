import { describe, expect, it } from 'vitest';
import { isPolicyBlock, shouldFallback } from '../../../lib/browser-gateway/application/fallback-policy.js';
import type { BrowserEngineResult } from '../../../lib/browser-gateway/domain/browser-result.js';

function failure(category: Extract<BrowserEngineResult, { status: 'failure' }>['category']): BrowserEngineResult {
  return {
    status: 'failure',
    engine: 'obscura',
    category,
    message: category,
    durationMs: 1,
  };
}

describe('browser gateway fallback policy', () => {
  it.each(['unsupported', 'timeout', 'transient', 'provider_unavailable'] as const)(
    'allows fallback for %s',
    category => {
      expect(shouldFallback(failure(category))).toBe(true);
    },
  );

  it.each(['security_blocked', 'approval_required', 'invalid_request'] as const)(
    'never bypasses policy block via fallback for %s',
    category => {
      const result = failure(category);
      expect(shouldFallback(result)).toBe(false);
      expect(isPolicyBlock(result)).toBe(true);
    },
  );

  it('does not fallback after success', () => {
    const result: BrowserEngineResult = {
      status: 'success',
      engine: 'obscura',
      data: { ok: true },
      durationMs: 1,
    };

    expect(shouldFallback(result)).toBe(false);
    expect(isPolicyBlock(result)).toBe(false);
  });
});
