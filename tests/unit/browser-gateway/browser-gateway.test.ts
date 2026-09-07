import { describe, expect, it } from 'vitest';
import { BrowserGateway, type GatewayOptions } from '../../../lib/browser-gateway/application/browser-gateway.js';
import { HmacApprovalRegistry } from '../../../lib/browser-gateway/application/approval-registry.js';
import { LlmOperatorRouter, type LlmOperator } from '../../../lib/browser-gateway/application/llm-operator-router.js';
import type { BrowserEngine, BrowserEngineHealth } from '../../../lib/browser-gateway/domain/browser-engine.js';
import type { BrowserEngineId, BrowserEngineResult, BrowserExecutionTelemetry } from '../../../lib/browser-gateway/domain/browser-result.js';
import type { BrowserTask } from '../../../lib/browser-gateway/domain/browser-task.js';
import type { Telemetry } from '../../../lib/browser-gateway/application/telemetry.js';

// --- Fakes (no real network/browser) ----------------------------------------

class FakeEngine implements BrowserEngine {
  readonly id: BrowserEngineId;
  executeCalls = 0;
  supportsResult = true;

  constructor(
    id: BrowserEngineId,
    private readonly result: BrowserEngineResult,
  ) {
    this.id = id;
  }

  async createSession(): Promise<void> {}
  async closeSession(): Promise<void> {}
  async health(): Promise<BrowserEngineHealth> {
    return { healthy: true };
  }
  async supports(): Promise<boolean> {
    return this.supportsResult;
  }
  async execute<T = unknown>(): Promise<BrowserEngineResult<T>> {
    this.executeCalls += 1;
    return this.result as BrowserEngineResult<T>;
  }
}

function fakeOperator(provider: string, model: string, available = true): LlmOperator {
  return {
    provider,
    model,
    available: () => available,
  };
}

function makeRouter(): LlmOperatorRouter {
  return new LlmOperatorRouter({
    primary: fakeOperator('deepseek', 'deepseek-v4-flash'),
    escalation: fakeOperator('gemini', 'gemini-3.8-flash'),
    alternate: fakeOperator('openai', 'gpt-5.6-luna'),
  });
}

class CapturingTelemetry implements Telemetry {
  summaries: Array<BrowserExecutionTelemetry & { status: string; redactedErrorCategory?: string }> = [];
  emitExecutionSummary(summary: Parameters<Telemetry['emitExecutionSummary']>[0]): void {
    this.summaries.push(summary);
  }
}

function success(engine: BrowserEngineId, data: unknown = { ok: true }): BrowserEngineResult {
  return { status: 'success', engine, data, durationMs: 5 };
}

function failure(
  engine: BrowserEngineId,
  category: Extract<BrowserEngineResult, { status: 'failure' }>['category'],
): BrowserEngineResult {
  return { status: 'failure', engine, category, message: category, durationMs: 5 };
}

function buildGateway(
  primary: BrowserEngine,
  fallback: BrowserEngine,
  telemetry: CapturingTelemetry,
  extra?: Partial<GatewayOptions>,
): BrowserGateway {
  const options: GatewayOptions = {
    primaryEngine: primary,
    fallbackEngine: fallback,
    llmRouter: makeRouter(),
    telemetry,
    ...extra,
  };
  return new BrowserGateway(options);
}

function task(overrides: Partial<BrowserTask> = {}): BrowserTask {
  return {
    taskId: 't-1',
    sessionId: 's-1',
    action: { type: 'navigate', url: 'https://example.com' },
    ...overrides,
  };
}

// --- Tests ------------------------------------------------------------------

describe('BrowserGateway facade (US-001)', () => {
  it('AC1: Obscura-first — primary engine success yields engine=obscura', async () => {
    const primary = new FakeEngine('obscura', success('obscura'));
    const fallback = new FakeEngine('playwright', success('playwright'));
    const telemetry = new CapturingTelemetry();
    const gateway = buildGateway(primary, fallback, telemetry);

    const result = await gateway.executeTask(task());

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.telemetry.engine).toBe('obscura');
    }
    expect(primary.executeCalls).toBe(1);
    expect(fallback.executeCalls).toBe(0);
  });

  it('AC2: Playwright fallback — primary unavailable falls back exactly once with telemetry', async () => {
    const primary = new FakeEngine('obscura', failure('obscura', 'provider_unavailable'));
    const fallback = new FakeEngine('playwright', success('playwright'));
    const telemetry = new CapturingTelemetry();
    const gateway = buildGateway(primary, fallback, telemetry);

    const result = await gateway.executeTask(task());

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.telemetry.engine).toBe('playwright');
      expect(result.telemetry.fallbackCount).toBe(1);
      expect(result.telemetry.fallbackReason).toBe('provider_unavailable');
    }
    expect(primary.executeCalls).toBe(1);
    expect(fallback.executeCalls).toBe(1);
  });

  it('AC3: manual escalation — both engines fail', async () => {
    const primary = new FakeEngine('obscura', failure('obscura', 'provider_unavailable'));
    const fallback = new FakeEngine('playwright', failure('playwright', 'provider_unavailable'));
    const telemetry = new CapturingTelemetry();
    const gateway = buildGateway(primary, fallback, telemetry);

    const result = await gateway.executeTask(task());

    expect(result.status).toBe('manual_escalation_required');
    expect(primary.executeCalls).toBe(1);
    expect(fallback.executeCalls).toBe(1);
  });

  it('AC4: session isolation — two sessions are independent', async () => {
    const primary = new FakeEngine('obscura', success('obscura'));
    const fallback = new FakeEngine('playwright', success('playwright'));
    const telemetry = new CapturingTelemetry();
    const gateway = buildGateway(primary, fallback, telemetry);

    const a = gateway.createSession('sess-a', { agent: 'one' });
    const b = gateway.createSession('sess-b', { agent: 'two' });

    expect(a.sessionId).toBe('sess-a');
    expect(b.sessionId).toBe('sess-b');
    expect(a).not.toBe(b);
    expect(a.metadata).toEqual({ agent: 'one' });
    expect(b.metadata).toEqual({ agent: 'two' });
    // Mutating one must not affect the other.
    a.status = 'closed';
    expect(gateway.getSessionStatus('sess-b')?.status).toBe('active');
  });

  it('AC6: cost-aware observation — DOM-readable navigate/extract without screenshot', async () => {
    const primary = new FakeEngine('obscura', success('obscura', { title: 'Example' }));
    const fallback = new FakeEngine('playwright', success('playwright'));
    const telemetry = new CapturingTelemetry();
    const gateway = buildGateway(primary, fallback, telemetry);

    const result = await gateway.executeTask(task({ action: { type: 'extract', selector: 'h1' } }));

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.telemetry.screenshotCount).toBe(0);
    }
  });

  it('AC7: safety approval — side-effect without approval is blocked; with a registry-issued token executes', async () => {
    const primary = new FakeEngine('obscura', success('obscura'));
    const fallback = new FakeEngine('playwright', success('playwright'));
    const telemetry = new CapturingTelemetry();
    const registry = new HmacApprovalRegistry('test-secret');
    const gateway = buildGateway(primary, fallback, telemetry, { approvalRegistry: registry });

    const blocked = await gateway.executeTask(
      task({ action: { type: 'submit', target: '#form' } }),
    );
    expect(blocked.status).toBe('blocked');
    if (blocked.status === 'blocked') {
      expect(blocked.category).toBe('approval_required');
    }
    expect(primary.executeCalls).toBe(0);

    // A bare caller-supplied approved:true must NOT self-approve (AC19).
    const selfApproved = await gateway.executeTask(
      task({ action: { type: 'submit', target: '#form' }, approval: { approved: true, approvalId: 'a-1' } }),
    );
    expect(selfApproved.status).toBe('blocked');
    expect(primary.executeCalls).toBe(0);

    // Only a registry-issued token authorizes execution.
    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit', target: '#form' });
    const approved = await gateway.executeTask(
      task({ action: { type: 'submit', target: '#form' }, approval: { approved: true, approvalId: token.approvalId, signature: token.signature } }),
    );
    expect(approved.status).toBe('success');
    expect(primary.executeCalls).toBe(1);
  });

  it('AC8: security — private/loopback navigation is blocked regardless of engine', async () => {
    const primary = new FakeEngine('obscura', success('obscura'));
    const fallback = new FakeEngine('playwright', success('playwright'));
    const telemetry = new CapturingTelemetry();
    const gateway = buildGateway(primary, fallback, telemetry);

    const result = await gateway.executeTask(task({ action: { type: 'navigate', url: 'http://127.0.0.1/' } }));

    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.category).toBe('security_blocked');
    }
    expect(primary.executeCalls).toBe(0);
    expect(fallback.executeCalls).toBe(0);
  });

  it('AC9: telemetry — every completed task emits a structured summary', async () => {
    const primary = new FakeEngine('obscura', success('obscura'));
    const fallback = new FakeEngine('playwright', success('playwright'));
    const telemetry = new CapturingTelemetry();
    const gateway = buildGateway(primary, fallback, telemetry);

    await gateway.executeTask(task({ taskId: 't-9', sessionId: 's-9' }));

    expect(telemetry.summaries).toHaveLength(1);
    const summary = telemetry.summaries[0];
    expect(summary.taskId).toBe('t-9');
    expect(summary.sessionId).toBe('s-9');
    expect(summary.engine).toBe('obscura');
    expect(typeof summary.durationMs).toBe('number');
    expect(summary.status).toBe('success');
  });

  it('BLOCKER-2: a side-effect click (sideEffect:true) is blocked without an approval token, even with engine fallback', async () => {
    const primary = new FakeEngine('obscura', success('obscura'));
    const fallback = new FakeEngine('playwright', success('playwright'));
    const telemetry = new CapturingTelemetry();
    const registry = new HmacApprovalRegistry('test-secret');
    const gateway = buildGateway(primary, fallback, telemetry, { approvalRegistry: registry });

    const blocked = await gateway.executeTask(
      task({ action: { type: 'click', target: '#buy', sideEffect: true } }),
    );
    expect(blocked.status).toBe('blocked');
    if (blocked.status === 'blocked') {
      expect(blocked.category).toBe('approval_required');
    }
    // A bare caller-supplied approved:true must NOT self-approve a side-effect click.
    expect(primary.executeCalls).toBe(0);
    expect(fallback.executeCalls).toBe(0);
  });

  it('BLOCKER-2: a side-effect click WITH a registry-issued approval token executes (approved path functional)', async () => {
    const primary = new FakeEngine('obscura', success('obscura'));
    const fallback = new FakeEngine('playwright', success('playwright'));
    const telemetry = new CapturingTelemetry();
    const registry = new HmacApprovalRegistry('test-secret');
    const gateway = buildGateway(primary, fallback, telemetry, { approvalRegistry: registry });

    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'click', target: '#buy' });
    const approved = await gateway.executeTask(
      task({
        action: { type: 'click', target: '#buy', sideEffect: true },
        approval: { approved: true, approvalId: token.approvalId, signature: token.signature },
      }),
    );
    expect(approved.status).toBe('success');
    expect(primary.executeCalls).toBe(1);
  });

  it('HIGH-D: a plain/read click (no effect flag) is now blocked (approval_required)', async () => {
    const primary = new FakeEngine('obscura', success('obscura'));
    const fallback = new FakeEngine('playwright', success('playwright'));
    const telemetry = new CapturingTelemetry();
    const registry = new HmacApprovalRegistry('test-secret');
    const gateway = buildGateway(primary, fallback, telemetry, { approvalRegistry: registry });

    const result = await gateway.executeTask(task({ action: { type: 'click', target: '#next' } }));
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.category).toBe('approval_required');
    }
    expect(primary.executeCalls).toBe(0);
  });

  describe('HIGH-B: gateway-level, caller cannot downgrade an irreversible click', () => {
    it('a raw click WITHOUT sideEffect on a side-effect-like target is blocked (no engine runs)', async () => {
      const primary = new FakeEngine('obscura', success('obscura'));
      const fallback = new FakeEngine('playwright', success('playwright'));
      const telemetry = new CapturingTelemetry();
      const registry = new HmacApprovalRegistry('test-secret');
      const gateway = buildGateway(primary, fallback, telemetry, { approvalRegistry: registry });

      // @ts-expect-error — intentionally omit sideEffect on an irreversible target.
      const blocked = await gateway.executeTask(task({ action: { type: 'click', target: '#publish' } }));
      expect(blocked.status).toBe('blocked');
      if (blocked.status === 'blocked') {
        expect(blocked.category).toBe('approval_required');
      }
      // The gate refuses before any engine is consulted — no bypass via fallback.
      expect(primary.executeCalls).toBe(0);
      expect(fallback.executeCalls).toBe(0);
    });

    it('a caller cannot bypass by setting sideEffect:"read" on an irreversible target', async () => {
      const primary = new FakeEngine('obscura', success('obscura'));
      const fallback = new FakeEngine('playwright', success('playwright'));
      const telemetry = new CapturingTelemetry();
      const gateway = buildGateway(primary, fallback, telemetry);

      const blocked = await gateway.executeTask(
        task({ action: { type: 'click', target: '#delete', sideEffect: 'read' } as BrowserTask['action'] }),
      );
      expect(blocked.status).toBe('blocked');
    });

    it('a raw irreversible click is blocked even when the primary would fail and fall back', async () => {
      const primary = new FakeEngine('obscura', failure('obscura', 'provider_unavailable'));
      const fallback = new FakeEngine('playwright', success('playwright'));
      const telemetry = new CapturingTelemetry();
      const gateway = buildGateway(primary, fallback, telemetry);

      // @ts-expect-error — omit sideEffect on irreversible target.
      const blocked = await gateway.executeTask(task({ action: { type: 'click', target: '#send' } }));
      expect(blocked.status).toBe('blocked');
      if (blocked.status === 'blocked') {
        expect(blocked.category).toBe('approval_required');
      }
      // Neither primary nor fallback is reached — the gate blocks first.
      expect(primary.executeCalls).toBe(0);
      expect(fallback.executeCalls).toBe(0);
    });

    it('an irreversible click WITH a registry-issued token still executes (approved path functional)', async () => {
      const primary = new FakeEngine('obscura', success('obscura'));
      const fallback = new FakeEngine('playwright', success('playwright'));
      const telemetry = new CapturingTelemetry();
      const registry = new HmacApprovalRegistry('test-secret');
      const gateway = buildGateway(primary, fallback, telemetry, { approvalRegistry: registry });

      const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'click', target: '#buy' });
      // @ts-expect-error — omit sideEffect; token is the trusted approval that clears it.
      const approved = await gateway.executeTask(
        task({
          action: { type: 'click', target: '#buy' },
          approval: { approved: true, approvalId: token.approvalId, signature: token.signature },
        }),
      );
      expect(approved.status).toBe('success');
      expect(primary.executeCalls).toBe(1);
    });

    it('HIGH-D: a reversible/navigation click with an explicit sideEffect:"read" is now blocked', async () => {
      const primary = new FakeEngine('obscura', success('obscura'));
      const fallback = new FakeEngine('playwright', success('playwright'));
      const telemetry = new CapturingTelemetry();
      const gateway = buildGateway(primary, fallback, telemetry);

      const result = await gateway.executeTask(
        task({ action: { type: 'click', target: '#next', sideEffect: 'read' } }),
      );
      expect(result.status).toBe('blocked');
      if (result.status === 'blocked') {
        expect(result.category).toBe('approval_required');
      }
      expect(primary.executeCalls).toBe(0);
    });
  });

  describe('HIGH-C: fail-closed — unknown/opaque clicks are blocked before any engine runs', () => {
    it('4. an unknown click (#btn-482) is blocked before Obscura/Playwright fallback (neither engine reached)', async () => {
      const primary = new FakeEngine('obscura', success('obscura'));
      const fallback = new FakeEngine('playwright', success('playwright'));
      const telemetry = new CapturingTelemetry();
      const gateway = buildGateway(primary, fallback, telemetry);

      // @ts-expect-error — no sideEffect; opaque selector is `unknown`.
      const blocked = await gateway.executeTask(task({ action: { type: 'click', target: '#btn-482' } }));
      expect(blocked.status).toBe('blocked');
      if (blocked.status === 'blocked') {
        expect(blocked.category).toBe('approval_required');
      }
      // The gate refuses before any engine is consulted — no bypass via fallback.
      expect(primary.executeCalls).toBe(0);
      expect(fallback.executeCalls).toBe(0);
    });

    it('4b. an unknown click is blocked even when the primary would fail and fall back', async () => {
      const primary = new FakeEngine('obscura', failure('obscura', 'provider_unavailable'));
      const fallback = new FakeEngine('playwright', success('playwright'));
      const telemetry = new CapturingTelemetry();
      const gateway = buildGateway(primary, fallback, telemetry);

      // @ts-expect-error — no sideEffect; opaque selector is `unknown`.
      const blocked = await gateway.executeTask(task({ action: { type: 'click', target: '[data-testid="primary-action"]' } }));
      expect(blocked.status).toBe('blocked');
      if (blocked.status === 'blocked') {
        expect(blocked.category).toBe('approval_required');
      }
      expect(primary.executeCalls).toBe(0);
      expect(fallback.executeCalls).toBe(0);
    });

    it('3b. caller sideEffect:"read" cannot downgrade an unknown click at the gateway (still blocked)', async () => {
      const primary = new FakeEngine('obscura', success('obscura'));
      const fallback = new FakeEngine('playwright', success('playwright'));
      const telemetry = new CapturingTelemetry();
      const gateway = buildGateway(primary, fallback, telemetry);

      const blocked = await gateway.executeTask(
        task({ action: { type: 'click', target: '#btn-482', sideEffect: 'read' } as BrowserTask['action'] }),
      );
      expect(blocked.status).toBe('blocked');
      if (blocked.status === 'blocked') {
        expect(blocked.category).toBe('approval_required');
      }
      expect(primary.executeCalls).toBe(0);
      expect(fallback.executeCalls).toBe(0);
    });

    it('6b. an approved token for an unknown click allows ONLY the exact authorized action', async () => {
      const primary = new FakeEngine('obscura', success('obscura'));
      const fallback = new FakeEngine('playwright', success('playwright'));
      const telemetry = new CapturingTelemetry();
      const registry = new HmacApprovalRegistry('test-secret');
      const gateway = buildGateway(primary, fallback, telemetry, { approvalRegistry: registry });

      // A token for a different task does not approve this unknown click.
      const wrongToken = registry.issue({ taskId: 't-other', sessionId: 's-1', actionType: 'click', target: '#btn-482' });
      const stillBlocked = await gateway.executeTask(
        task({
          action: { type: 'click', target: '#btn-482' },
          approval: { approved: true, approvalId: wrongToken.approvalId, signature: wrongToken.signature },
        }),
      );
      expect(stillBlocked.status).toBe('blocked');
      expect(primary.executeCalls).toBe(0);

      // The exact token for this task/action AND target DOES approve.
      const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'click', target: '#btn-482' });
      const approved = await gateway.executeTask(
        task({
          action: { type: 'click', target: '#btn-482' },
          approval: { approved: true, approvalId: token.approvalId, signature: token.signature },
        }),
      );
      expect(approved.status).toBe('success');
      expect(primary.executeCalls).toBe(1);
    });
  });

  describe('follow_link (HIGH-D)', () => {
    it('follow_link is auto-allowed and executes on the primary engine', async () => {
      const primary = new FakeEngine('obscura', success('obscura'));
      const fallback = new FakeEngine('playwright', success('playwright'));
      const telemetry = new CapturingTelemetry();
      const gateway = buildGateway(primary, fallback, telemetry);

      const result = await gateway.executeTask(
        task({ action: { type: 'follow_link', href: 'https://example.com/about' } }),
      );
      expect(result.status).toBe('success');
      expect(primary.executeCalls).toBe(1);
    });

    it('a follow_link with a private/loopback href is blocked by network policy', async () => {
      const primary = new FakeEngine('obscura', success('obscura'));
      const fallback = new FakeEngine('playwright', success('playwright'));
      const telemetry = new CapturingTelemetry();
      const gateway = buildGateway(primary, fallback, telemetry);

      const result = await gateway.executeTask(
        task({ action: { type: 'follow_link', href: 'http://127.0.0.1/admin' } }),
      );
      expect(result.status).toBe('blocked');
      if (result.status === 'blocked') {
        expect(result.category).toBe('security_blocked');
      }
      expect(primary.executeCalls).toBe(0);
      expect(fallback.executeCalls).toBe(0);
    });
  });

  describe('BLOCKER-E: approval flow (pending -> operator approve -> one-time token)', () => {
    it('a blocked approval_required result includes a pendingId', async () => {
      const primary = new FakeEngine('obscura', success('obscura'));
      const fallback = new FakeEngine('playwright', success('playwright'));
      const telemetry = new CapturingTelemetry();
      const registry = new HmacApprovalRegistry('test-secret');
      const gateway = buildGateway(primary, fallback, telemetry, { approvalRegistry: registry });

      const blocked = await gateway.executeTask(
        task({ action: { type: 'click', target: '#delete-account' } }),
      );
      expect(blocked.status).toBe('blocked');
      if (blocked.status === 'blocked') {
        expect(blocked.category).toBe('approval_required');
        expect(blocked.pendingId).toBeTruthy();
        expect(registry.getPending(blocked.pendingId!)).toBeDefined();
      }
      expect(primary.executeCalls).toBe(0);
    });

    it('a blocked approval_required result omits pendingId when no registry is configured', async () => {
      const primary = new FakeEngine('obscura', success('obscura'));
      const fallback = new FakeEngine('playwright', success('playwright'));
      const telemetry = new CapturingTelemetry();
      const gateway = buildGateway(primary, fallback, telemetry);

      const blocked = await gateway.executeTask(
        task({ action: { type: 'click', target: '#delete-account' } }),
      );
      expect(blocked.status).toBe('blocked');
      if (blocked.status === 'blocked') {
        expect(blocked.pendingId).toBeUndefined();
      }
    });

    it('after registry.approve(pendingId, "operator") the exact action executes with the returned token', async () => {
      const primary = new FakeEngine('obscura', success('obscura'));
      const fallback = new FakeEngine('playwright', success('playwright'));
      const telemetry = new CapturingTelemetry();
      const registry = new HmacApprovalRegistry('test-secret');
      const gateway = buildGateway(primary, fallback, telemetry, { approvalRegistry: registry });

      // 1) Task is blocked and a pending approval is created.
      const blocked = await gateway.executeTask(
        task({ action: { type: 'click', target: '#delete-account' } }),
      );
      expect(blocked.status).toBe('blocked');
      if (blocked.status !== 'blocked') return;
      const pendingId = blocked.pendingId!;
      expect(pendingId).toBeTruthy();

      // 2) Operator approves the pending request (trusted channel).
      const approved = registry.approve(pendingId, 'operator');
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      const token = approved.token;

      // 3) Retry the exact action with the one-time token -> executes.
      const executed = await gateway.executeTask(
        task({
          action: { type: 'click', target: '#delete-account' },
          approval: { approved: true, approvalId: token.approvalId, signature: token.signature },
        }),
      );
      expect(executed.status).toBe('success');
      expect(primary.executeCalls).toBe(1);
    });

    it('the one-time token cannot be replayed (second verify fails)', async () => {
      const primary = new FakeEngine('obscura', success('obscura'));
      const fallback = new FakeEngine('playwright', success('playwright'));
      const telemetry = new CapturingTelemetry();
      const registry = new HmacApprovalRegistry('test-secret');
      const gateway = buildGateway(primary, fallback, telemetry, { approvalRegistry: registry });

      const blocked = await gateway.executeTask(
        task({ action: { type: 'click', target: '#delete-account' } }),
      );
      if (blocked.status !== 'blocked') return;
      const approved = registry.approve(blocked.pendingId!, 'operator');
      if (!approved.ok) return;
      const token = approved.token;

      const first = await gateway.executeTask(
        task({
          action: { type: 'click', target: '#delete-account' },
          approval: { approved: true, approvalId: token.approvalId, signature: token.signature },
        }),
      );
      expect(first.status).toBe('success');

      // Replay the same token -> blocked (one-time / replay protection).
      const replay = await gateway.executeTask(
        task({
          action: { type: 'click', target: '#delete-account' },
          approval: { approved: true, approvalId: token.approvalId, signature: token.signature },
        }),
      );
      expect(replay.status).toBe('blocked');
      if (replay.status === 'blocked') {
        expect(replay.category).toBe('approval_required');
      }
      expect(primary.executeCalls).toBe(1);
    });
  });
});
