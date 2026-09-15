export type BrowserAction =
  | { type: 'navigate'; url: string }
  | {
      type: 'follow_link';
      href: string;
      /**
       * Resolves a link's destination and navigates WITHOUT firing the element's
       * onclick JS. Read-only/reversible (auto-allowed, like `navigate`). The
       * engine implements it by navigating to the resolved href directly
       * (page.goto), NOT by clicking the element. This is the trusted way to
       * follow a link without trusting the page's onclick handler.
       */
    }
  | { type: 'snapshot' }
  | {
      type: 'click';
      target: string;
      /**
       * Side-effect classification for a click. HIGH-D: a raw `click` is ALWAYS
       * approval-required regardless of this flag — the target/selector string
       * is caller/page-controlled and cannot be trusted to auto-authorize a side
       * effect. This flag is retained only for informational/audit purposes; it
       * can never downgrade a click to auto-allow. For safe, reversible
       * navigation use the dedicated `follow_link` action instead.
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
