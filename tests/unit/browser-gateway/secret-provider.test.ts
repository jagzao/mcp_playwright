import { describe, expect, it } from 'vitest';
import { FakeSecretProvider } from '../../../lib/browser-gateway/application/secret-provider.js';
import { EnvSecretProvider } from '../../../lib/browser-gateway/infrastructure/secret-provider/env-secret-provider.js';

describe('SecretProvider (US-002 / Phase D)', () => {
  it('AC12: secret resolution is behind an interface; a fake provider works', async () => {
    const provider = new FakeSecretProvider({
      'llm.deepseek': 'sk-deepseek-secret',
      'search.brave': 'brave-secret',
    });

    expect(await provider.resolve('llm.deepseek')).toBe('sk-deepseek-secret');
    expect(await provider.resolve('search.brave')).toBe('brave-secret');
    expect(await provider.resolve('unknown.ref')).toBeUndefined();
  });

  it('AC12: domain layer depends on the interface, not env/Bitwarden APIs', async () => {
    // The application/domain layer only ever sees the `SecretProvider` interface.
    // Here we type a fake as the interface and confirm it satisfies it.
    const provider: { resolve(ref: string): Promise<string | undefined> } = new FakeSecretProvider({
      'marketing.meta': 'meta-secret',
    });
    expect(await provider.resolve('marketing.meta')).toBe('meta-secret');
  });

  it('EnvSecretProvider reads from environment variables (dev/bootstrap only)', async () => {
    const provider = new EnvSecretProvider({
      LLM_DEEPSEEK: 'sk-env-secret',
      SEARCH_BRAVE: 'brave-env',
      EMPTY_VAR: '',
    });

    expect(await provider.resolve('llm.deepseek')).toBe('sk-env-secret');
    expect(await provider.resolve('search.brave')).toBe('brave-env');
    // Empty values are treated as unresolved.
    expect(await provider.resolve('empty.var')).toBeUndefined();
    expect(await provider.resolve('missing.ref')).toBeUndefined();
  });

  it('EnvSecretProvider normalizes refs to env var names', async () => {
    const provider = new EnvSecretProvider({ FOO_BAR_BAZ: 'value' });
    expect(await provider.resolve('foo.bar-baz')).toBe('value');
    expect(await provider.resolve('foo/bar/baz')).toBe('value');
  });
});
