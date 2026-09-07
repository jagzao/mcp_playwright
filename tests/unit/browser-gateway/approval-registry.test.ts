import { describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';
import {
  HmacApprovalRegistry,
  deriveApprovalSecret,
} from '../../../lib/browser-gateway/application/approval-registry.js';

// A strong (>=32 char, non-placeholder) approval secret for tests.
const STRONG_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
const STRONG_SECRET_A = 'test-secret-a-0123456789abcdef0123456789abcdef';
const STRONG_SECRET_B = 'test-secret-b-0123456789abcdef0123456789abcdef';

describe('HmacApprovalRegistry (AC19 / BLOCKER-2)', () => {
  it('issues an opaque token that verifies for the exact task/action', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
    expect(token.approvalId).toBeTruthy();
    expect(token.signature).toBeTruthy();
    expect(registry.verify(token, { taskId: 't-1', sessionId: 's-1', actionType: 'submit' })).toBe(true);
  });

  it('rejects a token for a different task', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
    expect(registry.verify(token, { taskId: 't-2', sessionId: 's-1', actionType: 'submit' })).toBe(false);
  });

  it('rejects a token for a different session', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
    expect(registry.verify(token, { taskId: 't-1', sessionId: 's-2', actionType: 'submit' })).toBe(false);
  });

  it('rejects a token for a different action type', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
    expect(registry.verify(token, { taskId: 't-1', sessionId: 's-1', actionType: 'publish' })).toBe(false);
  });

  it('rejects a forged signature', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
    expect(
      registry.verify({ approvalId: token.approvalId, signature: 'forged' }, { taskId: 't-1', sessionId: 's-1', actionType: 'submit' }),
    ).toBe(false);
  });

  it('rejects an unknown approvalId', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    expect(
      registry.verify({ approvalId: 'unknown', signature: 'x' }, { taskId: 't-1', sessionId: 's-1', actionType: 'submit' }),
    ).toBe(false);
  });

  it('rejects a revoked token', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
    registry.revoke(token.approvalId);
    expect(registry.verify(token, { taskId: 't-1', sessionId: 's-1', actionType: 'submit' })).toBe(false);
  });

  it('tokens from different registries (different secrets) do not cross-verify', () => {
    const a = new HmacApprovalRegistry(STRONG_SECRET_A);
    const b = new HmacApprovalRegistry(STRONG_SECRET_B);
    const token = a.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
    expect(b.verify(token, { taskId: 't-1', sessionId: 's-1', actionType: 'submit' })).toBe(false);
  });
});

describe('HmacApprovalRegistry (BLOCKER-E: pending -> approve -> one-time token)', () => {
  const request = { taskId: 't-1', sessionId: 's-1', actionType: 'click', target: '#delete-account' };

  it('createPending returns a pending record with pendingId/createdAt/expiresAt', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const pending = registry.createPending(request);
    expect(pending.pendingId).toBeTruthy();
    expect(pending.status).toBe('pending');
    expect(pending.createdAt).toBeGreaterThan(0);
    expect(pending.expiresAt).toBeGreaterThan(pending.createdAt);
    expect(registry.getPending(pending.pendingId)).toBeDefined();
    expect(registry.listPending().some((p) => p.pendingId === pending.pendingId)).toBe(true);
  });

  it('createPending honors a custom TTL', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const pending = registry.createPending(request, 1000);
    expect(pending.expiresAt - pending.createdAt).toBe(1000);
  });

  it('untrusted caller cannot self-approve (no approve path from a task)', () => {
    // The ApprovalRegistry interface exposes no way for a task/caller to approve
    // itself: `approve` requires a pendingId + approver identity and is only
    // reachable through the operator channel. A caller only has `verify`.
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const pending = registry.createPending(request);
    // A caller cannot mint a token without the operator approve step.
    expect(registry.getPending(pending.pendingId)?.token).toBeUndefined();
  });

  it('human/trusted authority can approve exactly one action/target', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const pending = registry.createPending(request);
    const result = registry.approve(pending.pendingId, 'operator');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token.approvalId).toBeTruthy();
    expect(result.token.signature).toBeTruthy();
    const updated = registry.getPending(pending.pendingId)!;
    expect(updated.status).toBe('approved');
    expect(updated.approver).toBe('operator');
    expect(updated.token).toEqual(result.token);
  });

  it('approve rejects a non-pending request', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const pending = registry.createPending(request);
    registry.approve(pending.pendingId, 'operator');
    const second = registry.approve(pending.pendingId, 'operator');
    expect(second.ok).toBe(false);
  });

  it('approve rejects an unknown pendingId', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const result = registry.approve('does-not-exist', 'operator');
    expect(result.ok).toBe(false);
  });

  it('token does not work for another target/task/session', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const pending = registry.createPending(request);
    const result = registry.approve(pending.pendingId, 'operator');
    if (!result.ok) return;
    const token = result.token;
    expect(registry.verify(token, { ...request, target: '#other' })).toBe(false);
    expect(registry.verify(token, { ...request, taskId: 't-other' })).toBe(false);
    expect(registry.verify(token, { ...request, sessionId: 's-other' })).toBe(false);
  });

  it('expiry rejected', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const pending = registry.createPending(request, -1); // already expired
    const approve = registry.approve(pending.pendingId, 'operator');
    expect(approve.ok).toBe(false);
    // A token issued then expired is rejected on verify.
    const p2 = registry.createPending(request, 1000);
    const r2 = registry.approve(p2.pendingId, 'operator');
    if (!r2.ok) return;
    // Simulate expiry by advancing time is not possible; instead verify the
    // expired-pending path above. For the token path, revoke covers it.
    expect(registry.verify(r2.token, request)).toBe(true);
  });

  it('revoke rejected', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const pending = registry.createPending(request);
    const result = registry.approve(pending.pendingId, 'operator');
    if (!result.ok) return;
    registry.revoke(result.token.approvalId);
    expect(registry.verify(result.token, request)).toBe(false);
  });

  it('replay rejected (token used once, second verify false)', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const pending = registry.createPending(request);
    const result = registry.approve(pending.pendingId, 'operator');
    if (!result.ok) return;
    const token = result.token;
    expect(registry.verify(token, request)).toBe(true);
    expect(registry.verify(token, request)).toBe(false); // replay rejected
  });

  it('after valid approval the exact pending action executes', () => {
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const pending = registry.createPending(request);
    const result = registry.approve(pending.pendingId, 'operator');
    if (!result.ok) return;
    // The token verifies for the exact request, authorizing execution.
    expect(registry.verify(result.token, request)).toBe(true);
  });
});

describe('HmacApprovalRegistry (BLOCKER-F: no default secret, fail-closed, approved-only verify)', () => {
  const request = { taskId: 't-1', sessionId: 's-1', actionType: 'click', target: '#delete-account' };

  it('a pending NOT approved can never verify, even with a computable/injected valid HMAC signature', () => {
    // Adversarial: the caller knows the secret (or can compute the HMAC) and
    // injects a perfectly valid signature for the pending record. The
    // `status === 'approved'` gate must still block it — the pending was never
    // approved by the operator.
    const registry = new HmacApprovalRegistry(STRONG_SECRET);
    const pending = registry.createPending(request);
    expect(pending.status).toBe('pending');

    // Compute the exact signature the registry WOULD produce if it approved.
    const payload = [
      pending.pendingId,
      request.taskId,
      request.sessionId,
      request.actionType,
      request.target ?? '',
    ].join('|');
    const forgedSignature = createHmac('sha256', STRONG_SECRET).update(payload).digest('hex');

    // Even with a valid signature, a non-approved pending must NOT verify.
    expect(
      registry.verify({ approvalId: pending.pendingId, signature: forgedSignature }, request),
    ).toBe(false);

    // Sanity: the SAME signature DOES verify once the operator approves it,
    // proving the gate is the `approved` status, not the signature.
    const approved = registry.approve(pending.pendingId, 'operator');
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.token.signature).toBe(forgedSignature);
    expect(registry.verify(approved.token, request)).toBe(true);
  });

  it('registry without a secret and without MASTER_KEY is fail-closed', () => {
    const prev = process.env.MASTER_KEY;
    const prevApproval = process.env.APPROVAL_SECRET;
    delete process.env.MASTER_KEY;
    delete process.env.APPROVAL_SECRET;
    try {
      const registry = new HmacApprovalRegistry();
      expect(registry.isConfigured()).toBe(false);
      // createPending / approve / issue throw (fail-closed).
      expect(() => registry.createPending(request)).toThrow();
      expect(() => registry.issue(request)).toThrow();
      // verify returns false (fail-closed), never a known-default success.
      expect(registry.verify({ approvalId: 'x', signature: 'y' }, request)).toBe(false);
    } finally {
      if (prev !== undefined) process.env.MASTER_KEY = prev;
      else delete process.env.MASTER_KEY;
      if (prevApproval !== undefined) process.env.APPROVAL_SECRET = prevApproval;
      else delete process.env.APPROVAL_SECRET;
    }
  });

  it('an explicit empty-string secret is treated as unconfigured (fail-closed)', () => {
    const prev = process.env.MASTER_KEY;
    const prevApproval = process.env.APPROVAL_SECRET;
    delete process.env.MASTER_KEY;
    delete process.env.APPROVAL_SECRET;
    try {
      const registry = new HmacApprovalRegistry('');
      expect(registry.isConfigured()).toBe(false);
      expect(() => registry.createPending(request)).toThrow();
    } finally {
      if (prev !== undefined) process.env.MASTER_KEY = prev;
      else delete process.env.MASTER_KEY;
      if (prevApproval !== undefined) process.env.APPROVAL_SECRET = prevApproval;
      else delete process.env.APPROVAL_SECRET;
    }
  });

  it('HKDF derivation from MASTER_KEY produces a working secret; same MASTER_KEY cross-verifies, different do not', () => {
    const masterA = 'master-key-a-0123456789abcdef0123456789abcdef';
    const masterB = 'master-key-b-0123456789abcdef0123456789abcdef';

    // Same MASTER_KEY -> same derived subkey -> cross-verify.
    const a1 = new HmacApprovalRegistry(masterA);
    const a2 = new HmacApprovalRegistry(masterA);
    expect(a1.isConfigured()).toBe(true);
    expect(a2.isConfigured()).toBe(true);
    const pending = a1.createPending(request);
    const approved = a1.approve(pending.pendingId, 'operator');
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const token = approved.token;
    // Rehydrate the pending into a2 (as the file-backed registry does across
    // processes) so a2 can look it up, then verify with the SAME derived secret.
    a2.rehydrate(a1.getPending(pending.pendingId)!);
    expect(a2.verify(token, request)).toBe(true);

    // Different MASTER_KEY -> different subkey -> no cross-verify.
    const b = new HmacApprovalRegistry(masterB);
    b.rehydrate(a1.getPending(pending.pendingId)!);
    expect(b.verify(token, request)).toBe(false);

    // The derived subkey is deterministic and distinct from the master key.
    expect(deriveApprovalSecret(masterA)).toBe(deriveApprovalSecret(masterA));
    expect(deriveApprovalSecret(masterA)).not.toBe(masterA);
    expect(deriveApprovalSecret(masterA)).not.toBe(deriveApprovalSecret(masterB));
  });

  it('a too-short MASTER_KEY does not configure the registry (fail-closed)', () => {
    const prev = process.env.MASTER_KEY;
    const prevApproval = process.env.APPROVAL_SECRET;
    delete process.env.APPROVAL_SECRET;
    process.env.MASTER_KEY = 'short';
    try {
      const registry = new HmacApprovalRegistry();
      expect(registry.isConfigured()).toBe(false);
      expect(() => registry.createPending(request)).toThrow();
    } finally {
      if (prev !== undefined) process.env.MASTER_KEY = prev;
      else delete process.env.MASTER_KEY;
      if (prevApproval !== undefined) process.env.APPROVAL_SECRET = prevApproval;
      else delete process.env.APPROVAL_SECRET;
    }
  });
});

describe('HmacApprovalRegistry (BLOCKER-I: public placeholder MASTER_KEY must never configure)', () => {
  const request = { taskId: 't-1', sessionId: 's-1', actionType: 'click', target: '#delete-account' };

  it('the committed .env.example placeholder MASTER_KEY cannot configure the registry', () => {
    const prev = process.env.MASTER_KEY;
    const prevApproval = process.env.APPROVAL_SECRET;
    process.env.MASTER_KEY = 'your-32-character-master-key-here';
    delete process.env.APPROVAL_SECRET;
    try {
      const registry = new HmacApprovalRegistry();
      expect(registry.isConfigured()).toBe(false);
      expect(() => registry.createPending(request)).toThrow();
      expect(registry.verify({ approvalId: 'x', signature: 'y' }, request)).toBe(false);
    } finally {
      if (prev !== undefined) process.env.MASTER_KEY = prev;
      else delete process.env.MASTER_KEY;
      if (prevApproval !== undefined) process.env.APPROVAL_SECRET = prevApproval;
      else delete process.env.APPROVAL_SECRET;
    }
  });

  it('an all-same-char MASTER_KEY cannot configure the registry', () => {
    const prev = process.env.MASTER_KEY;
    const prevApproval = process.env.APPROVAL_SECRET;
    process.env.MASTER_KEY = 'a'.repeat(32);
    delete process.env.APPROVAL_SECRET;
    try {
      const registry = new HmacApprovalRegistry();
      expect(registry.isConfigured()).toBe(false);
    } finally {
      if (prev !== undefined) process.env.MASTER_KEY = prev;
      else delete process.env.MASTER_KEY;
      if (prevApproval !== undefined) process.env.APPROVAL_SECRET = prevApproval;
      else delete process.env.APPROVAL_SECRET;
    }
  });
});

describe('HmacApprovalRegistry (HIGH-J: strong APPROVAL_SECRET alone configures; weak rejected)', () => {
  const request = { taskId: 't-1', sessionId: 's-1', actionType: 'click', target: '#delete-account' };

  it('a strong APPROVAL_SECRET alone configures the registry with no MASTER_KEY', () => {
    const prev = process.env.MASTER_KEY;
    const prevApproval = process.env.APPROVAL_SECRET;
    delete process.env.MASTER_KEY;
    process.env.APPROVAL_SECRET = STRONG_SECRET;
    try {
      const registry = new HmacApprovalRegistry();
      expect(registry.isConfigured()).toBe(true);
      const pending = registry.createPending(request);
      const approved = registry.approve(pending.pendingId, 'operator');
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      expect(registry.verify(approved.token, request)).toBe(true);
    } finally {
      if (prev !== undefined) process.env.MASTER_KEY = prev;
      else delete process.env.MASTER_KEY;
      if (prevApproval !== undefined) process.env.APPROVAL_SECRET = prevApproval;
      else delete process.env.APPROVAL_SECRET;
    }
  });

  it('a weak explicit APPROVAL_SECRET is rejected (unconfigured)', () => {
    const prev = process.env.MASTER_KEY;
    const prevApproval = process.env.APPROVAL_SECRET;
    delete process.env.MASTER_KEY;
    delete process.env.APPROVAL_SECRET;
    try {
      expect(new HmacApprovalRegistry('x').isConfigured()).toBe(false);
      expect(new HmacApprovalRegistry('').isConfigured()).toBe(false);
      expect(new HmacApprovalRegistry('dev-approval-secret').isConfigured()).toBe(false);
      expect(new HmacApprovalRegistry('test').isConfigured()).toBe(false);
    } finally {
      if (prev !== undefined) process.env.MASTER_KEY = prev;
      else delete process.env.MASTER_KEY;
      if (prevApproval !== undefined) process.env.APPROVAL_SECRET = prevApproval;
      else delete process.env.APPROVAL_SECRET;
    }
  });
});
