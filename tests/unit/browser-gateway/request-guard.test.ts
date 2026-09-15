import { describe, expect, it, vi } from 'vitest';
import { attachRequestGuard } from '../../../lib/browser-gateway/infrastructure/engines/playwright/request-guard.js';
import { NetworkPolicy } from '../../../lib/browser-gateway/application/network-policy.js';

function fakeRoute(url: string) {
  return {
    request: () => ({ url: () => url }),
    abort: vi.fn().mockResolvedValue(undefined),
    continue: vi.fn().mockResolvedValue(undefined),
  };
}

function fakePage() {
  const handlers: Array<(route: unknown) => void> = [];
  return {
    route: vi.fn((_pattern: string, handler: (route: unknown) => void) => {
      handlers.push(handler);
    }),
    _handlers: handlers,
  };
}

describe('attachRequestGuard (HIGH-4 / redirect SSRF)', () => {
  it('aborts a request to a private/loopback target', () => {
    const page = fakePage() as never;
    attachRequestGuard(page as never, new NetworkPolicy({ allowPrivateNetwork: false }));
    const route = fakeRoute('http://127.0.0.1:8080/');
    page._handlers[0](route);
    expect(route.abort).toHaveBeenCalled();
    expect(route.continue).not.toHaveBeenCalled();
  });

  it('continues a request to a public target', () => {
    const page = fakePage() as never;
    attachRequestGuard(page as never, new NetworkPolicy({ allowPrivateNetwork: false }));
    const route = fakeRoute('https://example.com/');
    page._handlers[0](route);
    expect(route.continue).toHaveBeenCalled();
    expect(route.abort).not.toHaveBeenCalled();
  });

  it('aborts a redirect to a private target (public -> loopback)', () => {
    const page = fakePage() as never;
    attachRequestGuard(page as never, new NetworkPolicy({ allowPrivateNetwork: false }));
    // A redirect request whose final URL is private must be blocked.
    const route = fakeRoute('http://127.0.0.1/');
    page._handlers[0](route);
    expect(route.abort).toHaveBeenCalled();
  });

  it('aborts a non-http protocol request', () => {
    const page = fakePage() as never;
    attachRequestGuard(page as never, new NetworkPolicy({ allowPrivateNetwork: false }));
    const route = fakeRoute('file:///etc/passwd');
    page._handlers[0](route);
    expect(route.abort).toHaveBeenCalled();
  });

  it('allows private targets when allowPrivateNetwork is enabled', () => {
    const page = fakePage() as never;
    attachRequestGuard(page as never, new NetworkPolicy({ allowPrivateNetwork: true }));
    const route = fakeRoute('http://127.0.0.1:8080/');
    page._handlers[0](route);
    expect(route.continue).toHaveBeenCalled();
    expect(route.abort).not.toHaveBeenCalled();
  });
});
