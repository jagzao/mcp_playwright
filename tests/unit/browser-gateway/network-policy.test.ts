import { describe, expect, it } from 'vitest';
import { NetworkPolicy } from '../../../lib/browser-gateway/application/network-policy.js';

describe('NetworkPolicy (US-001)', () => {
  it('denies private/loopback/localhost by default', () => {
    const policy = new NetworkPolicy({ allowPrivateNetwork: false });
    expect(policy.assess('http://127.0.0.1/')).toEqual({ ok: false, reason: 'private_or_loopback_denied' });
    expect(policy.assess('http://localhost/')).toEqual({ ok: false, reason: 'private_or_loopback_denied' });
    expect(policy.assess('http://10.0.0.5/')).toEqual({ ok: false, reason: 'private_or_loopback_denied' });
    expect(policy.assess('http://192.168.1.1/')).toEqual({ ok: false, reason: 'private_or_loopback_denied' });
    expect(policy.assess('http://172.16.0.1/')).toEqual({ ok: false, reason: 'private_or_loopback_denied' });
  });

  it('allows public http/https', () => {
    const policy = new NetworkPolicy({ allowPrivateNetwork: false });
    expect(policy.assess('https://example.com/')).toEqual({ ok: true });
    expect(policy.assess('http://example.com/path?q=1')).toEqual({ ok: true });
  });

  it('denies non-http(s) protocols', () => {
    const policy = new NetworkPolicy({ allowPrivateNetwork: false });
    expect(policy.assess('file:///etc/passwd')).toEqual({ ok: false, reason: 'not_http' });
    expect(policy.assess('ftp://example.com/')).toEqual({ ok: false, reason: 'not_http' });
    expect(policy.assess('javascript:alert(1)')).toEqual({ ok: false, reason: 'not_http' });
  });

  it('denies invalid URLs', () => {
    const policy = new NetworkPolicy({ allowPrivateNetwork: false });
    expect(policy.assess('not a url')).toEqual({ ok: false, reason: 'invalid_url' });
  });

  it('allows private network when explicitly enabled', () => {
    const policy = new NetworkPolicy({ allowPrivateNetwork: true });
    expect(policy.assess('http://127.0.0.1/')).toEqual({ ok: true });
  });
});
