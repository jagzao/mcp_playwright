import { describe, expect, it } from 'vitest';
import {
  SearchProviderRouter,
  type SearchProvider,
  type SearchOptions,
  type SearchResponse,
} from '../../../lib/browser-gateway/application/search-provider-router.js';
import { FakeSearchProvider } from '../../../lib/browser-gateway/infrastructure/search/fake-search-provider.js';

function response(provider: string, count = 1): SearchResponse {
  return {
    provider,
    requestDurationMs: 0,
    results: Array.from({ length: count }, (_, i) => ({
      title: `${provider} result ${i}`,
      url: `https://${provider}.example/result-${i}`,
      snippet: `${provider} snippet ${i}`,
    })),
  };
}

describe('search-provider-router (US-003 / AC22)', () => {
  it('discovers sources behind a provider-neutral contract (fake works end-to-end)', async () => {
    const fake = new FakeSearchProvider('brave', { results: [{ title: 't', url: 'https://x.example/1', snippet: 's' }] });
    const router = new SearchProviderRouter([fake], { candidates: ['brave', 'exa'], fallbackBehavior: 'next-available' });

    const outcome = await router.searchWeb('query');

    expect(outcome.status).toBe('success');
    if (outcome.status === 'success') {
      expect(outcome.selected).toBe('brave');
      expect(outcome.response.results).toHaveLength(1);
    }
    expect(fake.searchCalls).toBe(1);
  });

  it('selects/falls back to another provider without touching research domain logic', async () => {
    const preferred = new FakeSearchProvider('brave', { available: false });
    const fallback = new FakeSearchProvider('exa', { results: [{ title: 't', url: 'https://exa.example/1', snippet: 's' }] });
    const router = new SearchProviderRouter([preferred, fallback], {
      candidates: ['brave', 'exa'],
      fallbackBehavior: 'next-available',
    });

    const outcome = await router.searchWeb('query');

    expect(outcome.status).toBe('success');
    if (outcome.status === 'success') {
      expect(outcome.selected).toBe('exa');
    }
    expect(preferred.searchCalls).toBe(0);
    expect(fallback.searchCalls).toBe(1);
  });

  it('falls back to the next available provider when preferred throws', async () => {
    const preferred = new FakeSearchProvider('brave', { failWithError: true });
    const fallback = new FakeSearchProvider('exa', { results: [{ title: 't', url: 'https://exa.example/1', snippet: 's' }] });
    const router = new SearchProviderRouter([preferred, fallback], {
      candidates: ['brave', 'exa'],
      fallbackBehavior: 'next-available',
    });

    const outcome = await router.searchWeb('query');

    expect(outcome.status).toBe('success');
    if (outcome.status === 'success') {
      expect(outcome.selected).toBe('exa');
    }
  });

  it('returns a typed unavailable outcome when no provider is available', async () => {
    const router = new SearchProviderRouter(
      [
        new FakeSearchProvider('brave', { available: false }),
        new FakeSearchProvider('exa', { available: false }),
      ],
      { candidates: ['brave', 'exa'], fallbackBehavior: 'next-available' },
    );

    const outcome = await router.searchWeb('query');

    expect(outcome.status).toBe('unavailable');
    expect(outcome).toEqual({ status: 'unavailable', reason: 'no_search_provider_available' });
  });

  it('exposes per-provider availability for diagnostics without secrets', async () => {
    const provider = new FakeSearchProvider('brave', { available: true });
    const router = new SearchProviderRouter([provider], { candidates: ['brave'], fallbackBehavior: 'next-available' });

    const caps = await router.capabilities();
    expect(caps).toEqual([{ id: 'brave', available: true }]);
  });

  it('advertises the configured preferred id', () => {
    const router = new SearchProviderRouter(
      [new FakeSearchProvider('brave'), new FakeSearchProvider('exa')],
      { candidates: ['brave', 'exa'], fallbackBehavior: 'next-available' },
    );
    expect(router.preferred()).toBe('brave');
    expect(router.candidateIds()).toEqual(['brave', 'exa']);
  });

  it('satisfies the SearchProvider adapter shape for a custom fake', async () => {
    const custom: SearchProvider = {
      id: 'custom',
      available: () => true,
      searchWeb: async (opts: SearchOptions): Promise<SearchResponse> => response('custom', 2),
    };
    const router = new SearchProviderRouter([custom], { candidates: ['custom'], fallbackBehavior: 'next-available' });

    const outcome = await router.searchWeb('q');
    expect(outcome.status).toBe('success');
    if (outcome.status === 'success') {
      expect(outcome.selected).toBe('custom');
      expect(outcome.response.results).toHaveLength(2);
    }
  });
});
