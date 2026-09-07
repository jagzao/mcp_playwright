import type { BrowserEngine, BrowserEngineHealth } from '../../../domain/browser-engine.js';
import type { BrowserTask } from '../../../domain/browser-task.js';
import type { BrowserEngineId, BrowserEngineResult } from '../../../domain/browser-result.js';

/**
 * Obscura adapter (capability-checked).
 *
 * Obscura is an external browser/MCP/CDP capability consumed via a configured
 * MCP command. Until the upstream launch contract is verified, this adapter
 * deliberately does NOT fabricate MCP method names. Its contract:
 *
 *  - It reads `OBSCURA_MCP_COMMAND` and `OBSCURA_MCP_ARGS` from the environment.
 *  - If unset/unavailable, `supports()` returns false and `health()` reports
 *    unhealthy. This is the deterministic path that triggers the Playwright
 *    fallback via the gateway router.
 *  - It never invokes unverified MCP tool names; instead it reports
 *    `unsupported` / `provider_unavailable`.
 *
 * This satisfies the "Obscura-first with deterministic fallback" intent without
 * silently fabricating an upstream contract that is not verified.
 */

export interface ObscuraConfig {
  command?: string;
  args?: string[];
}

export function obscuraConfigFromEnv(): ObscuraConfig {
  const command = process.env.OBSCURA_MCP_COMMAND?.trim();
  const rawArgs = process.env.OBSCURA_MCP_ARGS?.trim();
  return {
    command: command || undefined,
    args: rawArgs ? rawArgs.split(/\s+/).filter(Boolean) : undefined,
  };
}

function isReady(config: ObscuraConfig): boolean {
  return Boolean(config.command);
}

export class ObscuraEngine implements BrowserEngine {
  readonly id: BrowserEngineId = 'obscura';

  constructor(private readonly config: ObscuraConfig = obscuraConfigFromEnv()) {}

  get ready(): boolean {
    return isReady(this.config);
  }

  async createSession(_sessionId: string): Promise<void> {
    // No-op: session state is owned by the external Obscura runtime once
    // configured. Not fabricated here.
    return;
  }

  async closeSession(_sessionId: string): Promise<void> {
    // No-op for the unconfigured path.
    return;
  }

  async health(): Promise<BrowserEngineHealth> {
    if (!this.ready) {
      return {
        healthy: false,
        details: 'OBSCURA_MCP_COMMAND is not configured; obscura is unavailable and playwright fallback applies',
      };
    }
    return {
      healthy: true,
      details: 'obscura is configured (capability contract still requires upstream verification)',
    };
  }

  async supports(task: BrowserTask): Promise<boolean> {
    if (!this.ready) return false;
    return [
      'navigate',
      'follow_link',
      'snapshot',
      'click',
      'fill',
      'extract',
      'screenshot',
    ].includes(task.action.type);
  }

  async execute<T = unknown>(_task: BrowserTask): Promise<BrowserEngineResult<T>> {
    // If we are not ready, we must not fabricate an MCP call. This is the
    // deterministic trigger for the Playwright fallback.
    if (!this.ready) {
      return {
        status: 'failure',
        engine: this.id,
        category: 'provider_unavailable',
        message: 'obscura is not configured (OBSCURA_MCP_COMMAND unset)',
        durationMs: 0,
      };
    }
    // Configured but upstream method contract unverified: report unsupported
    // rather than fabricate method names. Expected for the fallback path.
    return {
      status: 'failure',
      engine: this.id,
      category: 'unsupported',
      message: 'obscura capability contract not yet verified; upstream MCP methods not fabricated',
      durationMs: 0,
    };
  }
}
