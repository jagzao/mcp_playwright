/**
 * WebMCP detection adapter boundary (US-004 AC31 / webmcp-strategy.md).
 *
 * This is a BOUNDARY/adapter, NOT a full WebMCP client implementation. It
 * detects whether a page exposes the WebMCP API (`document.modelContext`) and,
 * when enabled and a compatible owned page is detected, signals that WebMCP
 * semantic tools could be preferred over DOM scraping.
 *
 * It is feature-flagged (`WEBMCP_ENABLED`, default `false`). When disabled or
 * when no compatible owned page is detected, the gateway continues with normal
 * Obscura/Playwright operation. This adapter never blocks core V1 browser
 * execution.
 *
 * Detection is intentionally conservative: it only reports a positive when the
 * feature flag is on AND the page is owned AND the page exposes the WebMCP API.
 * The actual tool invocation is left to a future WebMCP client; this boundary
 * only decides whether that path is worth attempting.
 */

import { WebMCPPolicy } from '../../application/webmcp-policy.js';

export interface WebMCPAdapterOptions {
  policy: WebMCPPolicy;
  /** Optional injected detector for deterministic tests. */
  detectModelContext?: (url: string) => boolean;
}

export type WebMCPDetection =
  | {
      status: 'webmcp_available';
      url: string;
      domain: string;
      reason: string;
    }
  | {
      status: 'webmcp_unavailable';
      url: string;
      domain: string;
      reason: 'webmcp_disabled' | 'not_owned' | 'no_model_context';
    };

/**
 * Default detector: checks whether the page exposes `document.modelContext`.
 * In a real browser this would be evaluated in the page context; here it is a
 * pure function so the boundary is testable without a live browser. When the
 * feature flag is off we never probe the page.
 */
function defaultDetectModelContext(_url: string): boolean {
  // No live browser in the boundary layer. Real detection would run
  // `typeof document.modelContext !== 'undefined'` in the page context.
  return false;
}

export class WebMCPAdapter {
  private readonly policy: WebMCPPolicy;
  private readonly detectModelContext: (url: string) => boolean;

  constructor(options: WebMCPAdapterOptions) {
    this.policy = options.policy;
    this.detectModelContext =
      options.detectModelContext ?? defaultDetectModelContext;
  }

  /**
   * Detect whether WebMCP semantic tools could be preferred for the given URL.
   * Returns `webmcp_available` only when the feature flag is on, the page is
   * owned, and the page exposes the WebMCP API. Otherwise the gateway continues
   * with normal Obscura/Playwright operation.
   */
  detect(url: string): WebMCPDetection {
    let domain: string;
    try {
      domain = new URL(url).hostname;
    } catch {
      domain = '';
    }

    if (!this.policy.isEnabled()) {
      return { status: 'webmcp_unavailable', url, domain, reason: 'webmcp_disabled' };
    }

    const eligibility = this.policy.classifyPage(domain);
    if (!eligibility.eligible) {
      return { status: 'webmcp_unavailable', url, domain, reason: 'not_owned' };
    }

    if (!this.detectModelContext(url)) {
      return { status: 'webmcp_unavailable', url, domain, reason: 'no_model_context' };
    }

    return {
      status: 'webmcp_available',
      url,
      domain,
      reason: 'owned page exposes document.modelContext; WebMCP semantic tools may be preferred',
    };
  }
}
