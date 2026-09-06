import type { BrowserAction } from '../domain/browser-task.js';

/**
 * Trusted click classification policy (HIGH-B / HIGH-C / AC19 / AC16).
 *
 * The raw `click` `sideEffect` flag arrives from an untrusted caller. Treating
 * its *absence* (or a caller-supplied `'read'`) as a trusted read-only verdict
 * lets a hostile/mistaken agent downgrade a potentially irreversible click
 * (publish / buy / send / delete / submit) to auto-allow. This policy is the
 * trusted authority for classifying a click: it inspects the actual target /
 * selector and classifies it REGARDLESS of what the caller claimed. A caller
 * can never downgrade a matched side-effect click by omitting or rewriting
 * `sideEffect`.
 *
 * The classification is FAIL-CLOSED (HIGH-C): a click is auto-allowed ONLY
 * when the target positively matches an explicit safe / reversible class
 * (link/navigation, tab, expand/collapse, pagination, dismiss/back/cancel).
 * Everything else — opaque selectors (`#btn-482`), `[data-testid]`, generic
 * buttons, `nth-child`, localized UI — is `unknown` and requires approval. The
 * trusted layer never returns `safe_read` merely because a dangerous keyword
 * is absent.
 */
const SIDE_EFFECT_SELECTOR_PATTERNS = [
  /\b(publish|post|submit|send|buy|purchase|order|checkout|pay|payment)\b/i,
  /\b(delete|remove|destroy)\b/i,
  /\b(deploy|donate|transfer|withdraw)\b/i,
];

/**
 * Explicitly safe / reversible click classes. A click is auto-allowed ONLY when
 * its target positively matches one of these. This is the closed allow-list
 * that keeps the ergonomic machine-driving path (links, tabs, pagination,
 * expand/collapse, dismiss/back/cancel) while failing closed on anything else.
 */
const SAFE_READ_SELECTOR_PATTERNS = [
  // Link / navigation selectors.
  /^a\[href/, // a[href="..."] — a real hyperlink.
  /\[role="tab"\]/, // Tab control.
  /\[aria-expanded\]/, // Expandable disclosure control.
  /\[data-nav\]/, // Explicit navigation marker.
  /\.pagination/, // Pagination widget.
  /#next\b/, // Next-page control.
  /#nav-home\b/, // Home navigation.
  // Expand / collapse / disclosure.
  /\.accordion/,
  /\.collapse/,
  /\.expand/,
  /#expand\b/,
  // Dismiss / back / cancel — reversible UI controls.
  /\.close-modal/,
  /\.dismiss/,
  /\.back\b/,
  /\.cancel\b/,
];

export type ClickClassification = 'safe_read' | 'side_effect' | 'unknown';

export class ClickPolicy {
  /**
   * Trusted classification of a click by its target/selector. Only the server
   * -side selector heuristics may classify a click; caller metadata is never
   * consulted here (the SafetyGate merges caller intent on top).
   *
   * Returns:
   *  - `'side_effect'` when the target matches an irreversible pattern;
   *  - `'safe_read'` ONLY when the target matches an explicit safe/navigation
   *    class;
   *  - `'unknown'` for everything else (opaque selectors, generic buttons,
   *    data-testid, nth-child, localized UI).
   */
  classify(action: BrowserAction): ClickClassification {
    const target = action.type === 'click' ? action.target : '';
    // Irreversible patterns win (fail-closed priority over any safe match).
    for (const pattern of SIDE_EFFECT_SELECTOR_PATTERNS) {
      if (pattern.test(target)) return 'side_effect';
    }
    for (const pattern of SAFE_READ_SELECTOR_PATTERNS) {
      if (pattern.test(target)) return 'safe_read';
    }
    return 'unknown';
  }
}
