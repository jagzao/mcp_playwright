import type { BrowserAction } from '../domain/browser-task.js';

/**
 * Trusted click classification policy (HIGH-B / HIGH-C / HIGH-D / AC19 / AC16).
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
 * HIGH-D: a raw `click` is ALWAYS `unknown` (approval-required). The previous
 * `SAFE_READ_SELECTOR_PATTERNS` allow-list trusted the `target` string, which
 * comes from the caller and describes elements/attributes controlled by an
 * untrusted page. A hostile page can put `role=tab`, `aria-expanded`,
 * `data-nav`, or `a[href]` on a control that performs an external side effect
 * (e.g. `<a href="#" onclick="deleteAccount()">`), letting page/caller content
 * expand permissions and auto-authorize side effects. Because the target string
 * is not a trustworthy signal, NO selector/attribute/metadata may auto-allow a
 * raw click. The trusted, reversible navigation path is the dedicated
 * `follow_link` action (which resolves a link's href and navigates WITHOUT
 * firing the element's onclick JS), not a raw `click`.
 *
 * The classification is FAIL-CLOSED (HIGH-C): a click is auto-allowed ONLY when
 * the target positively matches an explicit safe / reversible class. Since the
 * safe allow-list is removed, `classify` never returns `safe_read` for a raw
 * click. It returns `side_effect` for irreversible patterns (informational /
 * redundant — `unknown` also requires approval) and `unknown` for everything
 * else.
 */
const SIDE_EFFECT_SELECTOR_PATTERNS = [
  /\b(publish|post|submit|send|buy|purchase|order|checkout|pay|payment)\b/i,
  /\b(delete|remove|destroy)\b/i,
  /\b(deploy|donate|transfer|withdraw)\b/i,
];

export type ClickClassification = 'safe_read' | 'side_effect' | 'unknown';

export class ClickPolicy {
  /**
   * Trusted classification of a click by its target/selector. Only the server
   * -side selector heuristics may classify a click; caller metadata is never
   * consulted here (the SafetyGate merges caller intent on top).
   *
   * Returns:
   *  - `'side_effect'` when the target matches an irreversible pattern
   *    (informational — still requires approval);
   *  - `'unknown'` for EVERYTHING else, including previously "safe" selectors
   *    (`a[href]`, `[role="tab"]`, `[aria-expanded]`, `[data-nav]`,
   *    `.pagination`, `.cancel`, etc.). A raw click is NEVER `safe_read`
   *    (HIGH-D): the target string is caller/page-controlled and cannot be
   *    trusted to auto-authorize a side effect.
   */
  classify(action: BrowserAction): ClickClassification {
    const target = action.type === 'click' ? action.target : '';
    // Irreversible patterns are flagged (informational). They still require
    // approval because `unknown` also requires approval.
    for (const pattern of SIDE_EFFECT_SELECTOR_PATTERNS) {
      if (pattern.test(target)) return 'side_effect';
    }
    // HIGH-D: no selector/attribute/metadata may auto-allow a raw click.
    return 'unknown';
  }
}
