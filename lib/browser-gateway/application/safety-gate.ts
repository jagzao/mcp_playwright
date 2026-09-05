import type { BrowserAction, BrowserTask } from '../domain/browser-task.js';
import type { ApprovalRegistry } from './approval-registry.js';
import { ClickPolicy } from './click-policy.js';

/**
 * Safety / approval gate — engine independent.
 *
 * Classifies browser actions into read-only/reversible (auto-execute) vs
 * external side-effect (approval required). A security/approval decision here
 * can never be bypassed by switching engines, because this gate runs at the
 * application layer, before any engine is selected.
 *
 * External side-effect actions have an irreversible real-world effect:
 * submitting a form that transmits data, sending a message, publishing
 * content, or a purchase/destructive change. Such actions require an explicit
 * approval token issued by a trusted authority (AC19/AC16). A bare
 * `task.approval.approved === true` supplied by the untrusted caller is NEVER
 * accepted — the token must be verified against the ApprovalRegistry.
 */

// Action types that are pure read-only / reversible observations.
const READ_ONLY_ACTION_TYPES = new Set([
  'navigate',
  'snapshot',
  'extract',
  'screenshot',
]);

/**
 * Explicitly irreversible side-effect action types. These always require
 * approval when the side-effect gate is enabled.
 */
const SIDE_EFFECT_ACTION_TYPES = new Set(['submit', 'send', 'publish']);

export type SafetyVerdict =
  | { status: 'allowed'; reason: string }
  | { status: 'approval_required'; reason: string };

/**
 * True when the action has an irreversible external side effect.
 *
 * A `click` is normally read-only/reversible, but a real click can submit a
 * form, publish, buy, delete, or execute an irreversible admin action. HIGH-B:
 * the caller-supplied `sideEffect` flag is NOT trusted as the sole classifier a
 * hostile/mistaken agent can omit or rewrite to downgrade an irreversible click.
 *
 * The trusted `ClickPolicy` inspects the actual target/selector and classifies
 * irreversible side-effect patterns as such REGARDLESS of the caller flag. A
 * click is auto-allowed ONLY when the trusted policy says the target is
 * reversible (plain/navigation click). If either the trusted policy OR the
 * caller's explicit flag marks the click as a side effect, it requires
 * approval — a caller can never downgrade a matched side-effect click.
 */
function isExternalSideEffect(
  action: BrowserAction,
  requireApprovalForSideEffects: boolean,
  clickPolicy: ClickPolicy,
): boolean {
  if (!requireApprovalForSideEffects) return false;
  if (SIDE_EFFECT_ACTION_TYPES.has(action.type)) return true;
  if (action.type === 'click') {
    // Trusted server-side classification wins over any caller claim.
    const trusted = clickPolicy.classify(action);
    const callerEffect = action.sideEffect ?? 'read';
    return (
      trusted === 'side_effect' ||
      callerEffect === 'side_effect' ||
      callerEffect === true
    );
  }
  // A bare plain click on a reversible target is auto-allowed (see the
  // click branch above, which the ClickPolicy already cleared).
  return false;
}

export class SafetyGate {
  private readonly approvalRegistry: ApprovalRegistry | undefined;
  private readonly clickPolicy: ClickPolicy;

  constructor(
    private readonly requireApprovalForSideEffects: boolean = true,
    approvalRegistry?: ApprovalRegistry,
    clickPolicy?: ClickPolicy,
  ) {
    this.approvalRegistry = approvalRegistry;
    this.clickPolicy = clickPolicy ?? new ClickPolicy();
  }

  assess(task: BrowserTask): SafetyVerdict {
    const irreversible = isExternalSideEffect(
      task.action,
      this.requireApprovalForSideEffects,
      this.clickPolicy,
    );

    if (!irreversible) {
      return {
        status: 'allowed',
        reason: `${task.action.type} is read-only/reversible and may auto-execute`,
      };
    }

    // A caller-supplied `approved: true` is NOT trusted. Only a token issued
    // by the ApprovalRegistry for this exact task/action authorizes execution.
    if (this.approvalRegistry && task.approval?.approvalId && task.approval.signature) {
      const ok = this.approvalRegistry.verify(
        { approvalId: task.approval.approvalId, signature: task.approval.signature },
        {
          taskId: task.taskId,
          sessionId: task.sessionId,
          actionType: task.action.type,
        },
      );
      if (ok) {
        return {
          status: 'allowed',
          reason: `${task.action.type} is a side-effect action with a verified approval token`,
        };
      }
    }

    return {
      status: 'approval_required',
      reason: `${task.action.type} is an external side-effect action and requires a registry-issued approval token`,
    };
  }
}

export { READ_ONLY_ACTION_TYPES };
