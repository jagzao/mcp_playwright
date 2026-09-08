/**
 * Fake search provider for tests and offline smoke flows.
 *
 * Serves a configurable result set from memory so the whole search → read →
 * evidence pipeline can run end-to-end with zero network and zero real API
 * keys. Optionally simulates unavailability for fallback tests.
 */

import type { SearchOptions, SearchProvider, SearchResponse } from '../../application/search-provider-router.js';

export interface FakeResultFixture {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
}

export interface FakeSearchProviderOptions {
  results?: FakeResultFixture[] | ((query: string) => FakeResultFixture[]);
  available?: boolean;
  /** Simulate a provider error to exercise router fallback. */
  failWithError?: boolean;
}

export class FakeSearchProvider implements SearchProvider {
  readonly id: string;
  private readonly results: FakeResultFixture[] | ((query: string) => FakeResultFixture[]);
  private readonly available_: boolean;
  private readonly failWithError: boolean;
  searchCalls = 0;

  constructor(id: string, options: FakeSearchProviderOptions = {}) {
    this.id = id;
    this.results = options.results ?? [];
    this.available_ = options.available ?? true;
    this.failWithError = options.failWithError ?? false;
  }

  async available(): Promise<boolean> {
    return this.available_;
  }

  async searchWeb(_opts: SearchOptions): Promise<SearchResponse> {
    this.searchCalls += 1;
    if (this.failWithError) throw new Error(`${this.id}: simulated provider error`);
    const list =
      typeof this.results === 'function' ? this.results(_opts.query) : this.results;
    return {
      provider: this.id,
      requestDurationMs: 0,
      results: list.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        publishedAt: r.publishedAt,
      })),
    };
  }
}
