import type { BrowserEngineResult, BrowserFailureCategory } from '../domain/browser-result.js';

const FALLBACK_CATEGORIES: ReadonlySet<BrowserFailureCategory> = new Set([
  'unsupported',
  'timeout',
  'transient',
  'provider_unavailable',
]);

export function shouldFallback(result: BrowserEngineResult): boolean {
  return result.status === 'failure' && FALLBACK_CATEGORIES.has(result.category);
}

export function isPolicyBlock(result: BrowserEngineResult): boolean {
  return (
    result.status === 'failure' &&
    (result.category === 'security_blocked' ||
      result.category === 'approval_required' ||
      result.category === 'invalid_request')
  );
}
