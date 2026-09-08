import { describe, expect, it } from 'vitest';
import { LlmOperatorRouter, type LlmOperator } from '../../../lib/browser-gateway/application/llm-operator-router.js';

function op(provider: string, model: string, available = true): LlmOperator {
  return { provider, model, available: () => available };
}

function makeRouter(primary: LlmOperator, escalation: LlmOperator, alternate: LlmOperator): LlmOperatorRouter {
  return new LlmOperatorRouter({ primary, escalation, alternate });
}

describe('LlmOperatorRouter (US-001)', () => {
  it('AC5: provider-neutral — selection is config-driven with fakes, no network', () => {
    const router = makeRouter(
      op('deepseek', 'deepseek-v4-flash'),
      op('gemini', 'gemini-3.8-flash'),
      op('openai', 'gpt-5.6-luna'),
    );

    const selection = router.current();
    expect(selection.provider).toBe('deepseek');
    expect(selection.model).toBe('deepseek-v4-flash');
    expect(selection.role).toBe('primary');
  });

  it('falls back primary -> escalation -> alternate when providers unavailable', () => {
    const router = makeRouter(
      op('deepseek', 'deepseek-v4-flash', false),
      op('gemini', 'gemini-3.8-flash', false),
      op('openai', 'gpt-5.6-luna', true),
    );

    const selection = router.current();
    expect(selection.provider).toBe('openai');
    expect(selection.role).toBe('alternate');
  });

  it('prefers escalation when primary unavailable but escalation available', () => {
    const router = makeRouter(
      op('deepseek', 'deepseek-v4-flash', false),
      op('gemini', 'gemini-3.8-flash', true),
      op('openai', 'gpt-5.6-luna', true),
    );

    const selection = router.current();
    expect(selection.provider).toBe('gemini');
    expect(selection.role).toBe('escalation');
  });

  it('resolveForRole honors the requested role first', () => {
    const router = makeRouter(
      op('deepseek', 'deepseek-v4-flash'),
      op('gemini', 'gemini-3.8-flash'),
      op('openai', 'gpt-5.6-luna'),
    );

    const selection = router.resolveForRole('escalation');
    expect(selection.provider).toBe('gemini');
    expect(selection.role).toBe('escalation');
  });
});
