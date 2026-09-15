import type { BrowserEngineId } from './browser-result.js';

/**
 * Abstraction over a live browser runtime owned by the persistent BrowserHost.
 *
 * The host depends on this interface (not on Playwright directly) so unit tests
 * can inject fakes and so the host stays provider-neutral. A runtime owns live
 * browser sessions keyed by sessionId and must NOT auto-close a session on task
 * or turn completion — only explicit close does.
 */
export interface BrowserRuntime {
  readonly engine: BrowserEngineId;

  /**
   * Launch (or reuse) a live browser session for `sessionId`.
   * `headed` forces a visible browser (required for human takeover).
   */
  openSession(sessionId: string, opts?: { headed?: boolean }): Promise<void>;

  /**
   * Return the current URL of the session's active page, or undefined if the
   * session has no page yet.
   */
  currentUrl(sessionId: string): Promise<string | undefined>;

  /**
   * True if the live browser/context/page for the session is still alive.
   * Used to detect a lost browser (process crash) vs a healthy one.
   */
  isAlive(sessionId: string): Promise<boolean>;

  /** Explicitly close and release the session's browser resources. */
  closeSession(sessionId: string): Promise<void>;

  /** Close every live session (host shutdown). */
  closeAll(): Promise<void>;

  /**
   * Capture the current authenticated browser state (cookies + storage) for a
   * session so it can be persisted encrypted by the SessionVault. Returns
   * undefined if the session has no capturable state. The returned payload is
   * sensitive and must never be logged or returned to tool callers.
   */
  captureAuthState?(sessionId: string): Promise<unknown | undefined>;

  /** Restore an auth state previously captured with `captureAuthState`. */
  restoreAuthState?(sessionId: string, state: unknown): Promise<void>;

  /**
   * Navigate the session's active page to a URL. Optional to keep the interface
   * minimal; used by the host to preserve the useful page across headless ->
   * headed promotion. Best-effort — failures must not block takeover.
   */
  navigateTo?(sessionId: string, url: string): Promise<void>;
}
