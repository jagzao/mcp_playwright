import { describe, expect, it } from 'vitest';
import { HmacApprovalRegistry } from '../../../lib/browser-gateway/application/approval-registry.js';

describe('HmacApprovalRegistry (AC19 / BLOCKER-2)', () => {
  it('issues an opaque token that verifies for the exact task/action', () => {
    const registry = new HmacApprovalRegistry('test-secret');
    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
    expect(token.approvalId).toBeTruthy();
    expect(token.signature).toBeTruthy();
    expect(registry.verify(token, { taskId: 't-1', sessionId: 's-1', actionType: 'submit' })).toBe(true);
  });

  it('rejects a token for a different task', () => {
    const registry = new HmacApprovalRegistry('test-secret');
    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
    expect(registry.verify(token, { taskId: 't-2', sessionId: 's-1', actionType: 'submit' })).toBe(false);
  });

  it('rejects a token for a different session', () => {
    const registry = new HmacApprovalRegistry('test-secret');
    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
    expect(registry.verify(token, { taskId: 't-1', sessionId: 's-2', actionType: 'submit' })).toBe(false);
  });

  it('rejects a token for a different action type', () => {
    const registry = new HmacApprovalRegistry('test-secret');
    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
    expect(registry.verify(token, { taskId: 't-1', sessionId: 's-1', actionType: 'publish' })).toBe(false);
  });

  it('rejects a forged signature', () => {
    const registry = new HmacApprovalRegistry('test-secret');
    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
    expect(
      registry.verify({ approvalId: token.approvalId, signature: 'forged' }, { taskId: 't-1', sessionId: 's-1', actionType: 'submit' }),
    ).toBe(false);
  });

  it('rejects an unknown approvalId', () => {
    const registry = new HmacApprovalRegistry('test-secret');
    expect(
      registry.verify({ approvalId: 'unknown', signature: 'x' }, { taskId: 't-1', sessionId: 's-1', actionType: 'submit' }),
    ).toBe(false);
  });

  it('rejects a revoked token', () => {
    const registry = new HmacApprovalRegistry('test-secret');
    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
    registry.revoke(token.approvalId);
    expect(registry.verify(token, { taskId: 't-1', sessionId: 's-1', actionType: 'submit' })).toBe(false);
  });

  it('tokens from different registries (different secrets) do not cross-verify', () => {
    const a = new HmacApprovalRegistry('secret-a');
    const b = new HmacApprovalRegistry('secret-b');
    const token = a.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
    expect(b.verify(token, { taskId: 't-1', sessionId: 's-1', actionType: 'submit' })).toBe(false);
  });
});
