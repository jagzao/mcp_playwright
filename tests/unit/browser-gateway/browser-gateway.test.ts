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
    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
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
});
