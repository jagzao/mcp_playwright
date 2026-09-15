import { describe, expect, it } from 'vitest';
import { scoreSource } from '../../../lib/browser-gateway/application/source-ranking.js';

describe('source-ranking (US-003)', () => {
  it('scores higher with explicit relevance and returns a bounded 0..1 value', () => {
    const low = scoreSource({
      title: 't',
      url: 'https://example.com/x',
      snippet: 's',
      relevance: 0.1,
    });
    const high = scoreSource({
      title: 't',
      url: 'https://example.com/x',
      snippet: 's',
      relevance: 0.9,
    });
    expect(high.relevance).toBe(0.9);
    expect(high.quality).toBeGreaterThan(low.quality);
    expect(high.quality).toBeGreaterThanOrEqual(0);
    expect(high.quality).toBeLessThanOrEqual(1);
  });

  it('defaults relevance to 0.5 when not provided', () => {
    const score = scoreSource({ title: 't', url: 'https://example.com/x', snippet: 's' });
    expect(score.relevance).toBe(0.5);
  });

  it('ranks configured primary domains above unknown/opaque domains', () => {
    const primary = scoreSource({
      url: 'https://official.gov/report',
      title: 'Report',
      snippet: 'official findings',
      publishedAt: '2024-01-01T00:00:00Z',
      primaryDomains: ['official.gov'],
    });
    const opaque = scoreSource({
      url: 'https://vendor.example/report',
      title: 'Report',
      snippet: 'findings',
      publishedAt: '2024-01-01T00:00:00Z',
      highCoIDomains: ['vendor.example'],
    });
    expect(primary.authority).toBeGreaterThan(opaque.authority);
    expect(primary.quality).toBeGreaterThan(opaque.quality);
  });

  it('ranks high-conflict-of-interest domains lower than neutral secondary sources', () => {
    const coi = scoreSource({
      url: 'https://advertiser.example/x',
      title: 't',
      snippet: 's',
      highCoIDomains: ['advertiser.example'],
    });
    const neutral = scoreSource({ url: 'https://neutral.example/x', title: 't', snippet: 's' });
    expect(coi.quality).toBeLessThan(neutral.quality);
  });

  it('freshness decreases with age, unknown dates are neutral', () => {
    const recent = scoreSource({ title: 't', url: 'https://x.example/1', snippet: 's', publishedAt: new Date().toISOString() });
    const old = scoreSource({ title: 't', url: 'https://x.example/1', snippet: 's', publishedAt: '2000-01-01T00:00:00Z' });
    const unknown = scoreSource({ title: 't', url: 'https://x.example/1', snippet: 's' });

    expect(recent.freshness).toBeGreaterThan(old.freshness);
    expect(unknown.freshness).toBe(0.5);
  });
});
