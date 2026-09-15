/**
 * SecretProvider abstraction (US-002 / Phase D).
 *
 * Resolves API keys / password references / service secrets behind a single
 * interface so the application/domain layer never depends directly on
 * Bitwarden, environment variables or any other provider API (AC12).
 *
 * The interface returns the secret VALUE only to trusted callers. It must
 * never be logged, and the value must never be returned in tool results.
 *
 * Bitwarden Secrets Manager is the preferred machine-secret provider and is
 * documented as a future adapter behind this same interface. It is NOT
 * implemented here (no credentials available). `EnvSecretProvider` is the
 * dev/local bootstrap implementation; `FakeSecretProvider` is for tests.
 */

export interface SecretProvider {
  /**
   * Resolve a secret reference to its value. Returns `undefined` when the
   * reference is unknown or the provider cannot resolve it.
   *
   * The returned value is sensitive — callers must not log it or include it
   * in tool results.
   */
  resolve(secretRef: string): Promise<string | undefined>;
}

/**
 * In-memory fake for tests. Maps refs to values directly.
 */
export class FakeSecretProvider implements SecretProvider {
  private readonly secrets = new Map<string, string>();

  constructor(entries?: Record<string, string>) {
    if (entries) {
      for (const [ref, value] of Object.entries(entries)) {
        this.secrets.set(ref, value);
      }
    }
  }

  set(ref: string, value: string): void {
    this.secrets.set(ref, value);
  }

  async resolve(secretRef: string): Promise<string | undefined> {
    return this.secrets.get(secretRef);
  }
}
