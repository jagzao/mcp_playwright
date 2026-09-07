import type { BrowserEngine } from '../domain/browser-engine.js';
import type { BrowserTask } from '../domain/browser-task.js';
import type {
  BrowserExecutionTelemetry,
  BrowserGatewayResult,
} from '../domain/browser-result.js';
import type { GatewaySession, GatewaySessionStatus } from '../domain/browser-session.js';
import { BrowserEngineRouter } from './browser-engine-router.js';
import { SafetyGate } from './safety-gate.js';
import { NetworkPolicy } from './network-policy.js';
import { HmacApprovalRegistry, type ApprovalRegistry } from './approval-registry.js';
import { LlmOperatorRouter, type LlmRoutingSelection } from './llm-operator-router.js';
import { defaultTelemetry, type Telemetry } from './telemetry.js';

/**
 * Transport-neutral application facade for the Browser Agent Gateway.
 *
 * Owns the cross-cutting concerns that must never be bypassed by switching
 * engines:
 *  - session isolation (no shared state between unrelated sessions);
 *  - safety/approval gate (engine-independent);
 *  - network/SSRF policy (applied regardless of engine);
 *  - engine fallback (primary -> fallback -> manual escalation);
 *  - LLM operator routing (provider-neutral);
 *  - telemetry emission.
 *
 * MCP and CLI both call this facade — business logic is never duplicated.
 */

export interface GatewayOptions {
  primaryEngine: BrowserEngine;
  fallbackEngine: BrowserEngine;
  llmRouter: LlmOperatorRouter;
  safetyGate?: SafetyGate;
  networkPolicy?: NetworkPolicy;
  telemetry?: Telemetry;
  requireApprovalForSideEffects?: boolean;
  /** Registry that issues/verifies approval tokens (AC19). */
  approvalRegistry?: ApprovalRegistry;
}

export interface GatewayCapabilities {
  engines: { id: string; healthy: boolean }[];
  llm: { provider: string; model: string; role: LlmRoutingSelection['role'] };
}

export class BrowserGateway {
  private readonly sessions = new Map<string, GatewaySession>();
  private readonly safetyGate: SafetyGate;
  private readonly networkPolicy: NetworkPolicy;
  private readonly telemetry: Telemetry;
  private readonly router: BrowserEngineRouter;

  constructor(private readonly options: GatewayOptions) {
    this.safetyGate =
      options.safetyGate ??
      new SafetyGate(
        options.requireApprovalForSideEffects ?? true,
        options.approvalRegistry ?? new HmacApprovalRegistry(),
      );
    this.networkPolicy = options.networkPolicy ?? new NetworkPolicy();
    this.telemetry = options.telemetry ?? defaultTelemetry;
    this.router = new BrowserEngineRouter(options.primaryEngine, options.fallbackEngine);
  }

  // --- Session lifecycle -----------------------------------------------------

  createSession(sessionId: string, metadata?: Record<string, string>): GatewaySession {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }
    const session: GatewaySession = {
      sessionId,
      status: 'active',
      createdAt: Date.now(),
      metadata,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.options.primaryEngine.closeSession(sessionId).catch(() => undefined);
    await this.options.fallbackEngine.closeSession(sessionId).catch(() => undefined);
    this.sessions.delete(sessionId);
  }

  getSessionStatus(sessionId: string): GatewaySession | undefined {
    return this.sessions.get(sessionId);
  }

  // --- Task execution --------------------------------------------------------

  async executeTask<T = unknown>(task: BrowserTask): Promise<BrowserGatewayResult<T>> {
    const start = Date.now();
    const session = this.ensureSession(task.sessionId);

    // LLM routing decision captured for telemetry (provider-neutral).
    const llm = this.options.llmRouter.current();

    // 1) Network / SSRF policy — trusted policy applied regardless of engine.
    //    Applies to both `navigate` and `follow_link` (both resolve a destination
    //    URL), so a private/loopback href is denied before any engine runs.
    if (task.action.type === 'navigate' || task.action.type === 'follow_link') {
      const url = task.action.type === 'navigate' ? task.action.url : task.action.href;
      const verdict = this.networkPolicy.assess(url);
      if (!verdict.ok) {
        return this.blocked(
          task,
          llm,
          'security_blocked',
          `navigation denied: ${verdict.reason}`,
          Date.now() - start,
        );
      }
    }

    // 2) Safety / approval gate — engine-independent. Cannot be bypassed by
    //    switching engines.
    const safety = this.safetyGate.assess(task);
    if (safety.status === 'approval_required') {
      // Create a pending approval so a human operator can approve the exact
      // action (BLOCKER-E). The pendingId is returned in the blocked result so
      // the caller/operator knows what to approve. If no registry is configured,
      // pendingId is omitted.
      let pendingId: string | undefined;
      if (this.options.approvalRegistry) {
        const pending = this.options.approvalRegistry.createPending({
          taskId: task.taskId,
          sessionId: task.sessionId,
          actionType: task.action.type,
          target:
            task.action.type === 'click'
              ? task.action.target
              : task.action.type === 'follow_link'
                ? task.action.href
                : undefined,
        });
        pendingId = pending.pendingId;
      }
      return this.blocked(
        task,
        llm,
        'approval_required',
        safety.reason,
        Date.now() - start,
        pendingId,
      );
    }

    // 3) Engine router with bounded fallback (primary -> fallback -> escalation).
    session.status = 'active';
    const result = await this.router.execute<T>(task);

    return this.complete(task, result, llm);
  }

  // --- Health / capabilities -------------------------------------------------

  async health() {
    const engines = [
      await this.options.primaryEngine.health(),
      await this.options.fallbackEngine.health(),
    ];
    return {
      healthy: engines.every((e) => e.healthy),
      engines: [
        { id: this.options.primaryEngine.id, ...engines[0] },
        { id: this.options.fallbackEngine.id, ...engines[1] },
      ],
    };
  }

  capabilities(): GatewayCapabilities {
    const llm = this.options.llmRouter.current();
    return {
      engines: [
        { id: this.options.primaryEngine.id, healthy: true },
        { id: this.options.fallbackEngine.id, healthy: true },
      ],
      llm,
    };
  }

  // --- Internals -------------------------------------------------------------

  private ensureSession(sessionId: string): GatewaySession {
    return this.createSession(sessionId);
  }

  private blocked<T>(
    task: BrowserTask,
    llm: LlmRoutingSelection,
    category: 'security_blocked' | 'approval_required' | 'invalid_request',
    reason: string,
    durationMs: number,
    pendingId?: string,
  ): BrowserGatewayResult<T> {
    const telemetry: BrowserExecutionTelemetry & {
      status: string;
      redactedErrorCategory: string;
    } = {
      taskId: task.taskId,
      sessionId: task.sessionId,
      engine: this.options.primaryEngine.id,
      durationMs,
      fallbackCount: 0,
      screenshotCount: 0,
      llmProvider: llm.provider,
      llmModel: llm.model,
      status: 'blocked',
      redactedErrorCategory: category,
    };
    this.telemetry.emitExecutionSummary(telemetry);
    return { status: 'blocked', category, reason, telemetry, ...(pendingId ? { pendingId } : {}) };
  }

  private complete<T>(
    task: BrowserTask,
    routerResult: BrowserGatewayResult<T>,
    llm: LlmRoutingSelection,
  ): BrowserGatewayResult<T> {
    // The router already computes fallback count/reason via its telemetry.
    // Merge in provider/model and the status label, redacting any error.
    if (routerResult.status === 'success') {
      const telemetry: BrowserExecutionTelemetry & { status: string } = {
        ...routerResult.telemetry,
        status: 'success',
        llmProvider: llm.provider,
        llmModel: llm.model,
      };
      this.telemetry.emitExecutionSummary(telemetry);
      return { status: 'success', data: routerResult.data, telemetry };
    }

    if (routerResult.status === 'blocked') {
      const telemetry: BrowserExecutionTelemetry & {
        status: string;
        redactedErrorCategory: string;
      } = {
        ...(routerResult.telemetry ?? {}),
        taskId: task.taskId,
        sessionId: task.sessionId,
        engine: routerResult.telemetry?.engine ?? this.options.primaryEngine.id,
        durationMs: routerResult.telemetry?.durationMs ?? 0,
        fallbackCount: routerResult.telemetry?.fallbackCount ?? 0,
        screenshotCount: routerResult.telemetry?.screenshotCount ?? 0,
        status: 'blocked',
        redactedErrorCategory: routerResult.category,
        llmProvider: llm.provider,
        llmModel: llm.model,
      };
      this.telemetry.emitExecutionSummary(telemetry);
      return {
        status: 'blocked',
        category: routerResult.category,
        reason: routerResult.reason,
        telemetry,
      };
    }

    // manual_escalation_required
    const telemetry: BrowserExecutionTelemetry & {
      status: string;
      redactedErrorCategory: string;
    } = {
      ...routerResult.telemetry,
      taskId: task.taskId,
      sessionId: task.sessionId,
      status: 'manual_escalation_required',
      redactedErrorCategory: routerResult.reason,
      llmProvider: llm.provider,
      llmModel: llm.model,
    };
    this.telemetry.emitExecutionSummary(telemetry);
    return {
      status: 'manual_escalation_required',
      reason: routerResult.reason,
      telemetry,
    };
  }
}

export { NetworkPolicy, SafetyGate, LlmOperatorRouter, HmacApprovalRegistry };
export type { ApprovalRegistry };
