import { describe, expect, it } from 'vitest';
import { ObscuraEngine, type ObscuraConfig } from '../../../lib/browser-gateway/infrastructure/engines/obscura/obscura-engine.js';
import type { BrowserTask } from '../../../lib/browser-gateway/domain/browser-task.js';

function task(action: BrowserTask['action']): BrowserTask {
  return { taskId: 't-1', sessionId: 's-1', action };
}

describe('ObscuraEngine (US-001)', () => {
  it('when OBSCURA_MCP_COMMAND unset: supports() false, health() unhealthy, execute() provider_unavailable', async () => {
    const engine = new ObscuraEngine({ command: undefined, args: undefined });

    expect(engine.ready).toBe(false);
    expect(await engine.supports(task({ type: 'navigate', url: 'https://example.com' }))).toBe(false);

    const health = await engine.health();
    expect(health.healthy).toBe(false);

    const result = await engine.execute(task({ type: 'navigate', url: 'https://example.com' }));
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.category).toBe('provider_unavailable');
    }
  });

  it('when configured: supports() true for known actions, health() healthy', async () => {
    const config: ObscuraConfig = { command: 'obscura-mcp', args: ['--port', '9000'] };
    const engine = new ObscuraEngine(config);

    expect(engine.ready).toBe(true);
    expect(await engine.health()).toEqual({ healthy: true, details: expect.any(String) });
    expect(await engine.supports(task({ type: 'navigate', url: 'https://example.com' }))).toBe(true);
    expect(await engine.supports(task({ type: 'snapshot' }))).toBe(true);
    expect(await engine.supports(task({ type: 'click', target: '#btn' }))).toBe(true);
    expect(await engine.supports(task({ type: 'fill', target: '#input', value: 'x' }))).toBe(true);
    expect(await engine.supports(task({ type: 'extract', selector: 'h1' }))).toBe(true);
    expect(await engine.supports(task({ type: 'screenshot' }))).toBe(true);
  });

  it('when configured but contract unverified: execute() reports unsupported (fallback trigger)', async () => {
    const engine = new ObscuraEngine({ command: 'obscura-mcp' });
    const result = await engine.execute(task({ type: 'navigate', url: 'https://example.com' }));
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.category).toBe('unsupported');
    }
  });
});
