import { createGateway } from '../../../../lib/browser-gateway/infrastructure/gateway-factory.js';
import { createBrowserHost } from '../../../../lib/browser-gateway/infrastructure/gateway-factory.js';
import { createSessionVault } from '../../../../lib/browser-gateway/infrastructure/gateway-factory.js';
import { restoreAuthenticatedSession } from '../../../../lib/browser-gateway/infrastructure/gateway-factory.js';
import type { BrowserTask } from '../../../../lib/browser-gateway/domain/browser-task.js';
import type { BrowserGatewayResult } from '../../../../lib/browser-gateway/domain/browser-result.js';
import type { SessionVault, SessionProfile } from '../../../../lib/browser-gateway/domain/session-vault.js';
import { ResearchAgent } from '../../../../lib/browser-gateway/application/research-agent.js';
import { SearchProviderRouter } from '../../../../lib/browser-gateway/application/search-provider-router.js';
import { EnvSecretProvider } from '../../../../lib/browser-gateway/infrastructure/secret-provider/env-secret-provider.js';
import { createHttpSearchProvider } from '../../../../lib/browser-gateway/infrastructure/search/http-search-providers.js';
import { FakeSearchProvider } from '../../../../lib/browser-gateway/infrastructure/search/fake-search-provider.js';
import type { ResearchMode, ResearchRequest } from '../../../../lib/browser-gateway/application/research-agent.js';

// Shared research wiring (business logic lives in ResearchAgent — no duplication).
const researchProviders: import('../../../../lib/browser-gateway/application/search-provider-router.js').SearchProvider[] = [];
for (const id of (process.env.SEARCH_PROVIDER_ORDER || 'brave,exa,tavily').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
  const p = createHttpSearchProvider(id, new EnvSecretProvider());
  if (p) researchProviders.push(p);
}
// Offline/CI-safe: a fake provider the router uses as a last-resort candidate.
researchProviders.push(new FakeSearchProvider('fake', { results: [], available: false }));

function buildResearchAgent(mode: ResearchMode, sessionId: string): ResearchAgent {
  return new ResearchAgent({
    searchRouter: new SearchProviderRouter(researchProviders),
    reader: {
      read: async (url) => {
        const res = await gateway.executeTask({ taskId: `research-nav-${Date.now()}`, sessionId, action: { type: 'navigate', url } });
        if (res.status !== 'success') return { status: res.status === 'blocked' ? 'blocked' : 'unavailable', reason: res.reason };
        const ex = await gateway.executeTask({ taskId: `research-extract-${Date.now()}`, sessionId, action: { type: 'extract', selector: 'body' } });
        if (ex.status !== 'success') return { status: 'unavailable', reason: 'extract_failed' };
        const payload = (ex.data as { text?: string }) ?? {};
        return { status: 'success', page: { url, title: '', text: payload.text ?? '', headings: [], fetchedAt: new Date().toISOString() } };
      },
    },
    secretProvider: new EnvSecretProvider(),
  });
}

function researchRequestArgs(args: Record<string, unknown>): ResearchRequest {
  const mode = (args.mode as ResearchMode) ?? 'standard';
  return {
    question: String(args.question ?? ''),
    mode,
    sessionId: String(args.sessionId ?? 'default'),
    budget: clampBudget(args.budget as ResearchRequest['budget'] | undefined, mode),
    primaryDomains: args.primaryDomains as string[] | undefined,
    highCoIDomains: args.highCoIDomains as string[] | undefined,
  };
}

/**
 * Clamp caller-supplied budget overrides to trusted ceilings (AC15 / MEDIUM-6).
 *
 * A hostile caller must not be able to inflate the budget (e.g.
 * `maxSearchRequests: 1e9`) to bypass cost controls. Each override is clamped
 * to the mode's default envelope so a caller can only *reduce* a dimension,
 * never raise it above the trusted default.
 */
function clampBudget(
  budget: ResearchRequest['budget'] | undefined,
  mode: ResearchMode,
): ResearchRequest['budget'] {
  if (!budget) return undefined;
  const ceiling = defaultBudgetForMode(mode);
  const clamp = (v: number | undefined, max: number): number | undefined =>
    v === undefined ? undefined : Math.max(0, Math.min(Math.floor(v), max));
  return {
    maxSearchRequests: clamp(budget.maxSearchRequests, ceiling.maxSearchRequests),
    maxPagesRead: clamp(budget.maxPagesRead, ceiling.maxPagesRead),
    maxModelCalls: clamp(budget.maxModelCalls, ceiling.maxModelCalls),
    maxScreenshots: clamp(budget.maxScreenshots, ceiling.maxScreenshots),
    maxCostUsd:
      budget.maxCostUsd === undefined
        ? undefined
        : Math.max(0, Math.min(budget.maxCostUsd, ceiling.maxCostUsd)),
  };
}

function defaultBudgetForMode(mode: ResearchMode): {
  maxSearchRequests: number;
  maxPagesRead: number;
  maxModelCalls: number;
  maxScreenshots: number;
  maxCostUsd: number;
} {
  switch (mode) {
    case 'quick':
      return { maxSearchRequests: 2, maxPagesRead: 3, maxModelCalls: 4, maxScreenshots: 0, maxCostUsd: 0.5 };
    case 'deep':
      return { maxSearchRequests: 30, maxPagesRead: 40, maxModelCalls: 20, maxScreenshots: 3, maxCostUsd: 2.0 };
    default:
      return { maxSearchRequests: 8, maxPagesRead: 12, maxModelCalls: 14, maxScreenshots: 1, maxCostUsd: 1.0 };
  }
}

/**
 * MCP tools exposing the Browser Gateway through the existing MCP surface.
 * These are thin transport adapters — all business logic lives in the
 * `BrowserGateway` facade, the persistent `BrowserHost`, and the `SessionVault`
 * (no duplication).
 */

const gateway = createGateway();
const host = createBrowserHost();
const vault: SessionVault | undefined = createSessionVault();

let pendingSessionId = 'default';

function resultToText(result: BrowserGatewayResult): string {
  if (result.status === 'success') {
    return JSON.stringify({ status: 'success', data: result.data });
  }
  if (result.status === 'blocked') {
    // Include pendingId so a programmatic caller can correlate its blocked
    // request to the pending approval the operator must approve (BLOCKER-E).
    return JSON.stringify({
      status: 'blocked',
      category: result.category,
      reason: result.reason,
      ...(result.pendingId ? { pendingId: result.pendingId } : {}),
    });
  }
  return JSON.stringify({ status: 'manual_escalation_required', reason: result.reason });
}

export const gatewayTools: any[] = [
  {
    name: 'gateway_create_session',
    description: 'Create (or fetch) an isolated browser gateway session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session identifier (must not contain secrets)' },
      },
      required: ['sessionId'],
    },
    async execute(args: any) {
      pendingSessionId = args.sessionId;
      gateway.createSession(args.sessionId);
      return { success: true, sessionId: args.sessionId, status: gateway.getSessionStatus(args.sessionId)?.status };
    },
  },

  {
    name: 'gateway_health',
    description: 'Report gateway and engine health/capabilities',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const health = await gateway.health();
      return { success: true, health, capabilities: gateway.capabilities() };
    },
  },

  {
    name: 'gateway_execute',
    description: 'Execute a browser task through the gateway (Obscura first, Playwright fallback, safety+SSRF enforced)',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'object',
          description: 'BrowserTask: { taskId, sessionId, action, approval?, metadata? }',
        },
      },
      required: ['task'],
    },
    async execute(args: any) {
      const task = args.task as BrowserTask;
      const result = await gateway.executeTask(task);
      return { success: true, text: resultToText(result) };
    },
  },

  {
    name: 'gateway_close_session',
    description: 'Close an isolated browser gateway session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
      },
      required: ['sessionId'],
    },
    async execute(args: any) {
      await gateway.closeSession(args.sessionId);
      return { success: true, sessionId: args.sessionId };
    },
  },

  // --- Persistent BrowserHost / human-in-the-loop lifecycle -----------------

  {
    name: 'gateway_host_create_session',
    description: 'Create a persistent BrowserHost session (browser stays open across turns)',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        headed: { type: 'boolean', description: 'Launch a visible browser' },
      },
      required: ['sessionId'],
    },
    async execute(args: any) {
      const session = await host.createSession(args.sessionId, { headed: args.headed });
      return { success: true, sessionId: session.sessionId, status: session.status };
    },
  },

  {
    name: 'gateway_suspend_for_user',
    description: 'Suspend a session for a human (login/MFA/CAPTCHA). Browser stays open; returns a resumable checkpoint',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        reason: { type: 'string', description: 'Why the human must intervene' },
        activityId: { type: 'string', description: 'Optional logical activity id' },
        safeInstructions: { type: 'string', description: 'Optional safe instructions for the human' },
      },
      required: ['sessionId', 'reason'],
    },
    async execute(args: any) {
      const result = await host.suspendForUser(args.sessionId, args.reason, {
        activityId: args.activityId,
        safeInstructions: args.safeInstructions,
      });
      if (!result.ok) return { success: false, reason: result.reason };
      return {
        success: true,
        status: result.status,
        checkpointId: result.checkpoint.checkpointId,
        activityId: result.checkpoint.activityId,
        url: result.checkpoint.url,
      };
    },
  },

  {
    name: 'gateway_resume',
    description: 'Resume a suspended session from its checkpoint (same live tab, no task restatement)',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        checkpointId: { type: 'string' },
      },
      required: ['sessionId', 'checkpointId'],
    },
    async execute(args: any) {
      const result = await host.resumeSession(args.sessionId, args.checkpointId);
      if (!result.ok) return { success: false, reason: result.reason };
      return { success: true, status: result.status, recovery: result.recovery, url: result.url };
    },
  },

  {
    name: 'gateway_resume_activity',
    description:
      'Deterministically resume the waiting task whose checkpoint activityId matches. Resolves ONLY the matching waiting session (AC9/AC23) — no internal ids needed',
    inputSchema: {
      type: 'object',
      properties: {
        activityId: { type: 'string', description: 'Logical activity id captured when the session was suspended' },
      },
      required: ['activityId'],
    },
    async execute(args: any) {
      const result = await host.resolveWaitingTask(args.activityId);
      if (!result.ok) return { success: false, reason: result.reason };
      return { success: true, status: result.status, recovery: result.recovery, url: result.url };
    },
  },

  {
    name: 'gateway_list_waiting',
    description: 'List sessions currently waiting for a human',
    inputSchema: { type: 'object', properties: {} },
    async execute() {
      const waiting = host.listWaitingSessions().map((s) => ({
        sessionId: s.sessionId,
        status: s.status,
        checkpointId: s.checkpoint?.checkpointId,
        activityId: s.checkpoint?.activityId,
        reason: s.checkpoint?.reason,
        url: s.checkpoint?.url,
      }));
      return { success: true, waiting };
    },
  },

  {
    name: 'gateway_session_status',
    description: 'Report the status of a BrowserHost session',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
    async execute(args: any) {
      const session = host.getSession(args.sessionId);
      if (!session) return { success: false, reason: 'session not found' };
      return {
        success: true,
        sessionId: session.sessionId,
        status: session.status,
        engine: session.engine,
        headed: session.headed,
        recovery: session.recovery,
        checkpointId: session.checkpoint?.checkpointId,
      };
    },
  },

  {
    name: 'gateway_host_close_session',
    description: 'Explicitly close a persistent BrowserHost session (always wins)',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
    async execute(args: any) {
      const result = await host.closeSession(args.sessionId);
      if (!result.ok) return { success: false, reason: result.reason };
      return { success: true, sessionId: args.sessionId };
    },
  },

  // --- SessionVault / durable authenticated sessions (US-002) ----------------

  {
    name: 'gateway_session_register_profile',
    description: 'Register a SessionProfile (allowed domains, permissions, approval policy)',
    inputSchema: {
      type: 'object',
      properties: {
        profile: {
          type: 'object',
          description: 'SessionProfile: { profileId, allowedDomains, permissions?, interactiveLoginPreferred?, maxAgeMs? }',
        },
      },
      required: ['profile'],
    },
    async execute(args: any) {
      if (!vault) return { success: false, reason: 'SessionVault unavailable (MASTER_KEY not configured)' };
      const profile = args.profile as SessionProfile;
      vault.registerProfile(profile);
      return { success: true, profileId: profile.profileId };
    },
  },

  {
    name: 'gateway_session_bootstrap',
    description: 'Bootstrap a durable authenticated session for a profile/engine. Returns a typed outcome (healthy | bootstrap_required | user_interaction_required)',
    inputSchema: {
      type: 'object',
      properties: {
        profileId: { type: 'string' },
        engine: { type: 'string', enum: ['playwright', 'obscura'] },
      },
      required: ['profileId', 'engine'],
    },
    async execute(args: any) {
      if (!vault) return { success: false, reason: 'SessionVault unavailable (MASTER_KEY not configured)' };
      const result = await vault.bootstrap(args.profileId, args.engine);
      return { success: true, outcome: result.outcome, ...(result as any) };
    },
  },

  {
    name: 'gateway_session_validate',
    description: 'Validate a persisted session. Returns a typed outcome (healthy | reauthentication_required | bootstrap_required | revoked)',
    inputSchema: {
      type: 'object',
      properties: {
        profileId: { type: 'string' },
        engine: { type: 'string', enum: ['playwright', 'obscura'] },
      },
      required: ['profileId', 'engine'],
    },
    async execute(args: any) {
      if (!vault) return { success: false, reason: 'SessionVault unavailable (MASTER_KEY not configured)' };
      const result = await vault.validate(args.profileId, args.engine);
      return { success: true, outcome: result.outcome, status: result.status, reason: result.reason };
    },
  },

  {
    name: 'gateway_session_revoke',
    description: 'Revoke a persisted session, making it unusable',
    inputSchema: {
      type: 'object',
      properties: {
        profileId: { type: 'string' },
        engine: { type: 'string', enum: ['playwright', 'obscura'] },
      },
      required: ['profileId', 'engine'],
    },
    async execute(args: any) {
      if (!vault) return { success: false, reason: 'SessionVault unavailable (MASTER_KEY not configured)' };
      const result = await vault.revoke(args.profileId, args.engine);
      return { success: result.ok, reason: result.ok ? undefined : result.reason };
    },
  },

  {
    name: 'gateway_vault_status',
    description: 'Report safe SessionVault metadata (status, domains, timestamps, artifactRef) for a persisted session. Never returns raw auth state',
    inputSchema: {
      type: 'object',
      properties: {
        profileId: { type: 'string' },
        engine: { type: 'string', enum: ['playwright', 'obscura'] },
      },
      required: ['profileId', 'engine'],
    },
    async execute(args: any) {
      if (!vault) return { success: false, reason: 'SessionVault unavailable (MASTER_KEY not configured)' };
      const metadata = await vault.getStatus(args.profileId, args.engine);
      if (!metadata) return { success: false, reason: 'no persisted session' };
      return { success: true, metadata };
    },
  },

  {
    name: 'gateway_session_restore',
    description:
      'Restore an authenticated session for a profileId from the vault artifact into a NEW Playwright runtime. Returns ONLY the typed outcome + safe metadata (never raw cookies). If the outcome is bootstrap_required / reauthentication_required / user_interaction_required, trigger the WAITING_FOR_USER headed login flow via gateway_session_bootstrap',
    inputSchema: {
      type: 'object',
      properties: {
        profileId: { type: 'string', description: 'Registered profileId to restore' },
        engine: { type: 'string', enum: ['playwright', 'obscura'], default: 'playwright' },
        headed: { type: 'boolean', description: 'Launch a visible browser' },
      },
      required: ['profileId'],
    },
    async execute(args: any) {
      const result = await restoreAuthenticatedSession(args.profileId, {
        engine: args.engine ?? 'playwright',
        headed: args.headed,
      });
      if (result.outcome === 'healthy') {
        return {
          success: true,
          outcome: result.outcome,
          sessionId: result.sessionId,
          profileId: result.profileId,
          engine: result.engine,
          domains: result.domains,
          artifactRef: result.artifactRef,
        };
      }
      const message =
        result.outcome === 'bootstrap_required' || result.outcome === 'reauthentication_required' || result.outcome === 'user_interaction_required'
          ? `Run gateway_session_bootstrap (profileId=${args.profileId}) to trigger the WAITING_FOR_USER headed login flow.`
          : undefined;
      return {
        success: false,
        outcome: result.outcome,
        reason: result.reason,
        ...(message ? { message } : {}),
      };
    },
  },

  // --- Deep Research quick/standard/deep (US-003) -----------------------------

  {
    name: 'gateway_research',
    description: 'Run quick/standard/deep web research through SearchProviderRouter + Browser Gateway + Evidence Ledger. Bounded budgets enforced deterministically',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The research question' },
        mode: { type: 'string', enum: ['quick', 'standard', 'deep'], default: 'standard' },
        sessionId: { type: 'string' },
        budget: {
          type: 'object',
          description: 'Optional budget overrides (maxSearchRequests, maxPagesRead, maxModelCalls, maxScreenshots, maxCostUsd)',
        },
        primaryDomains: { type: 'array', items: { type: 'string' }, description: 'Domains treated as primary authority' },
        highCoIDomains: { type: 'array', items: { type: 'string' }, description: 'Domains treated as high conflict-of-interest' },
      },
      required: ['question', 'mode'],
    },
    async execute(args: any) {
      const request = researchRequestArgs(args);
      const agent = buildResearchAgent(request.mode, request.sessionId);
      const outcome = await agent.run(request);
      return { success: true, ...outcome };
    },
  },
];
