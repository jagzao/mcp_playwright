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
    try {
      const verdict = policy.assess(route.request().url());
      if (!verdict.ok) {
        route.abort().catch(() => undefined);
      } else {
        route.continue().catch(() => undefined);
      }
    } catch {
      // The page/context/browser may have been closed while this route handler
      // was pending (e.g. host.closeAll() during teardown). Playwright throws
      // "Target page, context or browser has been closed" in that case. Swallow
      // it so it never surfaces as an unhandled rejection.
    }
  };
  // `page.route()` returns a Promise. If the page/context/browser is closed
  // while the route is being registered (e.g. a probe opens and closes a
  // session rapidly), it rejects with "Target page, context or browser has
  // been closed". The guard is a fire-and-forget network policy, so a failure
  // to register it on a closing page is non-critical: swallow the rejection so
  // it never surfaces as an unhandled rejection.
  // `page.route()` returns a Promise<void>. If the page is closed while the
  // route is being registered (e.g. a probe opens/closes a session rapidly), it
  // rejects with "Target page, context or browser has been closed". The guard
  // is a fire-and-forget network policy, so a failure to register on a closing
  // page is non-critical. Swallow the rejection so it never surfaces as an
  // unhandled rejection. `?.catch?.()` also keeps mocks that return void happy.
  page.route('**/*', handler)?.catch?.(() => undefined);
  return handler;
}
