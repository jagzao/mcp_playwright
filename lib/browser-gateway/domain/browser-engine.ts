import type { BrowserTask } from './browser-task.js';
import type { BrowserEngineId, BrowserEngineResult } from './browser-result.js';

export interface BrowserEngineHealth {
  healthy: boolean;
  details?: string;
}

export interface BrowserEngine {
  readonly id: BrowserEngineId;

  createSession(sessionId: string): Promise<void>;
  closeSession(sessionId: string): Promise<void>;
  health(): Promise<BrowserEngineHealth>;
  supports(task: BrowserTask): Promise<boolean>;
  execute<T = unknown>(task: BrowserTask): Promise<BrowserEngineResult<T>>;
}
