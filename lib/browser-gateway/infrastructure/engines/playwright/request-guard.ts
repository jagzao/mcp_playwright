import type { Page, Route } from 'playwright';
import { NetworkPolicy } from '../../../application/network-policy.js';

/**
 * Network/SSRF guard attached to a Playwright page.
 *
 * The gateway facade only assesses the *initial* navigate URL. Playwright
 * follows redirects and loads subresources, so a public URL that 302s to a
 * private/loopback target (or a page that fetches one) would otherwise bypass
 * the policy. This guard re-assesses every request the page makes and aborts
 * any that the NetworkPolicy denies (non-http, private/loopback, etc.).
 *
 * It is attached to every page the gateway/host creates, so redirects and
 * subresource loads are protected regardless of which engine path is used.
 */
export function attachRequestGuard(
  page: Page,
  policy: NetworkPolicy = new NetworkPolicy(),
): (route: Route) => void {
  const handler = (route: Route): void => {
    const verdict = policy.assess(route.request().url());
    if (!verdict.ok) {
      route.abort().catch(() => undefined);
    } else {
      route.continue().catch(() => undefined);
    }
  };
  page.route('**/*', handler);
  return handler;
}
