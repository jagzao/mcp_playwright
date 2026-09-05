export type BrowserAction =
  | { type: 'navigate'; url: string }
  | { type: 'snapshot' }
  | {
      type: 'click';
      target: string;
      /**
       * Side-effect classification for a click. A real `click` can submit a
       * form, publish, buy, or run an irreversible admin action. Defaults to
       * `read` (a plain/navigation click is auto-allowed). Set to `'side_effect'`
       * (or `sideEffect: true`) when the click has an irreversible external
       * effect, in which case it requires the same approval as submit/send/
       * publish. This binds the side-effect semantics to the actually-
       * executable action (the engine runs `click`), closing the bypass where
       * the real web action went through `click` while the protected types
       * never reached the engine.
       */
      sideEffect?: boolean | 'read' | 'side_effect';
    }
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
