import type { BrowserAction, BrowserTask } from '../domain/browser-task.js';

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
 * approval token (`task.approval.approved === true`).
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
  constructor(
    private readonly requireApprovalForSideEffects: boolean = true,
  ) {}

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

    if (task.approval?.approved === true) {
      return {
        status: 'allowed',
        reason: `${task.action.type} is a side-effect action with an explicit approval token`,
      };
    }

    return {
      status: 'approval_required',
      reason: `${task.action.type} is an external side-effect action and requires explicit approval`,
    };
  }
}

export { READ_ONLY_ACTION_TYPES };
