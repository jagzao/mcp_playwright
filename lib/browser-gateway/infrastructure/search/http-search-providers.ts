/**
 * HTTP search providers (Brave Search API default, Exa fallback, Tavily
 * optional) reading API keys from a `SecretProvider` (env in dev). Provider
 * specifics are isolated here, never in research domain logic (AC21/AC22).
 *
 * No real key is required in tests — those use `FakeSearchProvider`. When no
 * key is resolvable, `available()` returns false so the router falls back to
 * the next candidate deterministically.
 */

import type { SecretProvider } from '../../application/secret-provider.js';
import type { SearchOptions, SearchProvider, SearchResponse } from '../../application/search-provider-router.js';

export interface HttpSearchAdapter {
  readonly id: string;
  readonly secretRef: string;
  /**
   * Build the request. `secret` is the resolved API key; the implementation
   * must embed it where its vendor requires (header or body). Never log it.
   */
  buildRequest(
    opts: SearchOptions,
    secret: string,
  ): { url: string; headers: Record<string, string>; body?: string };
  parseResponse(json: unknown): Array<{ title: string; url: string; snippet: string; publishedAt?: string }>;
}

/**
 * Issue the HTTP request. Kept injectable for tests so no real billed network
 * is ever required by unit/integration suites.
 */
export async function performSearchRequest(
  url: string,
  headers: Record<string, string>,
  body?: string,
  fetchImpl: unknown = fetch,
): Promise<unknown> {
  const doFetch = fetchImpl as typeof fetch;
  const res = await doFetch(url, {
    method: body ? 'POST' : 'GET',
    headers,
    body,
  });
  if (!res.ok) throw new Error(`search http ${res.status}`);
  return res.json();
}

const SECRET_PLACEHOLDER = Object.freeze(['{SECRET}', '{secret}'] as const);

export class HttpSearchProvider implements SearchProvider {
  readonly id: string;
  private readonly secretProvider: SecretProvider;
  private readonly adapter: HttpSearchAdapter;
  private readonly fetchImpl: unknown;

  constructor(
    adapter: HttpSearchAdapter,
    secretProvider: SecretProvider,
    fetchImpl: unknown = fetch,
  ) {
    this.adapter = adapter;
    this.id = adapter.id;
    this.secretProvider = secretProvider;
    this.fetchImpl = fetchImpl;
  }

  async available(): Promise<boolean> {
    const key = await this.secretProvider.resolve(this.adapter.secretRef);
    return Boolean(key);
  }

  async searchWeb(opts: SearchOptions): Promise<SearchResponse> {
    const key = await this.secretProvider.resolve(this.adapter.secretRef);
    if (!key) throw new Error(`${this.id}: api key unavailable`);
    const req = this.adapter.buildRequest(opts, key);
    // Defensive: never send the placeholder instead of the real secret.
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k] = SECRET_PLACEHOLDER.includes(v as never) ? key : v;
    }
    const body = req.body?.replace(new RegExp(SECRET_PLACEHOLDER.join('|'), 'g'), key);
    const json = await performSearchRequest(req.url, headers, body, this.fetchImpl);
    const results = this.adapter.parseResponse(json);
    return { provider: this.id, requestDurationMs: 0, results };
  }
}

// --- Brave Search API adapter -------------------------------------------------

const braveAdapter: HttpSearchAdapter = {
  id: 'brave',
  secretRef: 'search.brave',
  buildRequest(opts, secret) {
    const qs = new URLSearchParams({ q: opts.query });
    if (opts.maxResults) qs.set('count', String(opts.maxResults));
    return {
      url: `https://api.search.brave.com/res/v1/web/search?${qs.toString()}`,
      headers: { 'X-Subscription-Token': secret },
    };
  },
  parseResponse(json: unknown) {
    const web = (json as { web?: { results?: unknown[] } })?.web?.results ?? [];
    return web.map((r) => {
      const item = r as { title?: string; url?: string; description?: string };
      return {
        title: item.title ?? '',
        url: item.url ?? '',
        snippet: item.description ?? '',
      };
    });
  },
};

// --- Exa adapter --------------------------------------------------------------

const exaAdapter: HttpSearchAdapter = {
  id: 'exa',
  secretRef: 'search.exa',
  buildRequest(opts, secret) {
    return {
      url: 'https://api.exa.ai/search',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': secret,
      },
      body: JSON.stringify({
        query: opts.query,
        numResults: opts.maxResults ?? 5,
        useAutoprompt: false,
      }),
    };
  },
  parseResponse(json: unknown) {
    const results = (json as { results?: unknown[] })?.results ?? [];
    return results.map((r) => {
      const item = r as { title?: string; url?: string; text?: string; publishedDate?: string };
      return {
        title: item.title ?? '',
        url: item.url ?? '',
        snippet: (item.text ?? '').slice(0, 300),
        publishedAt: item.publishedDate,
      };
    });
  },
};

// --- Tavily adapter -----------------------------------------------------------

const tavilyAdapter: HttpSearchAdapter = {
  id: 'tavily',
  secretRef: 'search.tavily',
  buildRequest(opts, secret) {
    return {
      url: 'https://api.tavily.com/search',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: secret,
        query: opts.query,
        max_results: opts.maxResults ?? 5,
        search_depth: 'basic',
      }),
    };
  },
  parseResponse(json: unknown) {
    const results = (json as { results?: unknown[] })?.results ?? [];
    return results.map((r) => {
      const item = r as { title?: string; url?: string; content?: string; published_date?: string };
      return {
        title: item.title ?? '',
        url: item.url ?? '',
        snippet: item.content ?? '',
        publishedAt: item.published_date,
      };
    });
  },
};

/** Create a provider for a given id. Only these candidates are recognized. */
export function createHttpSearchProvider(
  id: string,
  secretProvider: SecretProvider,
  fetchImpl?: typeof fetch,
): SearchProvider | undefined {
  if (id === 'brave') return new HttpSearchProvider(braveAdapter, secretProvider, fetchImpl);
  if (id === 'exa') return new HttpSearchProvider(exaAdapter, secretProvider, fetchImpl);
  if (id === 'tavily') return new HttpSearchProvider(tavilyAdapter, secretProvider, fetchImpl);
  return undefined;
}
