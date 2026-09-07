import { describe, expect, it } from 'vitest';
import { ClickPolicy } from '../../../lib/browser-gateway/application/click-policy.js';
import type { BrowserAction } from '../../../lib/browser-gateway/domain/browser-task.js';

function click(target: string): BrowserAction {
  return { type: 'click', target };
}

describe('ClickPolicy (HIGH-D)', () => {
  it('a raw click on a[href] is unknown (never safe_read)', () => {
    const policy = new ClickPolicy();
    expect(policy.classify(click('a[href="/about"]'))).toBe('unknown');
    expect(policy.classify(click('a[href]'))).toBe('unknown');
  });

  it('a raw click on [role="tab"] is unknown (never safe_read)', () => {
    const policy = new ClickPolicy();
    expect(policy.classify(click('[role="tab"]'))).toBe('unknown');
  });

  it('a raw click on [aria-expanded] is unknown (never safe_read)', () => {
    const policy = new ClickPolicy();
    expect(policy.classify(click('[aria-expanded]'))).toBe('unknown');
  });

  it('a raw click on [data-nav] is unknown (never safe_read)', () => {
    const policy = new ClickPolicy();
    expect(policy.classify(click('[data-nav]'))).toBe('unknown');
  });

  it('a raw click on .pagination / .cancel / #next is unknown (never safe_read)', () => {
    const policy = new ClickPolicy();
    expect(policy.classify(click('.pagination'))).toBe('unknown');
    expect(policy.classify(click('.cancel'))).toBe('unknown');
    expect(policy.classify(click('#next'))).toBe('unknown');
  });

  it('adversarial: a selector that looks safe but maps to a side-effect action is NOT auto-allowed', () => {
    const policy = new ClickPolicy();
    // A hostile page can put role=tab / a[href] on a control that performs an
    // external side effect. The policy must never classify it as safe_read —
    // it must be `side_effect` (irreversible pattern) or `unknown`, both of
    // which require approval. It is NEVER auto-allowed.
    expect(policy.classify(click('a[href="#"][onclick="deleteAccount()"]'))).not.toBe('safe_read');
    expect(policy.classify(click('[role="tab"][data-action="publish"]'))).not.toBe('safe_read');
  });

  it('irreversible patterns are still flagged as side_effect (informational)', () => {
    const policy = new ClickPolicy();
    expect(policy.classify(click('#delete-account'))).toBe('side_effect');
    expect(policy.classify(click('#publish'))).toBe('side_effect');
  });

  it('classify never returns safe_read for any raw click', () => {
    const policy = new ClickPolicy();
    const targets = [
      'a[href="/about"]',
      '[role="tab"]',
      '[aria-expanded]',
      '[data-nav]',
      '.pagination',
      '.cancel',
      '#next',
      '#nav-home',
      '.accordion',
      '.collapse',
      '.expand',
      '.close-modal',
      '.dismiss',
      '.back',
      '#btn-482',
    ];
    for (const t of targets) {
      expect(policy.classify(click(t)), `.classify(${t})`).not.toBe('safe_read');
    }
  });
});
