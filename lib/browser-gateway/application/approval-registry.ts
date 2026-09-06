import { randomBytes, createHmac, timingSafeEqual } from 'crypto';

/**
 * Approval registry (AC19 / AC16).
 *
 * A caller-supplied `approval: { approved: true }` on a task payload is NOT
 * trusted — a hostile agent could self-approve any side effect. Instead, an
 * external trusted authority (a human operator / policy service) issues an
 * opaque approval token through this registry. The safety gate verifies the
 * token against the registry before allowing an irreversible side-effect
 * action to execute.
 *
 * The token is a random approvalId bound to the task/action it authorizes,
 * signed with a server-side secret so it cannot be forged by a caller that
 * only sees the approvalId. Verification is constant-time.
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

export interface ApprovalRegistry {
  /** Issue an opaque approval token for a specific task/action. */
  issue(request: ApprovalRequest): ApprovalToken;
  /**
   * Verify a token authorizes the given task/action. Returns true only for a
   * token issued by this registry for the exact task/action and not yet
   * revoked. Constant-time.
   */
  verify(token: ApprovalToken, request: ApprovalRequest): boolean;
  /** Revoke a previously issued token (e.g. after use or on policy change). */
  revoke(approvalId: string): void;
}

export class HmacApprovalRegistry implements ApprovalRegistry {
  private readonly secret: string;
  private readonly issued = new Map<string, { request: ApprovalRequest; signature: string }>();
  private readonly revoked = new Set<string>();

  constructor(secret?: string) {
    this.secret = secret ?? process.env.APPROVAL_SECRET ?? 'dev-approval-secret';
  }

  issue(request: ApprovalRequest): ApprovalToken {
    const approvalId = randomBytes(16).toString('hex');
    const signature = this.sign(approvalId, request);
    this.issued.set(approvalId, { request, signature });
    return { approvalId, signature };
  }

  verify(token: ApprovalToken, request: ApprovalRequest): boolean {
    if (!token || !token.approvalId || !token.signature) return false;
    if (this.revoked.has(token.approvalId)) return false;
    const entry = this.issued.get(token.approvalId);
    if (!entry) return false;
    // The token must be bound to the exact task/action it was issued for.
    if (!sameRequest(entry.request, request)) return false;
    const expected = this.sign(token.approvalId, request);
    return safeEqual(token.signature, expected);
  }

  revoke(approvalId: string): void {
    this.revoked.add(approvalId);
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
