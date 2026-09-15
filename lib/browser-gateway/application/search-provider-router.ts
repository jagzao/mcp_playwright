/**
 * Provider-neutral search discovery (US-003 / Phase D).
 *
 * Research domain logic must never know which vendor is answering a query.
 * `SearchProviderRouter` exposes a single `searchWeb` contract and selects the
 * concrete provider from configuration/health, exactly like `LlmOperatorRouter`.
 *
 * Candidates are injected as adapters so tests can replace them with fakes —
 * never requiring a real billed API key. Selection is config/benchmark-driven,
 * not hard-coded (AC22).
 */

/** Coarse source classification used by researchers (not the same as `primary`/`secondary` evidence). */
export type SearchSourceKinds = 'web' | 'news';

export interface SearchOptions {
  query: string;
  kind?: SearchSourceKinds;
  maxResults?: number;
  /** Restrict to a publication/update window (e.g. days). Optional. */
  freshnessDays?: number;
  /** Optional extra provider-neutral filters (domain allow/deny handled upstream). */
  domains?: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** ISO date when available. Time-sensitive claims must check this. */
  publishedAt?: string;
}

export interface SearchResponse {
  provider: string;
  results: SearchResult[];
  requestDurationMs: number;
}

/**
 * A search provider adapter. Implementations are infrastructure; they resolve
 * their own API key via a `SecretProvider` and must never return the key to
 * callers.
 */
export interface SearchProvider {
  readonly id: string;
  /** True when this provider is reachable/configurable right now. */
  available(): Promise<boolean> | boolean;
  searchWeb(opts: SearchOptions): Promise<SearchResponse>;
}

export interface SearchProviderRouterConfig {
  /** Ordered candidate ids, first being preferred. Selection is config/benchmark driven. */
  candidates: string[];
  fallbackBehavior: 'next-available' | 'stop';
}

/** Environment-driven default config (never referenced by research domain logic). */
export function searchRouterConfigFromEnv(): SearchProviderRouterConfig {
  const ordered =
    (process.env.SEARCH_PROVIDER_ORDER || 'brave,exa,tavily')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  return {
    candidates: ordered.length ? ordered : ['brave', 'exa', 'tavily'],
    fallbackBehavior: 'next-available',
  };
}

export type SearchRouteOutcome =
  | { status: 'success'; response: SearchResponse; selected: string }
  | { status: 'unavailable'; reason: string };

/**
 * Routes a discovery query to the configured provider with a bounded fallback:
 * preferred -> next available candidate. Never throws for provider
 * unavailability; callers receive a typed outcome.
 */
export class SearchProviderRouter {
  private readonly providers: Map<string, SearchProvider>;
  private readonly requestedOrder: string[];
  private readonly fallbackBehavior: SearchProviderRouterConfig['fallbackBehavior'];

  constructor(
    providers: SearchProvider[],
    config: SearchProviderRouterConfig = searchRouterConfigFromEnv(),
  ) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
    this.requestedOrder = config.candidates;
    this.fallbackBehavior = config.fallbackBehavior;
  }

  /** The preferred provider id from config (may be unavailable). */
  preferred(): string | undefined {
    return this.requestedOrder[0];
  }

  /** Ordered candidate ids that are registered. */
  candidateIds(): string[] {
    return this.requestedOrder.filter((id) => this.providers.has(id));
  }

  /**
   * Search the web for `query`. Picks the preferred configured provider and, on
   * unavailability, falls back to the next registered candidate (bounded).
   */
  async searchWeb(query: string, opts: Partial<SearchOptions> = {}): Promise<SearchRouteOutcome> {
    const options: SearchOptions = { query, ...opts };
    const candidates = this.candidateIds();

    for (const id of candidates) {
      const provider = this.providers.get(id);
      if (!provider) continue;
      if (!(await provider.available())) continue;
      try {
        const response = await provider.searchWeb(options);
        return { status: 'success', response, selected: provider.id };
      } catch {
        // Try the next candidate (provider error is also a "fallback" trigger).
        continue;
      }
    }

    return { status: 'unavailable', reason: 'no_search_provider_available' };
  }

  /**
   * Return per-provider availability for diagnostics/telemetry (never secrets).
   */
  async capabilities(): Promise<Array<{ id: string; available: boolean }>> {
    const out: Array<{ id: string; available: boolean }> = [];
    for (const id of this.requestedOrder) {
      const provider = this.providers.get(id);
      if (!provider) continue;
      out.push({ id, available: Boolean(await provider.available()) });
    }
    return out;
  }
}
