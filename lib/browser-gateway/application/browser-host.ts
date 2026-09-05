import type { BrowserRuntime } from '../domain/browser-runtime.js';
import type {
  BrowserCheckpoint,
  BrowserHostSession,
  BrowserRecoveryStatus,
  GatewaySessionStatus,
} from '../domain/browser-session.js';

export interface BrowserHostOptions {
  runtime: BrowserRuntime;
  /** Idle TTL in ms. Never applied to WAITING_FOR_USER sessions. */
  idleTtlMs?: number;
  /** Optional hook for Phase D durable-auth persistence. Left as a no-op hook. */
  persistAuth?: (sessionId: string, checkpoint: BrowserCheckpoint) => Promise<void>;
}

export type SuspendResult =
  | { ok: true; checkpoint: BrowserCheckpoint; status: 'waiting_for_user' }
  | { ok: false; reason: string };

export type ResumeResult =
  | { ok: true; status: 'active'; recovery: BrowserRecoveryStatus; url?: string }
  | { ok: false; reason: string };

export type CloseResult = { ok: true } | { ok: false; reason: string };

/**
 * Persistent BrowserHost daemon/manager.
 *
 * Owns live browser sessions independently of any LLM call/turn. A session is
 * only closed by an explicit `closeSession`/`closeAll` — never on task or turn
 * completion. Supports the human-in-the-loop flow:
 *
 *   active -> suspendForUser -> waiting_for_user (browser stays open)
 *   -> resumeSession -> active (same live tab, no task restatement)
 *
 * `WAITING_FOR_USER` sessions are exempt from the idle TTL. If the underlying
 * browser is lost (process crash), a typed recovery status is returned rather
 * than pretending the same page survived.
 */
export class BrowserHost {
  private readonly sessions = new Map<string, BrowserHostSession>();
  private readonly runtime: BrowserRuntime;
  private readonly idleTtlMs: number;
  private readonly persistAuth?: (sessionId: string, checkpoint: BrowserCheckpoint) => Promise<void>;
  private checkpointCounter = 0;

  constructor(options: BrowserHostOptions) {
    this.runtime = options.runtime;
    this.idleTtlMs = options.idleTtlMs ?? 0;
    this.persistAuth = options.persistAuth;
  }

  // --- Lifecycle ------------------------------------------------------------

  async createSession(
    sessionId: string,
    opts?: { headed?: boolean; metadata?: Record<string, string> },
  ): Promise<BrowserHostSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    await this.runtime.openSession(sessionId, { headed: opts?.headed });
    const now = Date.now();
    const session: BrowserHostSession = {
      sessionId,
      status: 'created',
      engine: this.runtime.engine,
      headed: opts?.headed ?? false,
      createdAt: now,
      updatedAt: now,
      metadata: opts?.metadata,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): BrowserHostSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionStatus(sessionId: string): GatewaySessionStatus | undefined {
    return this.sessions.get(sessionId)?.status;
  }

  listWaitingSessions(): BrowserHostSession[] {
    return [...this.sessions.values()].filter((s) => s.status === 'waiting_for_user');
  }

  listSessions(): BrowserHostSession[] {
    return [...this.sessions.values()];
  }

  // --- Human handoff --------------------------------------------------------

  /**
   * Suspend a session for a human. Pins to headed Playwright, sets
   * WAITING_FOR_USER, keeps the browser open, and records a resumable
   * checkpoint. Returns only opaque identifiers — never secrets.
   */
  async suspendForUser(
    sessionId: string,
    reason: string,
    opts?: { activityId?: string; safeInstructions?: string },
  ): Promise<SuspendResult> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: 'session not found' };
    if (session.status === 'closed' || session.status === 'cancelled') {
      return { ok: false, reason: `session is ${session.status}` };
    }

    // Pin to headed Playwright so the human can interact visibly.
    if (!session.headed) {
      await this.runtime.closeSession(sessionId);
      await this.runtime.openSession(sessionId, { headed: true });
      session.headed = true;
    }

    const url = await this.runtime.currentUrl(sessionId);
    const checkpoint: BrowserCheckpoint = {
      checkpointId: `ck-${sessionId}-${++this.checkpointCounter}`,
      activityId: opts?.activityId ?? sessionId,
      browserSessionId: sessionId,
      pageRef: `page:${sessionId}`,
      url: url ?? '',
      reason,
      safeInstructions: opts?.safeInstructions,
      createdAt: Date.now(),
    };
    session.checkpoint = checkpoint;
    session.status = 'waiting_for_user';
    session.updatedAt = Date.now();

    // Phase D hook: persist durable auth when allowed. Best-effort, never
    // blocks the suspension.
    if (this.persistAuth) {
      await this.persistAuth(sessionId, checkpoint).catch(() => undefined);
    }

    return { ok: true, checkpoint, status: 'waiting_for_user' };
  }

  /**
   * Resume a suspended session from its checkpoint. Re-validates the live
   * browser and continues from the existing tab — the human does NOT need to
   * restate the task. A wrong/missing checkpoint is rejected.
   */
  async resumeSession(sessionId: string, checkpointId: string): Promise<ResumeResult> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: 'session not found' };
    if (session.status !== 'waiting_for_user') {
      return { ok: false, reason: `session is not waiting for user (${session.status})` };
    }
    if (!session.checkpoint || session.checkpoint.checkpointId !== checkpointId) {
      return { ok: false, reason: 'invalid or missing checkpoint' };
    }

    // Detect a lost live browser (process crash) and return a typed recovery
    // status rather than pretending the same page survived.
    const alive = await this.runtime.isAlive(sessionId);
    if (!alive) {
      session.status = 'reauthentication_required';
      session.recovery = 'reauthentication_required';
      session.updatedAt = Date.now();
      return {
        ok: false,
        reason: 'live browser was lost; reauthentication required before continuing',
      };
    }

    session.status = 'active';
    session.recovery = 'live_continuity';
    session.updatedAt = Date.now();
    const url = await this.runtime.currentUrl(sessionId);
    return { ok: true, status: 'active', recovery: 'live_continuity', url };
  }

  /**
   * Re-validate a waiting session's live browser without resuming it. Returns
   * a typed continuity status so the coordinator can tell the user whether the
   * live host was lost.
   */
  async checkpointSession(sessionId: string): Promise<{ recovery: BrowserRecoveryStatus; alive: boolean }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { recovery: 'recovery_required', alive: false };
    const alive = await this.runtime.isAlive(sessionId);
    if (!alive) {
      session.recovery = 'reauthentication_required';
      session.status = 'reauthentication_required';
      session.updatedAt = Date.now();
      return { recovery: 'reauthentication_required', alive: false };
    }
    session.recovery = 'live_continuity';
    return { recovery: 'live_continuity', alive: true };
  }

  /**
   * Explicit close always wins. Releases the live browser and removes the
   * session from the host.
   */
  async closeSession(sessionId: string): Promise<CloseResult> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: 'session not found' };
    await this.runtime.closeSession(sessionId);
    session.status = 'closed';
    session.updatedAt = Date.now();
    this.sessions.delete(sessionId);
    return { ok: true };
  }

  /** Close every live session (host shutdown). */
  async closeAll(): Promise<void> {
    await this.runtime.closeAll();
    this.sessions.clear();
  }

  /**
   * Reclaim idle resources. NEVER applies to WAITING_FOR_USER sessions — those
   * are exempt from the normal idle TTL. Only `idle` sessions older than the
   * TTL are closed.
   */
  async reapIdle(now = Date.now()): Promise<string[]> {
    if (this.idleTtlMs <= 0) return [];
    const reclaimed: string[] = [];
    for (const [id, session] of this.sessions) {
      if (session.status === 'waiting_for_user') continue;
      if (session.status === 'idle' && now - session.updatedAt >= this.idleTtlMs) {
        await this.runtime.closeSession(id);
        session.status = 'closed';
        this.sessions.delete(id);
        reclaimed.push(id);
      }
    }
    return reclaimed;
  }
}
