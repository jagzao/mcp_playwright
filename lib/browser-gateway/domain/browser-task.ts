export type BrowserAction =
  | { type: 'navigate'; url: string }
  | { type: 'snapshot' }
  | { type: 'click'; target: string }
  | { type: 'fill'; target: string; value: string }
  | { type: 'extract'; selector?: string; schema?: Record<string, unknown> }
  | { type: 'screenshot'; fullPage?: boolean }
  // Explicit external side-effect actions. These always require approval.
  | { type: 'submit'; target?: string }
  | { type: 'send'; target?: string }
  | { type: 'publish'; target?: string };

export interface BrowserTask {
  taskId: string;
  sessionId: string;
  action: BrowserAction;
  approval?: {
    approved: boolean;
    approvalId?: string;
    /** Opaque signature issued by the ApprovalRegistry (AC19). */
    signature?: string;
  };
  metadata?: Record<string, string>;
}
