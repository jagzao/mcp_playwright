import type { BrowserExecutionTelemetry } from '../domain/browser-result.js';
import { redactObject } from '../../security/redaction.js';
import { logger } from '../../observability/logger.js';

/**
 * Structured per-task execution telemetry.
 *
 * Every completed task emits one execution summary containing: task/session
 * ids (non-secret), browser engine, LLM provider/model, duration, result
 * status, fallback count/reason, screenshot count and token/cost when
 * available. Secrets are never serialized: all payloads pass through
 * `redactObject` before emission.
 */

export interface Telemetry {
  emitExecutionSummary(
    telemetry: BrowserExecutionTelemetry & { status: string; redactedErrorCategory?: string },
  ): void;
}

/**
 * Default telemetry emitter that routes a redacted summary into the repository
 * logger. Extensible to a metrics sink later without changing callers.
 */
export class LoggerTelemetry implements Telemetry {
  emitExecutionSummary(summary: Parameters<Telemetry['emitExecutionSummary']>[0]): void {
    const safe = redactObject(summary) as typeof summary;
    logger.info('browser_gateway.task.summary', safe);
  }
}

/** Convenience no-op telemetry for callers/tests that pass their own sink. */
export class NoopTelemetry implements Telemetry {
  emitExecutionSummary(): void {
    /* intentional no-op */
  }
}

/** Shared default instance. Tests may pass explicit sinks to avoid cross-test noise. */
export const defaultTelemetry: Telemetry = new LoggerTelemetry();
