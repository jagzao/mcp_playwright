import { describe, expect, it } from 'vitest';
import { SafetyGate } from '../../../lib/browser-gateway/application/safety-gate.js';
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

  it('approval token allows execution', () => {
    const gate = new SafetyGate(true);
    const verdict = gate.assess(
      task({ type: 'submit', target: '#form' }, { approved: true, approvalId: 'a-1' }),
    );
    expect(verdict.status).toBe('allowed');
  });

  it('side-effect gate can be disabled', () => {
    const gate = new SafetyGate(false);
    expect(gate.assess(task({ type: 'submit', target: '#form' })).status).toBe('allowed');
  });
});
