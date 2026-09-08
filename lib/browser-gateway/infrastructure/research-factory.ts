/**
 * Factory wiring a ready-to-use Research Agent from configuration.
 *
 * Search providers come from env (Brave default, Exa/Tavily fallback) through a
 * `SecretProvider`; no real key is required in tests because tests inject fakes.
 * Reads flow through the `BrowserGateway` facade via `GatewaySourceReader`.
 *
 * Transport layers (MCP, CLI) consume this so research business logic is not
 * duplicated (AC23).
 */

import { ResearchAgent } from '../application/research-agent.js';
import { SearchProviderRouter } from '../application/search-provider-router.js';
import type { SourceReader } from '../application/source-reader.js';
import type { SecretProvider } from '../application/secret-provider.js';
import { EnvSecretProvider } from './secret-provider/env-secret-provider.js';
import { FakeSearchProvider } from './search/fake-search-provider.js';
import { createHttpSearchProvider } from './search/http-search-providers.js';
import { GatewaySourceReader } from './gateway-source-reader.js';
import type { BrowserGateway } from '../application/browser-gateway.js';

export interface ResearchFactoryOptions {
  gateway: BrowserGateway;
  secretProvider?: SecretProvider;
  /** Injected reader override (e.g. fake for CLI smoke without a browser). */
  reader?: SourceReader;
  sessionId?: string;
}

export function createResearchAgent(options: ResearchFactoryOptions): ResearchAgent {
  const secretProvider = options.secretProvider ?? new EnvSecretProvider();
  const providers = buildSearchProviders(secretProvider);
  const router = new SearchProviderRouter(providers);
  const reader =
    options.reader ??
    new GatewaySourceReader(options.gateway, options.sessionId ?? 'research');

  return new ResearchAgent({ searchRouter: router, reader, secretProvider });
}

/** Build the env-configurable provider set plus a fake fallback (never throws). */
function buildSearchProviders(secretProvider: SecretProvider): import('../application/search-provider-router.js').SearchProvider[] {
  const providers: import('../application/search-provider-router.js').SearchProvider[] = [];
  const order = (process.env.SEARCH_PROVIDER_ORDER || 'brave,exa,tavily')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  for (const id of order) {
    const http = createHttpSearchProvider(id, secretProvider);
    if (http) providers.push(http);
  }

  // A fake always present so an offline/CI run never hard-fails; the router will
  // only reach it if no env provider is configured.
  if (process.env.SEARCH_FAKE_ENABLED !== 'false') {
    providers.push(
      new FakeSearchProvider('fake', {
        results: [],
        available: false, // default: not reachable unless explicitly enabled
      }),
    );
  }
  return providers;
}
