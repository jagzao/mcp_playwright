import type { BrowserEngineId } from './browser-result.js';

/**
 * Full lifecycle of a gateway/browser session.
 *
 * ```text
 * created -> active -> waiting_for_user -> resumable -> active
 *   -> completed | failed | cancelled
 * plus idle, closed, expired, reauthentication_required where appropriate.
 * ```
 *
 * `waiting_for_user` is a first-class successful suspension state, NOT an
 * error. A waiting session is neither failed nor completed.
 */
export type GatewaySessionStatus =
  | 'created'
  | 'active'
  | 'waiting_for_user'
  | 'resumable'
  | 'idle'
  | 'closed'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'reauthentication_required';

/**
 * A gateway session is the isolation boundary for cookies, storage, browser
 * context, target history and agent task metadata. Two unrelated sessions must
 * never share browser state.
 *
 * Sessions are tracked at the application level by the gateway facade. Deeper
 * multi-context browser-state isolation and persistent lifecycle are owned by
 * the Phase C BrowserHost.
 */
export interface GatewaySession {
  sessionId: string;
  status: GatewaySessionStatus;
  createdAt: number;
  /** Optional pinned engine for the session (e.g. forced Playwright takeover). */
  engine?: BrowserEngineId;
  metadata?: Record<string, string>;
}

/**
 * A resumable checkpoint captured when a session is suspended for a human.
 * Only opaque identifiers are returned to callers — never cookies, passwords
 * or storage state.
 */
export interface BrowserCheckpoint {
  checkpointId: string;
  activityId: string;
  browserSessionId: string;
  /** Opaque reference to the live tab/page (never a secret). */
  pageRef: string;
  url: string;
  reason: string;
  safeInstructions?: string;
  createdAt: number;
}

/**
 * Typed continuity status returned when resuming a session. Distinguishes a
 * genuinely live browser from one that was lost and needs recovery.
 */
export type BrowserRecoveryStatus =
  | 'live_continuity'
  | 'reauthentication_required'
  | 'recovery_required';

/**
 * A session owned by the persistent BrowserHost. The host keeps the live
 * browser/context/page open independently of any LLM turn or tool call.
 */
export interface BrowserHostSession {
  sessionId: string;
  status: GatewaySessionStatus;
  engine: BrowserEngineId;
  headed: boolean;
  createdAt: number;
  updatedAt: number;
  checkpoint?: BrowserCheckpoint;
  recovery?: BrowserRecoveryStatus;
  metadata?: Record<string, string>;
}
