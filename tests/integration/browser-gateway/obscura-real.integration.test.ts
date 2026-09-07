import { describe, expect, it } from 'vitest';
import { ObscuraEngine } from '../../../lib/browser-gateway/infrastructure/engines/obscura/obscura-engine.js';
import { PlaywrightEngine } from '../../../lib/browser-gateway/infrastructure/engines/playwright/playwright-engine.js';
import { BrowserGateway } from '../../../lib/browser-gateway/application/browser-gateway.js';
import { LlmOperatorRouter } from '../../../lib/browser-gateway/application/llm-operator-router.js';
import { HmacApprovalRegistry } from '../../../lib/browser-gateway/application/approval-registry.js';

/**
 * Real Obscura integration (RC acceptance S2).
 *
 * Launches the actual Obscura binary (via obscura-node -> CDP) on this machine.
 * If Obscura cannot launch (external dependency missing), the test SKIPS
 * gracefully instead of failing — but it must not be treated as acceptance.
 */

function makeRouter() {
  return new LlmOperatorRouter({
    primary: { provider: 'deepseek', model: 'deepseek-v4-flash', available: () => true },
    escalation: { provider: 'gemini', model: 'gemini-3.8-flash', available: () => true },
    alternate: { provider: 'openai', model: 'gpt-5.6-luna', available: () => true },
  });
}

async function obscuraAvailable(engine: ObscuraEngine): Promise<boolean> {
  try {
    const health = await engine.health();
    return health.healthy;
  } catch {
    return false;
  }
}

describe('Real Obscura engine (RC acceptance S2)', () => {
  it('navigates + extracts a real page with engine=obscura (no fake)', async () => {
    const obscura = new ObscuraEngine();
    if (!(await obscuraAvailable(obscura))) {
      console.warn('SKIP: Obscura binary unavailable; cannot demonstrate engine=obscura.');
      return;
    }

    const registry = new HmacApprovalRegistry('test-secret-0123456789abcdef0123456789abcdef');
    const gateway = new BrowserGateway({
      primaryEngine: obscura,
      fallbackEngine: new PlaywrightEngine(),
      llmRouter: makeRouter(),
      approvalRegistry: registry,
    });

    try {
      // Real navigate through the gateway.
      const nav = await gateway.executeTask({
        taskId: 'obscura-acceptance-nav',
        sessionId: 'obscura-acceptance',
        action: { type: 'navigate', url: 'https://example.com' },
      });
      expect(nav.status).toBe('success');
      if (nav.status === 'success') {
        expect(nav.telemetry.engine).toBe('obscura');
        const data = nav.data as { url: string; title: string };
        expect(data.url).toContain('example.com');
        expect(data.title.length).toBeGreaterThan(0);
      }

      // Real extract through the gateway.
      const extract = await gateway.executeTask({
        taskId: 'obscura-acceptance-extract',
        sessionId: 'obscura-acceptance',
        action: { type: 'extract', selector: 'h1' },
      });
      expect(extract.status).toBe('success');
      if (extract.status === 'success') {
        expect(extract.telemetry.engine).toBe('obscura');
      }
    } finally {
      await gateway.closeSession('obscura-acceptance').catch(() => undefined);
    }
  }, 60000);

  it('a click (unsupported by Obscura) falls back deterministically to Playwright exactly once', async () => {
    const obscura = new ObscuraEngine();
    if (!(await obscuraAvailable(obscura))) {
      console.warn('SKIP: Obscura binary unavailable; cannot demonstrate Obscura->Playwright fallback.');
      return;
    }

    const registry = new HmacApprovalRegistry('test-secret-0123456789abcdef0123456789abcdef');
    const gateway = new BrowserGateway({
      primaryEngine: obscura,
      fallbackEngine: new PlaywrightEngine(),
      llmRouter: makeRouter(),
      approvalRegistry: registry,
    });

    try {
      // A raw click requires approval (approval gate blocks before engine)
      // AND Obscura does not implement click. To prove the FALLBACK path, we
      // navigate (approved/read-only is auto-allowed) then assert the click is
      // approval-gated; the fallback is proven by the navigate on an action
      // Obscura implements but Playwright also does. Instead, prove fallback by
      // issuing a click that is approval_required then approving it and
      // observing engine=playwright (playwright implements click, obscura does
      // not).
      const nav = await gateway.executeTask({
        taskId: 'obscura-fallback-nav',
        sessionId: 'obscura-fallback',
        action: { type: 'navigate', url: 'https://example.com' },
      });
      expect(nav.status).toBe('success');

      // First click is blocked (approval_required).
      const blocked = await gateway.executeTask({
        taskId: 'obscura-fallback-click',
        sessionId: 'obscura-fallback',
        action: { type: 'click', target: 'body' },
      });
      expect(blocked.status).toBe('blocked');
      if (blocked.status !== 'blocked') return;
      const pendingId = blocked.pendingId!;

      // Approve via the operator channel (registry).
      const approved = registry.approve(pendingId, 'operator');
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;

      // Retry the EXACT same action (same target) with the one-time token.
      // Obscura does NOT implement click, so the router falls back to
      // Playwright, which implements click. This proves the deterministic
      // Obscura -> Playwright fallback engaged exactly once.
      const click = await gateway.executeTask({
        taskId: 'obscura-fallback-click',
        sessionId: 'obscura-fallback',
        action: { type: 'click', target: 'body' },
        approval: { approved: true, approvalId: approved.token.approvalId, signature: approved.token.signature },
      });
      expect(click.status).toBe('success');
      expect(click.telemetry.engine).toBe('playwright');
      expect(click.telemetry.fallbackCount).toBe(1);
      expect(click.telemetry.fallbackReason).toBe('unsupported');
    } finally {
      await gateway.closeSession('obscura-fallback').catch(() => undefined);
    }
  }, 60000);
});
