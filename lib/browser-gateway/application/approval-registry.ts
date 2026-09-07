import { randomBytes, createHmac, timingSafeEqual } from 'crypto';

/**
 * Approval registry (AC19 / AC16 / BLOCKER-E).
 *
 * A caller-supplied `approval: { approved: true }` on a task payload is NOT
 * trusted — a hostile agent could self-approve any side effect. Instead, an
 * external trusted authority (a human operator / policy service) approves a
 * pending request through this registry and receives a one-time token. The
 * safety gate verifies the token against the registry before allowing an
 * irreversible side-effect action to execute.
 *
 * The workflow is:
 *   approval_required -> createPending -> (operator) approve -> one-time token
 *   -> execute the exact approved action once.
 *
 * The token is a random approvalId bound to the task/action it authorizes,
 * signed with a server-side secret so it cannot be forged by a caller that only
 * sees the approvalId. Verification is constant-time. Tokens are ONE-TIME
 * (replay-protected), have a TTL, and can be revoked.
 *
 * `approve` is the TRUSTED human/operator action. It is only reachable through
 * the operator channel (CLI), never through the MCP `gateway_execute` surface,
 * so an untrusted MCP caller cannot self-approve.
 */
export interface ApprovalRequest {
  taskId: string;
  sessionId: string;
  actionType: string;
  /**
   * Optional target (selector) the approved action is bound to. When present,
   * a token authorizes ONLY that exact reviewed target — e.g. a token issued
   * for `#btn-482` cannot approve a click on `#delete-account`.
   */
  target?: string;
  /** Optional human-readable reason recorded for audit. */
  reason?: string;
}

export interface ApprovalToken {
  approvalId: string;
  signature: string;
}

export type PendingStatus = 'pending' | 'approved' | 'expired' | 'revoked';

export interface PendingApproval {
  pendingId: string;
  request: ApprovalRequest;
  status: PendingStatus;
  createdAt: number;
  expiresAt: number;
  approver?: string;
  token?: ApprovalToken;
}

export type ApproveResult =
  | { ok: true; token: ApprovalToken }
  | { ok: false; reason: string };

export interface ApprovalRegistry {
  /**
   * Create a pending approval request. Returns the pending record with a random
   * `pendingId`, `createdAt`, and `expiresAt = now + ttlMs` (default TTL).
   */
  createPending(request: ApprovalRequest, ttlMs?: number): PendingApproval;
  /** Fetch a pending approval by id, or undefined if unknown. */
  getPending(pendingId: string): PendingApproval | undefined;
  /** List all pending approvals (for operator visibility). */
  listPending(): PendingApproval[];
  /**
   * The TRUSTED human/operator action. Approves a pending request, issuing a
   * one-time token bound to the EXACT request. Rejects if not `pending`, if
   * expired, or if revoked. Records the approver identity.
   */
  approve(pendingId: string, approver: string): ApproveResult;
  /**
   * Verify a token authorizes the given task/action. Returns true ONLY if the
   * token is valid (signed, bound to the exact request), not expired, not
   * revoked, and NOT already used. On a successful verify the token is marked
   * USED (one-time / replay protection). Constant-time signature comparison.
   */
  verify(token: ApprovalToken, request: ApprovalRequest): boolean;
  /** Revoke a token/pending so it can no longer be used. */
  revoke(approvalId: string): void;
  /**
   * Convenience: create a pending request and immediately approve it, returning
   * a one-time token. Equivalent to `createPending` + `approve`. Retained for
   * backward compatibility with the pre-BLOCKER-E `issue` API.
   */
  issue(request: ApprovalRequest, ttlMs?: number): ApprovalToken;
}

export const DEFAULT_APPROVAL_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class HmacApprovalRegistry implements ApprovalRegistry {
  private readonly secret: string;
  private readonly pendings = new Map<string, PendingApproval>();
  private readonly used = new Set<string>();
  private readonly revoked = new Set<string>();

  constructor(secret?: string) {
    this.secret = secret ?? process.env.APPROVAL_SECRET ?? 'dev-approval-secret';
  }

  createPending(request: ApprovalRequest, ttlMs: number = DEFAULT_APPROVAL_TTL_MS): PendingApproval {
    const pendingId = randomBytes(16).toString('hex');
    const now = Date.now();
    const pending: PendingApproval = {
      pendingId,
      request: { ...request },
      status: 'pending',
      createdAt: now,
      expiresAt: now + ttlMs,
    };
    this.pendings.set(pendingId, pending);
    return pending;
  }

  issue(request: ApprovalRequest, ttlMs?: number): ApprovalToken {
    const pending = this.createPending(request, ttlMs);
    const result = this.approve(pending.pendingId, 'operator');
    if (!result.ok) throw new Error(`failed to issue approval: ${result.reason}`);
    return result.token;
  }

  getPending(pendingId: string): PendingApproval | undefined {
    return this.pendings.get(pendingId);
  }

  listPending(): PendingApproval[] {
    return Array.from(this.pendings.values());
  }

  approve(pendingId: string, approver: string): ApproveResult {
    const pending = this.pendings.get(pendingId);
    if (!pending) return { ok: false, reason: `unknown pending approval: ${pendingId}` };
    if (pending.status !== 'pending') {
      return { ok: false, reason: `pending approval is not pending (status: ${pending.status})` };
    }
    if (Date.now() > pending.expiresAt) {
      pending.status = 'expired';
      return { ok: false, reason: 'pending approval has expired' };
    }
    // The token's approvalId is the SAME as the pendingId so `verify` can look
    // up the pending record by `token.approvalId`. This keeps the one-time/TTL/
    // revoke state keyed consistently and makes the token portable across
    // processes (the HMAC signature is deterministic given approvalId + request
    // + secret).
    const approvalId = pending.pendingId;
    const signature = this.sign(approvalId, pending.request);
    const token: ApprovalToken = { approvalId, signature };
    pending.status = 'approved';
    pending.approver = approver;
    pending.token = token;
    return { ok: true, token };
  }

  verify(token: ApprovalToken, request: ApprovalRequest): boolean {
    if (!token || !token.approvalId || !token.signature) return false;
    if (this.revoked.has(token.approvalId)) return false;
    if (this.used.has(token.approvalId)) return false; // one-time / replay protection
    const pending = this.pendings.get(token.approvalId);
    if (!pending) return false;
    if (pending.status === 'revoked') return false;
    if (Date.now() > pending.expiresAt) {
      pending.status = 'expired';
      return false;
    }
    // The token must be bound to the exact task/action it was issued for.
    if (!sameRequest(pending.request, request)) return false;
    const expected = this.sign(token.approvalId, pending.request);
    if (!safeEqual(token.signature, expected)) return false;
    // Mark used so a replay is rejected.
    this.used.add(token.approvalId);
    return true;
  }

  revoke(approvalId: string): void {
    this.revoked.add(approvalId);
    const pending = this.pendings.get(approvalId);
    if (pending) pending.status = 'revoked';
  }

  // --- Persistence support (used by FileApprovalRegistry) -------------------

  /** Re-insert a pending record preserving its identity/token (for file rehydration). */
  rehydrate(p: PendingApproval): void {
    this.pendings.set(p.pendingId, p);
    if (p.token) this.pendings.set(p.token.approvalId, p);
  }

  /** Mark a token id as used (one-time). */
  markUsed(approvalId: string): void {
    this.used.add(approvalId);
  }

  /** List all used token ids (for persistence). */
  listUsed(): string[] {
    return Array.from(this.used);
  }

  /** List all revoked token ids (for persistence). */
  listRevoked(): string[] {
    return Array.from(this.revoked);
  }

  private sign(approvalId: string, request: ApprovalRequest): string {
    const payload = [
      approvalId,
      request.taskId,
      request.sessionId,
      request.actionType,
      request.target ?? '',
    ].join('|');
    return createHmac('sha256', this.secret).update(payload).digest('hex');
  }
}

function sameRequest(a: ApprovalRequest, b: ApprovalRequest): boolean {
  return (
    a.taskId === b.taskId &&
    a.sessionId === b.sessionId &&
    a.actionType === b.actionType &&
    (a.target ?? '') === (b.target ?? '')
  );
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
