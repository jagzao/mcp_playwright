import { describe, expect, it } from 'vitest';
import { WebMCPPolicy } from '../../../lib/browser-gateway/application/webmcp-policy.js';
import { WebMCPAdapter } from '../../../lib/browser-gateway/infrastructure/webmcp/webmcp-adapter.js';

const OWNED = ['app.interviewnail.example', 'marketing.example'];

function makeAdapter(
  enabled: boolean,
  detectModelContext?: (url: string) => boolean,
): WebMCPAdapter {
  const policy = new WebMCPPolicy({ enabled, ownedDomains: OWNED });
  return new WebMCPAdapter({ policy, detectModelContext });
}

describe('WebMCPAdapter boundary (US-004 AC31)', () => {
  it('reports webmcp_unavailable when the feature flag is off (default)', () => {
    const adapter = makeAdapter(false, () => true);
    expect(adapter.detect('https://app.interviewnail.example/')).toEqual({
      status: 'webmcp_unavailable',
      url: 'https://app.interviewnail.example/',
      domain: 'app.interviewnail.example',
      reason: 'webmcp_disabled',
    });
  });

  it('reports webmcp_available for an owned page exposing document.modelContext', () => {
    const adapter = makeAdapter(true, () => true);
    expect(adapter.detect('https://app.interviewnail.example/')).toEqual({
      status: 'webmcp_available',
      url: 'https://app.interviewnail.example/',
      domain: 'app.interviewnail.example',
      reason: expect.stringContaining('document.modelContext'),
    });
  });

  it('reports webmcp_unavailable for an external site even when enabled', () => {
    const adapter = makeAdapter(true, () => true);
    expect(adapter.detect('https://www.linkedin.com/')).toEqual({
      status: 'webmcp_unavailable',
      url: 'https://www.linkedin.com/',
      domain: 'www.linkedin.com',
      reason: 'not_owned',
    });
  });

  it('reports webmcp_unavailable when the page does not expose the API', () => {
    const adapter = makeAdapter(true, () => false);
    expect(adapter.detect('https://app.interviewnail.example/')).toEqual({
      status: 'webmcp_unavailable',
      url: 'https://app.interviewnail.example/',
      domain: 'app.interviewnail.example',
      reason: 'no_model_context',
    });
  });

  it('never probes the page when the feature flag is off', () => {
    let probed = false;
    const adapter = makeAdapter(false, () => {
      probed = true;
      return true;
    });
    adapter.detect('https://app.interviewnail.example/');
    expect(probed).toBe(false);
  });
});
