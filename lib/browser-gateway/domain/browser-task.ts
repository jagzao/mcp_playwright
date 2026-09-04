export type BrowserAction =
  | { type: 'navigate'; url: string }
  | { type: 'snapshot' }
  | { type: 'click'; target: string }
  | { type: 'fill'; target: string; value: string }
  | { type: 'extract'; selector?: string; schema?: Record<string, unknown> }
  | { type: 'screenshot'; fullPage?: boolean };

export interface BrowserTask {
  taskId: string;
  sessionId: string;
  action: BrowserAction;
  approval?: {
    approved: boolean;
    approvalId?: string;
  };
  metadata?: Record<string, string>;
}
