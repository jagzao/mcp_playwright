/**
 * Provider-neutral LLM operator routing.
 *
 * Browser engines and domain code must not know which vendor/model is in use.
 * Selection is config-driven via environment variables
 * (`LLM_OPERATOR_PRIMARY_*`, `LLM_OPERATOR_ESCALATION_*`,
 * `LLM_OPERATOR_ALTERNATE_*`). Providers are injected as adapters so tests can
 * replace them with fakes — never requiring a network call.
 */

export type LlmRole = 'primary' | 'escalation' | 'alternate';

export interface LlmOperator {
  readonly provider: string;
  readonly model: string;
  /** Returns true when this provider is reachable/configurable. */
  available(): boolean;
}

export interface LlmRoutingSelection {
  provider: string;
  model: string;
  role: LlmRole;
}

export interface LlmOperatorRouterConfig {
  primaryProvider: string;
  primaryModel: string;
  escalationProvider: string;
  escalationModel: string;
  alternateProvider: string;
  alternateModel: string;
}

/** Environment-driven default config (never referenced by domain code). */
export function llmRouterConfigFromEnv(): LlmOperatorRouterConfig {
  return {
    primaryProvider: process.env.LLM_OPERATOR_PRIMARY_PROVIDER || 'deepseek',
    primaryModel: process.env.LLM_OPERATOR_PRIMARY_MODEL || 'deepseek-v4-flash',
    escalationProvider: process.env.LLM_OPERATOR_ESCALATION_PROVIDER || 'gemini',
    escalationModel: process.env.LLM_OPERATOR_ESCALATION_MODEL || 'gemini-3.8-flash',
    alternateProvider: process.env.LLM_OPERATOR_ALTERNATE_PROVIDER || 'openai',
    alternateModel: process.env.LLM_OPERATOR_ALTERNATE_MODEL || 'gpt-5.6-luna',
  };
}

export interface LlmOperatorRouterOptions {
  primary: LlmOperator;
  escalation: LlmOperator;
  alternate: LlmOperator;
}

/**
 * Routes operator decisions to the configured provider for a role, with a
 * bounded fallback chain: requested role -> primary -> escalation -> alternate.
 */
export class LlmOperatorRouter {
  constructor(
    private readonly options: LlmOperatorRouterOptions,
    private readonly config: LlmOperatorRouterConfig = llmRouterConfigFromEnv(),
  ) {}

  /**
   * Resolve the concrete operator for a role. If the requested operator is
   * unavailable, fall back (primary -> escalation -> alternate). Never throws
   * for unavailability; callers receive the best available selection.
   */
  resolveForRole(role: LlmRole = 'primary'): LlmRoutingSelection {
    const candidates: Array<{ operator: LlmOperator; role: LlmRole }> = [
      // Requested first, then the deterministic fallback order.
      (role === 'primary' && { operator: this.options.primary, role }) as
        | { operator: LlmOperator; role: LlmRole }
        | undefined,
      (role === 'escalation' && { operator: this.options.escalation, role }) as
        | { operator: LlmOperator; role: LlmRole }
        | undefined,
      (role === 'alternate' && { operator: this.options.alternate, role }) as
        | { operator: LlmOperator; role: LlmRole }
        | undefined,
      { operator: this.options.primary, role: 'primary' },
      { operator: this.options.escalation, role: 'escalation' },
      { operator: this.options.alternate, role: 'alternate' },
    ].filter((c): c is { operator: LlmOperator; role: LlmRole } => Boolean(c));

    for (const { operator, role: resolvedRole } of candidates) {
      if (operator.available()) {
        return {
          provider: operator.provider,
          model: operator.model,
          role: resolvedRole,
        };
      }
    }

    // Defensive: no operator available. Return primary metadata anyway so the
    // caller still sees a typed selection; availability is checked upstream.
    return {
      provider: this.options.primary.provider,
      model: this.options.primary.model,
      role: 'primary',
    };
  }

  /** Convenience: resolved model for the currently-preferable operator. */
  current(): LlmRoutingSelection {
    return this.resolveForRole('primary');
  }
}
