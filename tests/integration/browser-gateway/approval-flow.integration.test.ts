import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileApprovalRegistry } from '../../../lib/browser-gateway/infrastructure/approval-registry-file.js';
import { BrowserGateway } from '../../../lib/browser-gateway/application/browser-gateway.js';
import { HmacApprovalRegistry } from '../../../lib/browser-gateway/application/approval-registry.js';
import { LlmOperatorRouter, type LlmOperator } from '../../../lib/browser-gateway/application/llm-operator-router.js';
import type { BrowserEngine, BrowserEngineHealth } from '../../../lib/browser-gateway/domain/browser-engine.js';
import type { BrowserEngineId, BrowserEngineResult } from '../../../lib/browser-gateway/domain/browser-result.js';
import type { BrowserTask } from '../../../lib/browser-gateway/domain/browser-task.js';

/**
 * End-to-end approval flow integration test (BLOCKER-E).
 *
 * Proves the full operational path:
 *   approval_required -> pending approval -> trusted human/operator approval
 *   -> one-time token -> execute the exact approved action once
 *
 * Uses the FILE-backed registry so the "MCP server" (gateway) and the "operator
 * CLI" (a second registry instance reading the same file) can share pending
 * state across processes — the real operational topology.
 */

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

describe('Approval flow end-to-end (BLOCKER-E, integration)', () => {
  let dir: string;

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('full flow: blocked -> pending -> operator approve -> one-time token -> exact action executes once; replay/wrong-target rejected', async () => {
    dir = mkdtempSync(join(tmpdir(), 'approval-flow-'));
    const filePath = join(dir, 'approval-registry.json');

    // "MCP server" process: gateway with a file-backed registry.
    const serverRegistry = new FileApprovalRegistry('test-secret-0123456789abcdef0123456789abcdef', filePath);
    const primary = new FakeEngine('obscura');
    const gateway = new BrowserGateway({
      primaryEngine: primary,
      fallbackEngine: new FakeEngine('playwright'),
      llmRouter: makeRouter(),
      approvalRegistry: serverRegistry,
    });

    // 1) A raw click is blocked and a pending approval is created.
    const blocked = await gateway.executeTask({
      taskId: 't-1',
      sessionId: 's-1',
      action: { type: 'click', target: '#delete-account' },
    });
    expect(blocked.status).toBe('blocked');
    if (blocked.status !== 'blocked') return;
    expect(blocked.category).toBe('approval_required');
    const pendingId = blocked.pendingId!;
    expect(pendingId).toBeTruthy();
    expect(primary.executeCalls).toBe(0);

    // 2) "Operator CLI" process: a SEPARATE registry instance reading the same
    //    file can see the pending request (cross-process visibility).
    const operatorRegistry = new FileApprovalRegistry('test-secret-0123456789abcdef0123456789abcdef', filePath);
    const pending = operatorRegistry.getPending(pendingId);
    expect(pending).toBeDefined();
    expect(pending?.status).toBe('pending');
    expect(pending?.request.target).toBe('#delete-account');

    // 3) Operator approves the exact pending request -> one-time token.
    const approved = operatorRegistry.approve(pendingId, 'operator');
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const token = approved.token;

    // 4) Retry the exact action with the token -> executes exactly once.
    const executed = await gateway.executeTask({
      taskId: 't-1',
      sessionId: 's-1',
      action: { type: 'click', target: '#delete-account' },
      approval: { approved: true, approvalId: token.approvalId, signature: token.signature },
    });
    expect(executed.status).toBe('success');
    expect(primary.executeCalls).toBe(1);

    // 5) Replay the same token -> rejected (one-time / replay protection).
    const replay = await gateway.executeTask({
      taskId: 't-1',
      sessionId: 's-1',
      action: { type: 'click', target: '#delete-account' },
      approval: { approved: true, approvalId: token.approvalId, signature: token.signature },
    });
    expect(replay.status).toBe('blocked');
    if (replay.status === 'blocked') expect(replay.category).toBe('approval_required');
    expect(primary.executeCalls).toBe(1); // not executed again

    // 6) A token for a DIFFERENT target does not approve this action.
    const otherPending = serverRegistry.createPending({
      taskId: 't-1',
      sessionId: 's-1',
      actionType: 'click',
      target: '#other-button',
    });
    // The operator CLI is a fresh process: re-instantiate the registry so it
    // re-reads the file and sees the newly-persisted pending (real topology).
    const freshOperator = new FileApprovalRegistry('test-secret-0123456789abcdef0123456789abcdef', filePath);
    const otherApproved = freshOperator.approve(otherPending.pendingId, 'operator');
    expect(otherApproved.ok).toBe(true);
    if (!otherApproved.ok) return;
    const wrongTarget = await gateway.executeTask({
      taskId: 't-1',
      sessionId: 's-1',
      action: { type: 'click', target: '#delete-account' },
      approval: {
        approved: true,
        approvalId: otherApproved.token.approvalId,
        signature: otherApproved.token.signature,
      },
    });
    expect(wrongTarget.status).toBe('blocked');
    expect(primary.executeCalls).toBe(1);
  }, 30000);

  it('an untrusted caller cannot self-approve: no approve path exists on the gateway/MCP surface', async () => {
    dir = mkdtempSync(join(tmpdir(), 'approval-flow-'));
    const filePath = join(dir, 'approval-registry.json');
    const registry = new FileApprovalRegistry('test-secret-0123456789abcdef0123456789abcdef', filePath);
    const primary = new FakeEngine('obscura');
    const gateway = new BrowserGateway({
      primaryEngine: primary,
      fallbackEngine: new FakeEngine('playwright'),
      llmRouter: makeRouter(),
      approvalRegistry: registry,
    });

    // A bare caller-supplied approved:true is rejected (no self-approval).
    const selfApproved = await gateway.executeTask({
      taskId: 't-1',
      sessionId: 's-1',
      action: { type: 'click', target: '#delete-account' },
      approval: { approved: true, approvalId: 'a-1', signature: 'forged' },
    });
    expect(selfApproved.status).toBe('blocked');
    if (selfApproved.status === 'blocked') expect(selfApproved.category).toBe('approval_required');
    expect(primary.executeCalls).toBe(0);
  }, 30000);

  it('expiry is rejected: an expired pending cannot be approved or executed', async () => {
    dir = mkdtempSync(join(tmpdir(), 'approval-flow-'));
    const filePath = join(dir, 'approval-registry.json');
    const registry = new FileApprovalRegistry('test-secret-0123456789abcdef0123456789abcdef', filePath);
    const primary = new FakeEngine('obscura');
    const gateway = new BrowserGateway({
      primaryEngine: primary,
      fallbackEngine: new FakeEngine('playwright'),
      llmRouter: makeRouter(),
      approvalRegistry: registry,
    });

    // Create a pending that is already expired (negative TTL).
    const expiredPending = registry.createPending(
      { taskId: 't-1', sessionId: 's-1', actionType: 'click', target: '#delete-account' },
      -1,
    );
    const approve = registry.approve(expiredPending.pendingId, 'operator');
    expect(approve.ok).toBe(false);
    expect(primary.executeCalls).toBe(0);
  }, 30000);
});

/**
 * HIGH-J: the default runtime path must work with ONLY a strong APPROVAL_SECRET
 * configured and NO MASTER_KEY. The server creates a pending, the operator CLI
 * (a separate FileApprovalRegistry instance over the same file) approves it, and
 * the server verifies — proving APPROVAL_SECRET is actually wired into the
 * default registry (not just documented).
 */
describe('HIGH-J: default path works with only a strong APPROVAL_SECRET (no MASTER_KEY)', () => {
  let dir: string;

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('server creates pending -> operator CLI approves -> server verifies, with only APPROVAL_SECRET', async () => {
    dir = mkdtempSync(join(tmpdir(), 'approval-flow-approval-secret-'));
    const strongSecret = 'test-secret-0123456789abcdef0123456789abcdef';

    // HIGH-J: exercise the REAL default env-var path. Set only APPROVAL_SECRET
    // (no MASTER_KEY) and construct via the default factory so the env wiring is
    // proven end-to-end, not just by passing the secret explicitly.
    const prevApproval = process.env.APPROVAL_SECRET;
    const prevMaster = process.env.MASTER_KEY;
    process.env.APPROVAL_SECRET = strongSecret;
    delete process.env.MASTER_KEY;

    const { createApprovalRegistry } = await import(
      '../../../lib/browser-gateway/infrastructure/gateway-factory.js'
    );

    try {
      // "MCP server" process: default file-backed registry configured ONLY via
      // the strong APPROVAL_SECRET env var (no MASTER_KEY). This is the real
      // default factory path: createApprovalRegistry() -> new FileApprovalRegistry().
      const serverRegistry = createApprovalRegistry();
      const primary = new FakeEngine('obscura');
      const gateway = new BrowserGateway({
        primaryEngine: primary,
        fallbackEngine: new FakeEngine('playwright'),
        llmRouter: makeRouter(),
        approvalRegistry: serverRegistry,
      });

      // 1) A raw click is blocked and a pending approval is created.
      const blocked = await gateway.executeTask({
        taskId: 't-1',
        sessionId: 's-1',
        action: { type: 'click', target: '#delete-account' },
      });
      expect(blocked.status).toBe('blocked');
      if (blocked.status !== 'blocked') return;
      expect(blocked.category).toBe('approval_required');
      const pendingId = blocked.pendingId!;
      expect(pendingId).toBeTruthy();

      // 2) "Operator CLI" process: a SEPARATE registry instance (same file, same
      //    strong APPROVAL_SECRET env) sees the pending and approves it.
      const operatorRegistry = createApprovalRegistry();
      const pending = operatorRegistry.getPending(pendingId);
      expect(pending).toBeDefined();
      expect(pending?.status).toBe('pending');
      const approved = operatorRegistry.approve(pendingId, 'operator');
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      const token = approved.token;

      // 3) Server verifies the operator-issued token and executes the exact action.
      const executed = await gateway.executeTask({
        taskId: 't-1',
        sessionId: 's-1',
        action: { type: 'click', target: '#delete-account' },
        approval: { approved: true, approvalId: token.approvalId, signature: token.signature },
      });
      expect(executed.status).toBe('success');
      expect(primary.executeCalls).toBe(1);
    } finally {
      if (prevApproval !== undefined) process.env.APPROVAL_SECRET = prevApproval;
      else delete process.env.APPROVAL_SECRET;
      if (prevMaster !== undefined) process.env.MASTER_KEY = prevMaster;
      else delete process.env.MASTER_KEY;
    }
  }, 30000);
});

/**
 * BLOCKER-G: the approved legacy `playwright_click` path must reach the REAL
 * Playwright engine's `runClick`, not just a fake. This test proves the full
 * round-trip (blocked -> operator approve -> retry with same taskId + token ->
 * runClick executes) through the actual `PlaywrightEngine`, asserting that the
 * engine routes an approved `click` to `runClick` with the exact target.
 *
 * `runClick` is mocked so the test is deterministic and CI-safe (no real
 * browser / network dependency), while still proving the engine routing.
 */
describe('BLOCKER-G: approved legacy click reaches the real Playwright engine runClick (integration)', () => {
  it('approved click routes through PlaywrightEngine to runClick with the exact target', async () => {
    const { PlaywrightEngine } = await import(
      '../../../lib/browser-gateway/infrastructure/engines/playwright/playwright-engine.js'
    );
    const { HmacApprovalRegistry } = await import(
      '../../../lib/browser-gateway/application/approval-registry.js'
    );
    const { BrowserGateway } = await import(
      '../../../lib/browser-gateway/application/browser-gateway.js'
    );
    const { LlmOperatorRouter } = await import(
      '../../../lib/browser-gateway/application/llm-operator-router.js'
    );
    const { vi } = await import('vitest');

    // Mock runClick so the engine routes to it without a real browser.
    const playwrightTools = await import('../../../mcp-server/src/tools/playwright/index.js');
    const runClickSpy = vi
      .spyOn(playwrightTools, 'runClick')
      .mockResolvedValue({ success: true, selector: 'a[href="/about"]' } as never);

    const registry = new HmacApprovalRegistry('test-secret-0123456789abcdef0123456789abcdef');
    const engine = new PlaywrightEngine();
    const gateway = new BrowserGateway({
      primaryEngine: engine,
      fallbackEngine: engine,
      llmRouter: new LlmOperatorRouter({
        primary: { provider: 'deepseek', model: 'deepseek-v4-flash', available: () => true },
        escalation: { provider: 'gemini', model: 'gemini-3.8-flash', available: () => true },
        alternate: { provider: 'openai', model: 'gpt-5.6-luna', available: () => true },
      }),
      approvalRegistry: registry,
    });

    const taskId = 'legacy-click-real-engine';
    const target = 'a[href="/about"]';
    try {
      // 1) A raw click is blocked; a pending is created.
      const blocked = await gateway.executeTask({
        taskId,
        sessionId: 'default',
        action: { type: 'click', target },
      });
      expect(blocked.status).toBe('blocked');
      if (blocked.status !== 'blocked') return;
      const pendingId = blocked.pendingId!;
      expect(pendingId).toBeTruthy();

      // 2) Operator approves the pending -> one-time token.
      const approved = registry.approve(pendingId, 'operator');
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;

      // 3) Retry with the SAME taskId + token -> the real PlaywrightEngine
      //    routes the approved click to runClick with the exact target.
      const executed = await gateway.executeTask({
        taskId,
        sessionId: 'default',
        action: { type: 'click', target },
        approval: { approved: true, approvalId: approved.token.approvalId, signature: approved.token.signature },
      });
      expect(executed.status).toBe('success');
      expect(runClickSpy).toHaveBeenCalledWith(target, 30000, 'default');
    } finally {
      runClickSpy.mockRestore();
      await gateway.closeSession('default').catch(() => undefined);
    }
  }, 30000);
});
