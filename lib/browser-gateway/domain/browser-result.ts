export type BrowserEngineId = 'obscura' | 'playwright';

export type BrowserFailureCategory =
  | 'unsupported'
  | 'timeout'
  | 'transient'
  | 'provider_unavailable'
  | 'security_blocked'
  | 'approval_required'
  | 'invalid_request'
  | 'unknown';

export interface BrowserExecutionTelemetry {
  taskId: string;
  sessionId: string;
  engine: BrowserEngineId;
  durationMs: number;
  fallbackCount: number;
  fallbackReason?: BrowserFailureCategory;
  screenshotCount: number;
  llmProvider?: string;
  llmModel?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
}

export type BrowserEngineResult<T = unknown> =
  | {
      status: 'success';
      engine: BrowserEngineId;
      data: T;
      durationMs: number;
      screenshotCount?: number;
    }
  | {
      status: 'failure';
      engine: BrowserEngineId;
      category: BrowserFailureCategory;
      message: string;
      durationMs: number;
      screenshotCount?: number;
    };

export type BrowserGatewayResult<T = unknown> =
  | {
      status: 'success';
      data: T;
      telemetry: BrowserExecutionTelemetry;
    }
  | {
      status: 'manual_escalation_required';
      reason: string;
      telemetry: BrowserExecutionTelemetry;
    }
  | {
      status: 'blocked';
      category: 'security_blocked' | 'approval_required' | 'invalid_request';
      reason: string;
      telemetry?: Partial<BrowserExecutionTelemetry>;
    };
