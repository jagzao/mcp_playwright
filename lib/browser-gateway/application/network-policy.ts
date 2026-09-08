/**
 * Trusted navigation/network policy applied independently of the browser engine.
 *
 * Arbitrary navigation is a security boundary. This policy denies non-http(s)
 * protocols and denies private/loopback/link-local targets by default so an
 * agent (or a malicious page) cannot pivot into the host network (SSRF).
 *
 * Behavior is configurable via `BROWSER_ALLOW_PRIVATE_NETWORK` (default false)
 * and may be overridden by an injected options object for deterministic tests.
 */

export interface NetworkPolicyOptions {
  allowPrivateNetwork: boolean;
}

export type UrlVerdict =
  | { ok: true }
  | { ok: false; reason: 'not_http' }
  | { ok: false; reason: 'invalid_url' }
  | { ok: false; reason: 'private_or_loopback_denied' };

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isPrivateOrLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (LOOPBACK_HOSTS.has(h)) return true;

  // IPv4 private/loopback/link-local ranges.
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map((n) => parseInt(n, 10));
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
    if (a === 0) return true; // 0.0.0.0/8
  }

  // IPv6 loopback and link-local / unique-local prefixes.
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA fc00::/7
  if (h === 'fe80' || h.startsWith('fe80:')) return true; // link-local

  if (h.endsWith('.local') || h.endsWith('.localhost')) return true;

  return false;
}

export class NetworkPolicy {
  private readonly allowPrivateNetwork: boolean;

  constructor(options?: Partial<NetworkPolicyOptions>) {
    this.allowPrivateNetwork =
      options?.allowPrivateNetwork ??
      process.env.BROWSER_ALLOW_PRIVATE_NETWORK === 'true';
  }

  assess(url: string): UrlVerdict {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: 'invalid_url' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: 'not_http' };
    }

    if (!this.allowPrivateNetwork && isPrivateOrLoopback(parsed.hostname)) {
      return { ok: false, reason: 'private_or_loopback_denied' };
    }

    return { ok: true };
  }
}

/**
 * Convenience shared instance. Tests may construct their own with injected
 * options to avoid cross-test environment coupling.
 */
export const defaultNetworkPolicy = new NetworkPolicy();
