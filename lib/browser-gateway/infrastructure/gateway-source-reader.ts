/**
 * Browser-Gateway-backed `SourceReader`.
 *
 * Reads a source page through the existing `BrowserGateway` facade so every
 * read benefits from the same safety gate, SSRF/network policy, Obscura-first +
 * Playwright fallback and telemetry that production browser work uses. The
 * research domain logic only depends on the `SourceReader` interface; this class
 * is the transport/browser integration.
 */

import type { BrowserGateway } from '../application/browser-gateway.js';
import type { SourceReader, SourceReadResult } from '../application/source-reader.js';

interface HeadingsText {
  headings: string[];
  text: string;
}

/** Best-effort heading + text extraction from a snapshot payload. */
function extractHeadingsAndText(payload: unknown): HeadingsText {
  const headings: string[] = [];
  let text = '';
  const add = (value: unknown) => {
    if (typeof value === 'string') text += value + ' ';
    else if (typeof value === 'number') text += String(value) + ' ';
  };
  const walk = (node: unknown) => {
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (v && typeof v === 'object') walk(v);
        else if (typeof v === 'string' || typeof v === 'number') add(v);
      }
    } else {
      add(node);
    }
  };
  walk(payload);
  return { headings, text };
}

export class GatewaySourceReader implements SourceReader {
  constructor(
    private readonly gateway: BrowserGateway,
    private readonly sessionId: string,
  ) {}

  async read(url: string): Promise<SourceReadResult> {
    // 1) Navigate (network/SSRF policy applies here, regardless of engine).
    const nav = await this.gateway.executeTask({
      taskId: `research-nav-${Date.now()}`,
      sessionId: this.sessionId,
      action: { type: 'navigate', url },
    });
    if (nav.status !== 'success') {
      return {
        status: nav.status === 'blocked' ? 'blocked' : 'unavailable',
        reason: nav.status === 'blocked' ? nav.reason : 'navigation_failed',
      };
    }

    // 2) Extract structured/DOM text (DOM-first, cost-aware — no screenshot).
    const extract = await this.gateway.executeTask({
      taskId: `research-extract-${Date.now()}`,
      sessionId: this.sessionId,
      action: { type: 'extract', selector: 'body' },
    });
    if (extract.status !== 'success') {
      return { status: 'unavailable', reason: 'extract_failed' };
    }

    const payload = (extract.data as { text?: string; title?: string }) ?? {};
    const text = payload.text ?? '';
    return {
      status: 'success',
      page: {
        url,
        title: payload.title ?? '',
        text,
        headings: [],
        fetchedAt: new Date().toISOString(),
      },
    };
  }
}
