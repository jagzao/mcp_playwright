import type { BrowserEngine } from '../domain/browser-engine.js';
import type { BrowserTask } from '../domain/browser-task.js';
import type {
  BrowserEngineResult,
  BrowserExecutionTelemetry,
  BrowserGatewayResult,
} from '../domain/browser-result.js';
import { isPolicyBlock, shouldFallback } from './fallback-policy.js';

export class BrowserEngineRouter {
  constructor(
    private readonly primary: BrowserEngine,
    private readonly fallback: BrowserEngine,
  ) {}

  async execute<T = unknown>(task: BrowserTask): Promise<BrowserGatewayResult<T>> {
    const primaryResult = await this.executeSupported<T>(this.primary, task);

    if (primaryResult.status === 'success') {
      return {
        status: 'success',
        data: primaryResult.data,
        telemetry: this.telemetry(task, primaryResult, 0),
      };
    }

    if (isPolicyBlock(primaryResult)) {
      return {
        status: 'blocked',
        category: primaryResult.category as 'security_blocked' | 'approval_required' | 'invalid_request',
        reason: primaryResult.message,
        telemetry: this.telemetry(task, primaryResult, 0),
      };
    }

    if (!shouldFallback(primaryResult)) {
      return {
        status: 'manual_escalation_required',
        reason: primaryResult.message,
        telemetry: this.telemetry(task, primaryResult, 0),
      };
    }

    const fallbackResult = await this.executeSupported<T>(this.fallback, task);

    if (fallbackResult.status === 'success') {
      return {
        status: 'success',
        data: fallbackResult.data,
        telemetry: this.telemetry(task, fallbackResult, 1, primaryResult.category),
      };
    }

    if (isPolicyBlock(fallbackResult)) {
      return {
        status: 'blocked',
        category: fallbackResult.category as 'security_blocked' | 'approval_required' | 'invalid_request',
        reason: fallbackResult.message,
        telemetry: this.telemetry(task, fallbackResult, 1, primaryResult.category),
      };
    }

    return {
      status: 'manual_escalation_required',
      reason: fallbackResult.message,
      telemetry: this.telemetry(task, fallbackResult, 1, primaryResult.category),
    };
  }

  private async executeSupported<T>(engine: BrowserEngine, task: BrowserTask): Promise<BrowserEngineResult<T>> {
    const supported = await engine.supports(task);
    if (!supported) {
      return {
        status: 'failure',
        engine: engine.id,
        category: 'unsupported',
        message: `${engine.id} does not support action ${task.action.type}`,
        durationMs: 0,
      };
    }

    return engine.execute<T>(task);
  }

  private telemetry(
    task: BrowserTask,
    result: BrowserEngineResult,
    fallbackCount: number,
    fallbackReason?: BrowserExecutionTelemetry['fallbackReason'],
  ): BrowserExecutionTelemetry {
    return {
      taskId: task.taskId,
      sessionId: task.sessionId,
      engine: result.engine,
      durationMs: result.durationMs,
      fallbackCount,
      fallbackReason,
      screenshotCount: result.screenshotCount ?? 0,
    };
  }
}
