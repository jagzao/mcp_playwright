import { describe, expect, it, vi } from 'vitest';
import { ObscuraEngine } from '../../../lib/browser-gateway/infrastructure/engines/obscura/obscura-engine.js';
import type { BrowserTask } from '../../../lib/browser-gateway/domain/browser-task.js';

function task(action: BrowserTask['action']): BrowserTask {
  return { taskId: 't-1', sessionId: 's-1', action };
}

describe('ObscuraEngine (US-001 / RC acceptance S2)', () => {
  it('supports() is false when Obscura is unavailable (binary cannot launch)', async () => {
    const engine = new ObscuraEngine();
    // Mock launcher so the "ready" probe fails -> unavailable.
    vi.spyOn(engine as any, 'launchObscura').mockRejectedValue(new Error('binary not found/install'));
    expect(await engine.supports(task({ type: 'navigate', url: 'https://example.com' }))).toBe(false);
    expect(await engine.supports(task({ type: 'snapshot' }))).toBe(false);
  });

  it('supports() is true for implemented actions when Obscura is available', async () => {
    const engine = new ObscuraEngine();
    vi.spyOn(engine as any, 'launchObscura').mockResolvedValue({
      endpoint: 'http://127.0.0.1:1',
      wsEndpoint: 'ws://127.0.0.1:1/',
      close: async () => undefined,
    });
    // navigate/follow_link/snapshot/extract/screenshot are implemented.
    expect(await engine.supports(task({ type: 'navigate', url: 'https://example.com' }))).toBe(true);
    expect(await engine.supports(task({ type: 'follow_link', href: 'https://example.com' }))).toBe(true);
    expect(await engine.supports(task({ type: 'snapshot' }))).toBe(true);
    expect(await engine.supports(task({ type: 'extract', selector: 'h1' }))).toBe(true);
    expect(await engine.supports(task({ type: 'screenshot' }))).toBe(true);
  });

  it('click/fill are NOT supported by Obscura (deterministic Playwright fallback)', async () => {
    const engine = new ObscuraEngine();
    vi.spyOn(engine as any, 'launchObscura').mockResolvedValue({
      endpoint: 'http://127.0.0.1:1',
      wsEndpoint: 'ws://127.0.0.1:1/',
      close: async () => undefined,
    });
    expect(await engine.supports(task({ type: 'click', target: '#btn' }))).toBe(false);
    expect(await engine.supports(task({ type: 'fill', target: '#input', value: 'x' }))).toBe(false);
    const clickResult = await engine.execute(task({ type: 'click', target: '#btn' }));
    expect(clickResult.status).toBe('failure');
    if (clickResult.status === 'failure') expect(clickResult.category).toBe('unsupported');
  });

  it('execute() returns provider_unavailable when Obscura cannot launch', async () => {
    const engine = new ObscuraEngine();
    vi.spyOn(engine as any, 'launchObscura').mockRejectedValue(new Error('binary not found'));
    const result = await engine.execute(task({ type: 'navigate', url: 'https://example.com' }));
    expect(result.status).toBe('failure');
    if (result.status === 'failure') expect(result.category).toBe('provider_unavailable');
  });

  it('health() reports unhealthy when Obscura cannot launch', async () => {
    const engine = new ObscuraEngine();
    vi.spyOn(engine as any, 'launchObscura').mockRejectedValue(new Error('binary not found'));
    const health = await engine.health();
    expect(health.healthy).toBe(false);
  });
});
