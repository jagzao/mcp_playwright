import { Page } from 'playwright';
import { SessionManager } from '../../../../lib/session/session-manager.js';
import { config } from '../../../../lib/config/index.js';

let currentPage: Page | null = null;
let sessionManager: SessionManager | null = null;

export function setCurrentPage(page: Page) {
  currentPage = page;
}

export function initSessionManager(masterKey: string) {
  sessionManager = new SessionManager(masterKey);
}

export const sessionTools: any[] = [
  {
    name: 'session_save',
    description: 'Save current browser session (cookies and localStorage) for later use',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for this session (e.g., "linkedin-logged-in")',
        },
      },
      required: ['name'],
    },
    async execute(args: any) {
      if (!currentPage) {
        throw new Error('No page available. Navigate to a page first.');
      }

      if (!sessionManager) {
        const masterKey = config.security.masterKey || process.env.MASTER_KEY;
        if (!masterKey) {
          throw new Error('MASTER_KEY not configured. Cannot save sessions securely.');
        }
        initSessionManager(masterKey);
      }

      await sessionManager!.saveSession(currentPage, args.name);

      return {
        success: true,
        message: `Session "${args.name}" saved successfully`,
        sessionName: args.name,
      };
    },
  },

  {
    name: 'session_restore',
    description: 'Restore a previously saved browser session',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the session to restore',
        },
      },
      required: ['name'],
    },
    async execute(args: any) {
      if (!currentPage) {
        throw new Error('No page available. Navigate to a page first.');
      }

      if (!sessionManager) {
        const masterKey = config.security.masterKey || process.env.MASTER_KEY;
        if (!masterKey) {
          throw new Error('MASTER_KEY not configured. Cannot restore sessions.');
        }
        initSessionManager(masterKey);
      }

      const restored = await sessionManager!.restoreSession(currentPage, args.name);

      return {
        success: restored,
        message: restored
          ? `Session "${args.name}" restored successfully`
          : `Session "${args.name}" not found or expired`,
        sessionName: args.name,
      };
    },
  },

  {
    name: 'session_list',
    description: 'List all saved sessions',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    async execute() {
      if (!sessionManager) {
        const masterKey = config.security.masterKey || process.env.MASTER_KEY;
        if (!masterKey) {
          throw new Error('MASTER_KEY not configured.');
        }
        initSessionManager(masterKey);
      }

      const sessions = sessionManager!.listSessions();

      return {
        success: true,
        sessions,
        count: sessions.length,
      };
    },
  },

  {
    name: 'session_delete',
    description: 'Delete a saved session',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the session to delete',
        },
      },
      required: ['name'],
    },
    async execute(args: any) {
      if (!sessionManager) {
        const masterKey = config.security.masterKey || process.env.MASTER_KEY;
        if (!masterKey) {
          throw new Error('MASTER_KEY not configured.');
        }
        initSessionManager(masterKey);
      }

      const deleted = sessionManager!.deleteSession(args.name);

      return {
        success: deleted,
        message: deleted
          ? `Session "${args.name}" deleted successfully`
          : `Session "${args.name}" not found`,
        sessionName: args.name,
      };
    },
  },
];
