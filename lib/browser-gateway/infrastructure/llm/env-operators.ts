import type { LlmOperator } from '../../application/llm-operator-router.js';

/**
 * Environment-backed LLM operator adapters (provider-neutral).
 *
 * These are infrastructure adapters that read provider/model configuration
 * from the environment. They implement `LlmOperator` so the application layer
 * never depends on a concrete vendor. A provider is considered available once
 * its API key is present; when a key is missing, `available()` is false so the
 * router falls back deterministically — no network call is made.
 */

export class EnvLlmOperator implements LlmOperator {
  constructor(
    readonly provider: string,
    readonly model: string,
    private readonly apiKeyEnv: string,
  ) {}

  available(): boolean {
    return Boolean(this.apiKeyEnv && process.env[this.apiKeyEnv]?.trim());
  }
}

function apiKeyEnvForProvider(provider: string): string {
  switch (provider.toLowerCase()) {
    case 'deepseek':
      return 'DEEPSEEK_API_KEY';
    case 'gemini':
      return 'GEMINI_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    default:
      return 'LLM_OPERATOR_FALLBACK_API_KEY';
  }
}

/** Build primary/escalation/alternate operators from env defaults. */
export function createEnvOperators(): {
  primary: EnvLlmOperator;
  escalation: EnvLlmOperator;
  alternate: EnvLlmOperator;
} {
  const primaryProvider = process.env.LLM_OPERATOR_PRIMARY_PROVIDER || 'deepseek';
  const primaryModel = process.env.LLM_OPERATOR_PRIMARY_MODEL || 'deepseek-v4-flash';
  const escalationProvider = process.env.LLM_OPERATOR_ESCALATION_PROVIDER || 'gemini';
  const escalationModel = process.env.LLM_OPERATOR_ESCALATION_MODEL || 'gemini-3.8-flash';
  const alternateProvider = process.env.LLM_OPERATOR_ALTERNATE_PROVIDER || 'openai';
  const alternateModel = process.env.LLM_OPERATOR_ALTERNATE_MODEL || 'gpt-5.6-luna';

  return {
    primary: new EnvLlmOperator(primaryProvider, primaryModel, apiKeyEnvForProvider(primaryProvider)),
    escalation: new EnvLlmOperator(escalationProvider, escalationModel, apiKeyEnvForProvider(escalationProvider)),
    alternate: new EnvLlmOperator(alternateProvider, alternateModel, apiKeyEnvForProvider(alternateProvider)),
  };
}
