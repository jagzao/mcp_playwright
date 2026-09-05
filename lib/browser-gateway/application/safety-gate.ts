import type { BrowserAction, BrowserTask } from '../domain/browser-task.js';
import type { ApprovalRegistry } from './approval-registry.js';

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

function isExternalSideEffect(
  action: BrowserAction,
  requireApprovalForSideEffects: boolean,
): boolean {
  if (!requireApprovalForSideEffects) return false;
  return SIDE_EFFECT_ACTION_TYPES.has(action.type);
}

export class SafetyGate {
  private readonly approvalRegistry: ApprovalRegistry | undefined;

  constructor(
    private readonly requireApprovalForSideEffects: boolean = true,
    approvalRegistry?: ApprovalRegistry,
  ) {
    this.approvalRegistry = approvalRegistry;
  }

  assess(task: BrowserTask): SafetyVerdict {
    const irreversible = isExternalSideEffect(
      task.action,
      this.requireApprovalForSideEffects,
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
