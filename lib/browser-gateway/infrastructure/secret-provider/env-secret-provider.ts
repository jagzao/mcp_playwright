import type { SecretProvider } from '../../application/secret-provider.js';

/**
 * Dev/local SecretProvider that reads secret values from environment
 * variables. Allowed only for local development/bootstrap — it must never be
 * treated as the long-term source of truth.
 *
 * A secret reference like `llm.deepseek` is mapped to an environment variable
 * name by uppercasing and replacing non-alphanumerics with `_`:
 *   `llm.deepseek` -> `LLM_DEEPSEEK`
 *   `search.brave` -> `SEARCH_BRAVE`
 *
 * The Bitwarden Secrets Manager adapter (preferred for production) is a future
 * implementation behind the same `SecretProvider` interface. This class is the
 * dev bootstrap only.
 */
export class EnvSecretProvider implements SecretProvider {
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
  }

  async resolve(secretRef: string): Promise<string | undefined> {
    const envName = secretRef
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!envName) return undefined;
    const value = this.env[envName];
    return value && value.length > 0 ? value : undefined;
  }
}
