import { describe, expect, it } from 'vitest';
import { SafetyGate } from '../../../lib/browser-gateway/application/safety-gate.js';
import { HmacApprovalRegistry } from '../../../lib/browser-gateway/application/approval-registry.js';
import type { BrowserTask } from '../../../lib/browser-gateway/domain/browser-task.js';

function task(action: BrowserTask['action'], approval?: BrowserTask['approval']): BrowserTask {
  return { taskId: 't-1', sessionId: 's-1', action, approval };
}

describe('SafetyGate (US-001)', () => {
  it('read-only actions auto-approve', () => {
    const gate = new SafetyGate(true);
    expect(gate.assess(task({ type: 'navigate', url: 'https://example.com' })).status).toBe('allowed');
    expect(gate.assess(task({ type: 'snapshot' })).status).toBe('allowed');
    expect(gate.assess(task({ type: 'extract', selector: 'h1' })).status).toBe('allowed');
    expect(gate.assess(task({ type: 'screenshot' })).status).toBe('allowed');
  });

  it('side-effect actions require approval', () => {
    const gate = new SafetyGate(true);
    expect(gate.assess(task({ type: 'submit', target: '#form' })).status).toBe('approval_required');
    expect(gate.assess(task({ type: 'send', target: '#msg' })).status).toBe('approval_required');
    expect(gate.assess(task({ type: 'publish', target: '#post' })).status).toBe('approval_required');
  });

  it('a bare caller-supplied approved:true is rejected (AC19)', () => {
    const registry = new HmacApprovalRegistry('test-secret');
    const gate = new SafetyGate(true, registry);
    const verdict = gate.assess(
      task({ type: 'submit', target: '#form' }, { approved: true, approvalId: 'a-1' }),
    );
    expect(verdict.status).toBe('approval_required');
  });

  it('a registry-issued approval token allows execution (AC19)', () => {
    const registry = new HmacApprovalRegistry('test-secret');
    const gate = new SafetyGate(true, registry);
    const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
    const verdict = gate.assess(
      task({ type: 'submit', target: '#form' }, { approved: true, approvalId: token.approvalId, signature: token.signature }),
    );
    expect(verdict.status).toBe('allowed');
  });

  it('a token issued for a different task/action is rejected (AC19)', () => {
    const registry = new HmacApprovalRegistry('test-secret');
    const gate = new SafetyGate(true, registry);
    const token = registry.issue({ taskId: 't-other', sessionId: 's-1', actionType: 'submit' });
    const verdict = gate.assess(
      task({ type: 'submit', target: '#form' }, { approved: true, approvalId: token.approvalId, signature: token.signature }),
    );
    expect(verdict.status).toBe('approval_required');
  });

  it('side-effect gate can be disabled', () => {
    const gate = new SafetyGate(false);
    expect(gate.assess(task({ type: 'submit', target: '#form' })).status).toBe('allowed');
  });

  describe('side-effect clicks (BLOCKER-2)', () => {
    it('a plain/read click (no effect flag) is auto-allowed', () => {
      const gate = new SafetyGate(true);
      expect(gate.assess(task({ type: 'click', target: '#next' })).status).toBe('allowed');
      expect(gate.assess(task({ type: 'click', target: '#next', sideEffect: 'read' } as any)).status).toBe(
        'allowed',
      );
    });

    it('a click with sideEffect=true is approval-required without a token (even with registry fallback)', () => {
      const registry = new HmacApprovalRegistry('test-secret');
      const gate = new SafetyGate(true, registry);
      expect(
        gate.assess(task({ type: 'click', target: '#buy', sideEffect: true })).status,
      ).toBe('approval_required');
      // A bare caller-supplied approved:true must not self-approve a side-effect click.
      expect(
        gate.assess(
          task(
            { type: 'click', target: '#buy', sideEffect: true },
            { approved: true, approvalId: 'a-1' },
          ),
        ).status,
      ).toBe('approval_required');
    });

    it('a click with sideEffect=\"side_effect\" is approval-required without a token', () => {
      const gate = new SafetyGate(true);
      expect(
        gate.assess(task({ type: 'click', target: '#submit', sideEffect: 'side_effect' } as any)).status,
      ).toBe('approval_required');
    });

    it('a side-effect click WITH a registry-issued approval token executes (approved path functional)', () => {
      const registry = new HmacApprovalRegistry('test-secret');
      const gate = new SafetyGate(true, registry);
      const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'click' });
      const verdict = gate.assess(
        task(
          { type: 'click', target: '#buy', sideEffect: true },
          { approved: true, approvalId: token.approvalId, signature: token.signature },
        ),
      );
      expect(verdict.status).toBe('allowed');
    });

    it('a side-effect click token for a different action does not approve this click', () => {
      const registry = new HmacApprovalRegistry('test-secret');
      const gate = new SafetyGate(true, registry);
      const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'submit' });
      const verdict = gate.assess(
        task(
          { type: 'click', target: '#buy', sideEffect: true },
          { approved: true, approvalId: token.approvalId, signature: token.signature },
        ),
      );
      expect(verdict.status).toBe('approval_required');
    });
  });

  describe('HIGH-B: caller cannot downgrade an irreversible click', () => {
    const sideEffectTargets = ['#publish', '#buy', '#submit', '#delete', '#send', '#purchase', '#checkout', '#transfer'];
    const readTargets = ['#next', '#nav-home', 'a[href="/docs"]', '.pagination', '#expand'];

    it('a raw click WITHOUT sideEffect on a side-effect-like target is approval_required (fail-safe)', () => {
      const gate = new SafetyGate(true);
      for (const target of sideEffectTargets) {
        // @ts-expect-error — intentionally omit the optional sideEffect to prove the
        // trusted ClickPolicy still catches the irreversible target.
        const verdict = gate.assess(task({ type: 'click', target }));
        expect(verdict.status, `.assess #${target} omitted`).toBe('approval_required');
      }
    });

    it('a caller cannot bypass by setting sideEffect:"read" on a side-effect-like target (policy overrides flag)', () => {
      const gate = new SafetyGate(true);
      for (const target of sideEffectTargets) {
        const verdict = gate.assess(
          task({ type: 'click', target, sideEffect: 'read' }),
        );
        expect(verdict.status, `.assess #${target} read-flag`).toBe('approval_required');
      }
    });

    it('a caller cannot bypass by omitting sideEffect even with a bare approved:true', () => {
      const registry = new HmacApprovalRegistry('test-secret');
      const gate = new SafetyGate(true, registry);
      // @ts-expect-error — intentionally omit sideEffect.
      const verdict = gate.assess(
        task({ type: 'click', target: '#publish' }, { approved: true, approvalId: 'a-1' }),
      );
      expect(verdict.status).toBe('approval_required');
    });

    it('a genuinely reversible / navigation click stays auto-allowed (ergonomic path preserved)', () => {
      const gate = new SafetyGate(true);
      for (const target of readTargets) {
        // @ts-expect-error — no sideEffect, reversible target stays auto-allowed.
        expect(gate.assess(task({ type: 'click', target })).status).toBe('allowed');
      }
    });

    it('benign reversible UI controls are auto-allowed (not irreversible side effects)', () => {
      const gate = new SafetyGate(true);
      const benignTargets = ['#clear-filters', '#reset-form', '#apply-filters', '#accept-cookies', '#drop-down', '#register'];
      for (const target of benignTargets) {
        // @ts-expect-error — no sideEffect, benign reversible control stays auto-allowed.
        expect(gate.assess(task({ type: 'click', target })).status, `.assess #${target}`).toBe('allowed');
      }
    });

    it('an approved side-effect click WITH a registry-issued token still executes', () => {
      const registry = new HmacApprovalRegistry('test-secret');
      const gate = new SafetyGate(true, registry);
      // @ts-expect-error — no sideEffect, but ClickPolicy blocks; token must clear it.
      const token = registry.issue({ taskId: 't-1', sessionId: 's-1', actionType: 'click' });
      const verdict = gate.assess(
        task(
          { type: 'click', target: '#publish' },
          { approved: true, approvalId: token.approvalId, signature: token.signature },
        ),
      );
      expect(verdict.status).toBe('allowed');
    });
  });
});
