import { describe, it, expect } from 'vitest';
import { playwrightTools } from '../../mcp-server/src/tools/playwright/index.js';
import { BrowserGateway } from '../../lib/browser-gateway/application/browser-gateway.js';
import { HmacApprovalRegistry } from '../../lib/browser-gateway/application/approval-registry.js';
import { LlmOperatorRouter, type LlmOperator } from '../../lib/browser-gateway/application/llm-operator-router.js';
import type { BrowserEngine, BrowserEngineHealth } from '../../lib/browser-gateway/domain/browser-engine.js';
import type { BrowserEngineId, BrowserEngineResult } from '../../lib/browser-gateway/domain/browser-result.js';

class FakeEngine implements BrowserEngine {
  readonly id: BrowserEngineId;
  executeCalls = 0;
  constructor(id: BrowserEngineId) {
    this.id = id;
  }
  async createSession(): Promise<void> {}
  async closeSession(): Promise<void> {}
  async health(): Promise<BrowserEngineHealth> {
    return { healthy: true };
  }
  async supports(): Promise<boolean> {
    return true;
  }
  async execute<T = unknown>(): Promise<BrowserEngineResult<T>> {
    this.executeCalls += 1;
    return { status: 'success', engine: this.id, data: { ok: true } as T, durationMs: 5 };
  }
}

function fakeOperator(provider: string, model: string): LlmOperator {
  return { provider, model, available: () => true };
}

function makeRouter(): LlmOperatorRouter {
  return new LlmOperatorRouter({
    primary: fakeOperator('deepseek', 'deepseek-v4-flash'),
    escalation: fakeOperator('gemini', 'gemini-3.8-flash'),
    alternate: fakeOperator('openai', 'gpt-5.6-luna'),
  });
}

describe('Playwright Tools', () => {
  describe('Tool Definitions', () => {
    it('should have playwright_navigate tool', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_navigate');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Navigate to a URL');
      expect(tool?.inputSchema.required).toContain('url');
      expect(tool?.inputSchema.properties.url).toBeDefined();
      expect(tool?.inputSchema.properties.waitUntil).toBeDefined();
    });

    it('should have playwright_click tool (gated through the gateway safety/approval gate)', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_click');

      expect(tool).toBeDefined();
      // HIGH-D/BLOCKER-E: the legacy click is now routed through the gateway so
      // a raw click is approval-required unless a one-time token is supplied.
      expect(tool?.description).toContain('approval');
      expect(tool?.inputSchema.required).toContain('selector');
      expect(tool?.inputSchema.properties.approval).toBeDefined();
    });

    it('should have playwright_fill tool', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_fill');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Fill a form field');
      expect(tool?.inputSchema.required).toEqual(['selector', 'value']);
    });

    it('should have playwright_screenshot tool', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_screenshot');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Take a screenshot');
      expect(tool?.inputSchema.properties.path).toBeDefined();
      expect(tool?.inputSchema.properties.fullPage).toBeDefined();
    });

    it('should have playwright_wait_for tool', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_wait_for');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Wait for an element to appear');
      expect(tool?.inputSchema.required).toContain('selector');
    });

    it('should have playwright_get_text tool', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_get_text');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Get text content from element');
      expect(tool?.inputSchema.required).toContain('selector');
    });

    it('should have playwright_close tool', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_close');

      expect(tool).toBeDefined();
      expect(tool?.description).toBe('Close the browser');
    });
  });

  describe('Tool Input Schemas', () => {
    it('should validate navigate waitUntil options', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_navigate');

      expect(tool?.inputSchema.properties.waitUntil.enum).toEqual([
        'load',
        'domcontentloaded',
        'networkidle',
      ]);
    });

    it('should validate wait_for state options', () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_wait_for');

      expect(tool?.inputSchema.properties.state.enum).toEqual([
        'attached',
        'detached',
        'visible',
        'hidden',
      ]);
    });
  });

  describe('Tool Count', () => {
    it('should have all essential tools', () => {
      const essentialTools = [
        'playwright_navigate',
        'playwright_click',
        'playwright_fill',
        'playwright_screenshot',
        'playwright_wait_for',
        'playwright_get_text',
        'playwright_close',
      ];

      essentialTools.forEach((toolName) => {
        const tool = playwrightTools.find((t) => t.name === toolName);
        expect(tool).toBeDefined();
      });

      expect(playwrightTools.length).toBe(7);
    });
  });

  describe('HIGH-D/BLOCKER-E: legacy playwright_click is gated through the gateway', () => {
    it('a raw click on a side-effect selector is approval-required (no browser needed — gate blocks first)', async () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_click');
      expect(tool).toBeDefined();
      if (!tool) return;

      // The gateway safety gate blocks a raw click BEFORE any engine runs, so
      // this does not require a browser. A hostile page can put a[href] /
      // role=tab on a destructive control; the raw click must NOT auto-execute.
      const result = await tool.execute({ selector: '#delete-account' });
      expect(result.success).toBe(false);
      expect(result.category).toBe('approval_required');
      expect(result.pendingId).toBeTruthy(); // operator can approve it
    });

    it('a raw click on a previously-safe-looking selector (a[href]) is also approval-required', async () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_click');
      expect(tool).toBeDefined();
      if (!tool) return;

      // HIGH-D: even a[href] / [role="tab"] must not auto-allow a raw click.
      const result = await tool.execute({ selector: 'a[href="/about"]' });
      expect(result.success).toBe(false);
      expect(result.category).toBe('approval_required');
    });
  });

  describe('BLOCKER-G: legacy playwright_click completes the approved round-trip with a stable taskId', () => {
    it('blocked result includes a stable taskId; retry with the SAME taskId + approved token executes', async () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_click');
      expect(tool).toBeDefined();
      if (!tool) return;

      // Inject a gateway with a fake engine + in-memory registry so no real
      // browser is needed. The registry is shared across the round-trip.
      const registry = new HmacApprovalRegistry('test-secret');
      const primary = new FakeEngine('obscura');
      const gateway = new BrowserGateway({
        primaryEngine: primary,
        fallbackEngine: new FakeEngine('playwright'),
        llmRouter: makeRouter(),
        approvalRegistry: registry,
      });

      // 1) First call is blocked; it returns a stable taskId + pendingId.
      const blocked = await tool.execute({ selector: '#delete-account', gateway });
      expect(blocked.success).toBe(false);
      expect(blocked.category).toBe('approval_required');
      expect(blocked.pendingId).toBeTruthy();
      expect(blocked.taskId).toBeTruthy();
      expect(primary.executeCalls).toBe(0);

      // 2) Operator approves the pending -> one-time token.
      const approved = registry.approve(blocked.pendingId, 'operator');
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;

      // 3) Retry with the SAME taskId + token -> executes (the token issued for
      //    the first blocked call verifies for the retry that reuses the taskId).
      const executed = await tool.execute({
        selector: '#delete-account',
        taskId: blocked.taskId,
        approval: { approvalId: approved.token.approvalId, signature: approved.token.signature },
        gateway,
      });
      expect(executed.success).toBe(true);
      expect(primary.executeCalls).toBe(1);
    });

    it('a NEW taskId on retry does NOT verify the token issued for the first blocked call', async () => {
      const tool = playwrightTools.find((t) => t.name === 'playwright_click');
      expect(tool).toBeDefined();
      if (!tool) return;

      const registry = new HmacApprovalRegistry('test-secret');
      const primary = new FakeEngine('obscura');
      const gateway = new BrowserGateway({
        primaryEngine: primary,
        fallbackEngine: new FakeEngine('playwright'),
        llmRouter: makeRouter(),
        approvalRegistry: registry,
      });

      const blocked = await tool.execute({ selector: '#delete-account', gateway });
      expect(blocked.success).toBe(false);
      const approved = registry.approve(blocked.pendingId, 'operator');
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;

      // Retry WITHOUT reusing the taskId (a fresh one is generated) -> the token
      // bound to the original taskId does not verify -> still blocked.
      const retry = await tool.execute({
        selector: '#delete-account',
        approval: { approvalId: approved.token.approvalId, signature: approved.token.signature },
        gateway,
      });
      expect(retry.success).toBe(false);
      expect(retry.category).toBe('approval_required');
      expect(primary.executeCalls).toBe(0);
    });
  });
});
