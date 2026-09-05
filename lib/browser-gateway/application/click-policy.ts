import type { BrowserAction } from '../domain/browser-task.js';

/**
 * Trusted click classification policy (HIGH-B / AC19 / AC16).
 *
 * The raw `click` `sideEffect` flag arrives from an untrusted caller. Treating
 * its *absence* (or a caller-supplied `'read'`) as a trusted read-only verdict
 * lets a hostile/mistaken agent downgrade a potentially irreversible click
 * (publish / buy / send / delete / submit) to auto-allow. This policy is the
 * trusted authority for classifying a click: it inspects the actual target /
 * selector and classifies irreversible side-effect patterns as such
 * REGARDLESS of what the caller claimed. A caller can never downgrade a
 * matched side-effect click by omitting or rewriting `sideEffect`.
 *
 * Truly reversible / navigation clicks (links, next-page, plain buttons that
 * do not match an irreversible pattern) remain auto-allowed, preserving the
 * ergonomic machine-driving path.
 */
const SIDE_EFFECT_SELECTOR_PATTERNS = [
  /\b(publish|post|submit|send|buy|purchase|order|checkout|pay|payment)\b/i,
  /\b(delete|remove|destroy)\b/i,
  /\b(deploy|donate|transfer|withdraw)\b/i,
];

export type ClickClassification = 'read' | 'side_effect';

export class ClickPolicy {
  /**
   * Trusted classification of a click by its target/selector. Only the server
   * -side selector heuristics may downgrade a click to `read`; caller metadata
   * is never consulted here (the SafetyGate merges caller intent on top).
   */
  classify(action: BrowserAction): ClickClassification {
    const target = action.type === 'click' ? action.target : '';
    for (const pattern of SIDE_EFFECT_SELECTOR_PATTERNS) {
      if (pattern.test(target)) return 'side_effect';
    }
    return 'read';
  }
}
