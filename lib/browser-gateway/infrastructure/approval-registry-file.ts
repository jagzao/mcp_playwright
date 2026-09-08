import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { join } from 'path';
import { logger } from '../../observability/logger.js';
import {
  HmacApprovalRegistry,
  type ApprovalRegistry,
  type ApprovalRequest,
  type ApprovalToken,
  type PendingApproval,
  type ApproveResult,
} from '../application/approval-registry.js';

/**
 * File-backed approval registry (BLOCKER-E).
 *
 * The MCP server and the operator CLI are separate processes. For the CLI to
 * approve a pending request created by the MCP server, the registry state must
 * be shared. This registry persists pending requests + used-token ids to a JSON
 * file under `data/` (mirroring the `FileSessionVault` pattern), so the operator
 * CLI can see and approve pending requests created by the MCP server.
 *
 * The token itself is self-contained (HMAC-signed with `APPROVAL_SECRET`), so
 * it is portable across processes even if the pending store differs.
 *
 * The in-memory `HmacApprovalRegistry` is the source of truth for signing and
 * verification; this class adds durable persistence of the pending/used/revoked
 * state on top of it. If the file store is unavailable, callers should fall back
 * to the in-memory registry (see `gateway-factory.ts`).
 */
interface PersistedState {
  pendings: PendingApproval[];
  used: string[];
  revoked: string[];
}

export class FileApprovalRegistry implements ApprovalRegistry {
  private readonly inner: HmacApprovalRegistry;
  private readonly filePath: string;
  private readonly dir: string;

  constructor(secret?: string, filePath?: string) {
    this.inner = new HmacApprovalRegistry(secret);
    this.dir = join(process.cwd(), 'data', 'approvals');
    this.filePath = filePath ?? join(this.dir, 'approval-registry.json');
    this.load();
  }

  createPending(request: ApprovalRequest, ttlMs?: number): PendingApproval {
    const pending = this.inner.createPending(request, ttlMs);
    this.persist();
    return pending;
  }

  issue(request: ApprovalRequest, ttlMs?: number): ApprovalToken {
    const token = this.inner.issue(request, ttlMs);
    this.persist();
    return token;
  }

  getPending(pendingId: string): PendingApproval | undefined {
    this.reload();
    return this.inner.getPending(pendingId);
  }

  listPending(): PendingApproval[] {
    this.reload();
    return this.inner.listPending();
  }

  approve(pendingId: string, approver: string): ApproveResult {
    this.reload();
    const result = this.inner.approve(pendingId, approver);
    this.persist();
    return result;
  }

  verify(token: ApprovalToken, request: ApprovalRequest): boolean {
    // Reload from disk first so a cross-process approval (operator CLI) is
    // visible to this process. BLOCKER-F requires `status === 'approved'`, so
    // a stale in-memory copy that still says `pending` would wrongly reject a
    // token the operator already approved in another process.
    this.reload();
    const ok = this.inner.verify(token, request);
    if (ok) this.persist();
    return ok;
  }

  revoke(approvalId: string): void {
    this.inner.revoke(approvalId);
    this.persist();
  }

  // --- Persistence -----------------------------------------------------------

  /**
   * Reload the in-memory state from disk. Used before verify/approve/getPending
   * so a cross-process approval (operator CLI) is visible to this process.
   * BLOCKER-F requires `status === 'approved'`, so a stale in-memory copy that
   * still says `pending` would wrongly reject a token the operator already
   * approved in another process.
   */
  private reload(): void {
    this.inner.clear();
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const state = JSON.parse(raw) as PersistedState;
      for (const p of state.pendings ?? []) {
        // Rehydrate into the inner registry. We can't call createPending (it
        // would mint a new id), so we re-issue via the same HMAC signing by
        // reconstructing the pending record. The inner registry stores pendings
        // keyed by approvalId for approved tokens and by pendingId for pending
        // ones; we re-insert both.
        this.rehydrate(p);
      }
      for (const id of state.used ?? []) this.inner.markUsed(id);
      for (const id of state.revoked ?? []) this.inner.revoke(id);
    } catch (error: any) {
      logger.error('Failed to load approval registry state', { error: error.message });
    }
  }

  private rehydrate(p: PendingApproval): void {
    // Re-insert the pending record into the inner registry preserving its
    // identity and token. The inner registry exposes no public rehydrate hook,
    // so we reconstruct via the same internal shape by re-issuing the token
    // signature deterministically (HMAC is deterministic given the same
    // approvalId + request + secret).
    this.inner.rehydrate(p);
  }

  private persist(): void {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      const state: PersistedState = {
        pendings: this.inner.listPending(),
        used: this.inner.listUsed(),
        revoked: this.inner.listRevoked(),
      };
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
      renameSync(tmp, this.filePath);
    } catch (error: any) {
      logger.error('Failed to persist approval registry state', { error: error.message });
    }
  }
}
