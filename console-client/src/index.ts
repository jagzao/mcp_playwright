#!/usr/bin/env node

import { Command } from 'commander';
import { AgentMode } from './modes/agent-mode.js';
import { RecordMode } from './modes/record-mode.js';
import { ReplayMode } from './modes/replay-mode.js';
import { validateConfig } from '../../lib/config/index.js';
import { logger } from '../../lib/observability/logger.js';
import { createBrowserHost } from '../../lib/browser-gateway/infrastructure/gateway-factory.js';
import { createSessionVault } from '../../lib/browser-gateway/infrastructure/gateway-factory.js';
import { createApprovalRegistry } from '../../lib/browser-gateway/infrastructure/gateway-factory.js';
import { createSessionRestoreAuth } from '../../lib/browser-gateway/infrastructure/gateway-factory.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('mcp-playwright')
  .description('MCP Playwright Automation - Autonomous web automation with local LLMs')
  .version('1.0.0');

// Agent mode
program
  .command('agent <instruction>')
  .description('Execute a task using the autonomous agent')
  .option('--data <path>', 'Path to data file (Excel, TXT, MD)')
  .option('--session <name>', 'Use saved session')
  .option('--max-steps <number>', 'Maximum steps to execute', '50')
  .action(async (instruction, options) => {
    try {
      validateConfig();

      const agentMode = new AgentMode();
      await agentMode.execute(instruction, options);

      process.exit(0);
    } catch (error: any) {
      logger.error('Agent mode failed', { error: error.message });
      console.error(chalk.red('\nError:'), error.message);
      process.exit(1);
    }
  });

// Record mode
program
  .command('record <url>')
  .description('Record a workflow by performing actions manually')
  .option('--name <name>', 'Name for the recording')
  .action(async (url, options) => {
    try {
      const recordMode = new RecordMode();
      await recordMode.execute(url, options);

      process.exit(0);
    } catch (error: any) {
      logger.error('Record mode failed', { error: error.message });
      console.error(chalk.red('\nError:'), error.message);
      process.exit(1);
    }
  });

// Replay mode
program
  .command('replay <workflow>')
  .description('Replay a recorded workflow')
  .option('--data <path>', 'Path to data file')
  .option('--headed', 'Run in headed mode (show browser)')
  .option('--debug', 'Run in debug mode')
  .action(async (workflow, options) => {
    try {
      const replayMode = new ReplayMode();
      await replayMode.execute(workflow, options);

      process.exit(0);
    } catch (error: any) {
      logger.error('Replay mode failed', { error: error.message });
      console.error(chalk.red('\nError:'), error.message);
      process.exit(1);
    }
  });

// Console mode (interactive)
program
  .command('console')
  .description('Start interactive console')
  .action(() => {
    console.log(chalk.blue('\n🎮 Interactive Console\n'));
    console.log(chalk.yellow('This feature is coming soon!\n'));
    console.log(chalk.gray('For now, use:'));
    console.log(chalk.gray('  npm run agent "your instruction"'));
    console.log(chalk.gray('  npm run record https://example.com'));
    console.log(chalk.gray('  npm run replay path/to/workflow.spec.ts\n'));
  });

// --- Persistent BrowserHost / human-in-the-loop CLI -------------------------

const host = createBrowserHost();
const vault = createSessionVault();

program
  .command('gateway:host-create <sessionId>')
  .description('Create a persistent BrowserHost session (browser stays open across turns)')
  .option('--headed', 'Launch a visible browser')
  .action(async (sessionId, options) => {
    try {
      const session = await host.createSession(sessionId, { headed: options.headed });
      console.log(chalk.green('Session created:'), session.sessionId, '->', session.status);
    } catch (error: any) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command('gateway:suspend <sessionId> <reason>')
  .description('Suspend a session for a human (login/MFA/CAPTCHA). Browser stays open')
  .option('--activity <id>', 'Logical activity id')
  .option('--instructions <text>', 'Safe instructions for the human')
  .action(async (sessionId, reason, options) => {
    try {
      const result = await host.suspendForUser(sessionId, reason, {
        activityId: options.activity,
        safeInstructions: options.instructions,
      });
      if (!result.ok) {
        console.error(chalk.red('Suspend failed:'), result.reason);
        process.exit(1);
      }
      console.log(chalk.green('Suspended. Checkpoint:'), result.checkpoint.checkpointId);
      console.log(chalk.gray('Browser left open. Ask Juan to continue when ready.'));
    } catch (error: any) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command('gateway:resume <sessionId> <checkpointId>')
  .description('Resume a suspended session from its checkpoint (same live tab)')
  .action(async (sessionId, checkpointId) => {
    try {
      const result = await host.resumeSession(sessionId, checkpointId);
      if (!result.ok) {
        console.error(chalk.red('Resume failed:'), result.reason);
        process.exit(1);
      }
      console.log(chalk.green('Resumed:'), result.status, '| recovery:', result.recovery);
      if (result.url) console.log(chalk.gray('URL:'), result.url);
    } catch (error: any) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command('gateway:resume-activity <activityId>')
  .description('Resume the waiting task matching an activityId (resolves only that session, no internal ids needed)')
  .action(async (activityId) => {
    try {
      const result = await host.resolveWaitingTask(activityId);
      if (!result.ok) {
        console.error(chalk.red('Resume failed:'), result.reason);
        process.exit(1);
      }
      console.log(chalk.green('Resumed:'), result.status, '| recovery:', result.recovery);
      if (result.url) console.log(chalk.gray('URL:'), result.url);
    } catch (error: any) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

program
  .command('gateway:waiting')
  .description('List sessions currently waiting for a human')
  .action(() => {
    const waiting = host.listWaitingSessions();
    if (!waiting.length) {
      console.log(chalk.gray('No sessions waiting for a human.'));
      return;
    }
    for (const s of waiting) {
      console.log(
        chalk.yellow(s.sessionId),
        '| checkpoint:',
        s.checkpoint?.checkpointId,
        '| reason:',
        s.checkpoint?.reason,
      );
    }
  });

program
  .command('gateway:status <sessionId>')
  .description('Report the status of a BrowserHost session')
  .action((sessionId) => {
    const session = host.getSession(sessionId);
    if (!session) {
      console.error(chalk.red('Session not found:'), sessionId);
      process.exit(1);
    }
    console.log(chalk.green('Status:'), session.status);
    console.log('engine:', session.engine, '| headed:', session.headed, '| recovery:', session.recovery);
    if (session.checkpoint) console.log('checkpoint:', session.checkpoint.checkpointId);
  });

program
  .command('gateway:host-close <sessionId>')
  .description('Explicitly close a persistent BrowserHost session (always wins)')
  .action(async (sessionId) => {
    try {
      const result = await host.closeSession(sessionId);
      if (!result.ok) {
        console.error(chalk.red('Close failed:'), result.reason);
        process.exit(1);
      }
      console.log(chalk.green('Closed:'), sessionId);
    } catch (error: any) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// --- SessionVault / durable authenticated sessions CLI (US-002) --------------

program
  .command('gateway:approval-pending')
  .description('List pending approvals (pendingId, actionType, target, expiresAt) for the operator')
  .action(() => {
    const registry = createApprovalRegistry();
    const pendings = registry.listPending().filter((p) => p.status === 'pending');
    if (!pendings.length) {
      console.log(chalk.gray('No pending approvals.'));
      return;
    }
    for (const p of pendings) {
      console.log(
        chalk.yellow(p.pendingId),
        '|',
        p.request.actionType,
        '| target:',
        p.request.target ?? '(none)',
        '| expires:',
        new Date(p.expiresAt).toISOString(),
      );
    }
  });

program
  .command('gateway:approve <pendingId>')
  .description('Approve a pending approval (trusted human/operator action). Prints the one-time token')
  .action((pendingId) => {
    const registry = createApprovalRegistry();
    const pending = registry.getPending(pendingId);
    if (!pending) {
      console.error(chalk.red('Unknown pending approval:'), pendingId);
      process.exit(1);
    }
    const result = registry.approve(pendingId, 'operator');
    if (!result.ok) {
      console.error(chalk.red('Approve failed:'), result.reason);
      process.exit(1);
    }
    console.log(chalk.green('Approved:'), pendingId);
    console.log('bound request:', pending.request.actionType, '| target:', pending.request.target ?? '(none)');
    console.log('taskId:', pending.request.taskId, '| sessionId:', pending.request.sessionId);
    console.log(chalk.cyan('One-time token:'));
    console.log(JSON.stringify(result.token));
    console.log(chalk.gray('Hand this token to the agent to retry gateway_execute with approval.approvalId + approval.signature.'));
  });

program
  .command('gateway:session-register <profileId>')
  .description('Register a SessionProfile (allowed domains, permissions, approval policy)')
  .option('--domains <csv>', 'Comma-separated allowed domains')
  .option('--interactive', 'Prefer manual interactive login bootstrap')
  .option('--max-age <ms>', 'Max session age in ms before reauthentication', '604800000')
  .action((profileId, options) => {
    if (!vault) {
      console.error(chalk.red('SessionVault unavailable: MASTER_KEY not configured.'));
      process.exit(1);
    }
    const allowedDomains = options.domains ? options.domains.split(',').map((d: string) => d.trim()) : [];
    vault.registerProfile({
      profileId,
      allowedDomains,
      interactiveLoginPreferred: options.interactive,
      maxAgeMs: parseInt(options.maxAge, 10),
    });
    console.log(chalk.green('Profile registered:'), profileId, '| domains:', allowedDomains.join(', '));
  });

program
  .command('gateway:session-bootstrap <profileId> <engine>')
  .description('Bootstrap a durable authenticated session (engine: playwright|obscura)')
  .action(async (profileId, engine) => {
    if (!vault) {
      console.error(chalk.red('SessionVault unavailable: MASTER_KEY not configured.'));
      process.exit(1);
    }
    const result = await vault.bootstrap(profileId, engine);
    console.log(chalk.green('Outcome:'), result.outcome);
    if ('reason' in result && result.reason) console.log(chalk.gray('Reason:'), result.reason);
  });

program
  .command('gateway:session-validate <profileId> <engine>')
  .description('Validate a persisted session (engine: playwright|obscura)')
  .action(async (profileId, engine) => {
    if (!vault) {
      console.error(chalk.red('SessionVault unavailable: MASTER_KEY not configured.'));
      process.exit(1);
    }
    const result = await vault.validate(profileId, engine);
    console.log(chalk.green('Outcome:'), result.outcome, '| status:', result.status ?? 'none');
    if ('reason' in result && result.reason) console.log(chalk.gray('Reason:'), result.reason);
  });

program
  .command('gateway:session-revoke <profileId> <engine>')
  .description('Revoke a persisted session (engine: playwright|obscura)')
  .action(async (profileId, engine) => {
    if (!vault) {
      console.error(chalk.red('SessionVault unavailable: MASTER_KEY not configured.'));
      process.exit(1);
    }
    const result = await vault.revoke(profileId, engine);
    if (!result.ok) {
      console.error(chalk.red('Revoke failed:'), result.reason);
      process.exit(1);
    }
    console.log(chalk.green('Revoked:'), profileId, '/', engine);
  });

program
  .command('gateway:session-status <profileId> <engine>')
  .description('Report safe metadata for a persisted session (never raw auth state)')
  .action(async (profileId, engine) => {
    if (!vault) {
      console.error(chalk.red('SessionVault unavailable: MASTER_KEY not configured.'));
      process.exit(1);
    }
    const metadata = await vault.getStatus(profileId, engine);
    if (!metadata) {
      console.error(chalk.red('No persisted session:'), profileId, '/', engine);
      process.exit(1);
    }
    console.log(chalk.green('Status:'), metadata.status);
    console.log('profileId:', metadata.profileId, '| engine:', metadata.engine);
    console.log('domains:', metadata.domains.join(', '));
    console.log('createdAt:', new Date(metadata.createdAt).toISOString());
    console.log('lastValidatedAt:', new Date(metadata.lastValidatedAt).toISOString());
    console.log('artifactRef:', metadata.artifactRef);
  });

program
  .command('gateway:session-restore <profileId> <engine>')
  .description('Restore an authenticated session from the vault artifact into a NEW Playwright runtime (engine: playwright). Prints only the typed outcome + safe metadata — never raw cookies')
  .option('--headed', 'Launch a visible browser')
  .action(async (profileId, engine, options) => {
    const bridge = createSessionRestoreAuth();
    if (!bridge) {
      console.error(chalk.red('SessionVault unavailable: MASTER_KEY not configured.'));
      process.exit(1);
    }
    const result = await bridge.restoreAuth(profileId, { headed: options.headed });
    console.log(chalk.green('Outcome:'), result.outcome);
    if (result.outcome === 'healthy') {
      console.log('profileId:', result.profileId, '| engine:', result.engine);
      console.log('domains:', result.domains.join(', '));
      console.log('artifactRef:', result.artifactRef);
    } else if ('reason' in result && result.reason) {
      console.log(chalk.gray('Reason:'), result.reason);
      console.log(
        chalk.yellow('Run `gateway:session-bootstrap <profileId> <engine>` to trigger the WAITING_FOR_USER headed login flow.'),
      );
    }
  });

// --- Deep Research quick/standard/deep CLI (US-003) ---------------------------

program
  .command('research <question>')
  .description('Run quick/standard/deep web research (deep-research.md). Bounded budgets, evidence ledger')
  .option('--mode <mode>', 'quick | standard | deep', 'standard')
  .option('--session <id>', 'Browser session id', 'research')
  .option('--max-search <n>', 'Budget override: max search requests')
  .action(async (question, options) => {
    try {
      const { ResearchAgent } = await import('../../lib/browser-gateway/application/research-agent.js');
      const { SearchProviderRouter } = await import('../../lib/browser-gateway/application/search-provider-router.js');
      const { EnvSecretProvider } = await import('../../lib/browser-gateway/infrastructure/secret-provider/env-secret-provider.js');
      const { createHttpSearchProvider } = await import('../../lib/browser-gateway/infrastructure/search/http-search-providers.js');
      const { FakeSearchProvider } = await import('../../lib/browser-gateway/infrastructure/search/fake-search-provider.js');
      const { createGateway } = await import('../../lib/browser-gateway/infrastructure/gateway-factory.js');

      const gw = createGateway();
      gw.createSession(options.session, { transport: 'cli' });

      const providers: any[] = [];
      for (const id of (process.env.SEARCH_PROVIDER_ORDER || 'brave,exa,tavily').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
        const p = createHttpSearchProvider(id, new EnvSecretProvider());
        if (p) providers.push(p);
      }
      providers.push(new FakeSearchProvider('fake', { results: [], available: false }));

      const agent = new ResearchAgent({
        searchRouter: new SearchProviderRouter(providers),
        reader: {
          read: async (url: string) => {
            const res = await gw.executeTask({ taskId: `research-${Date.now()}`, sessionId: options.session, action: { type: 'navigate', url } });
            if (res.status !== 'success') return { status: res.status === 'blocked' ? 'blocked' : 'unavailable', reason: res.reason };
            const ex = await gw.executeTask({ taskId: `research-${Date.now()}`, sessionId: options.session, action: { type: 'extract', selector: 'body' } });
            if (ex.status !== 'success') return { status: 'unavailable', reason: 'extract_failed' };
            const payload = (ex.data as { text?: string }) ?? {};
            return { status: 'success', page: { url, title: '', text: payload.text ?? '', headings: [], fetchedAt: new Date().toISOString() } };
          },
        },
        secretProvider: new EnvSecretProvider(),
      });

      const budget = options.maxSearch ? { maxSearchRequests: parseInt(options.maxSearch, 10) } : undefined;
      const outcome = await agent.run({ question, mode: options.mode, sessionId: options.session, budget });
      console.log(chalk.greenBright('\n=== Status:'), outcome.status, '===');
      if ('report' in outcome) {
        console.log(chalk.cyan('\nAnswer:\n'), outcome.report.answer);
        console.log(chalk.cyan('Confidence:'), outcome.report.confidence);
        if (outcome.report.limitations.length) console.log(chalk.yellow('Limitations:'), outcome.report.limitations.join('; '));
        console.log(chalk.magenta('\nCitations:'));
        for (const c of outcome.report.citations) console.log(`  - ${c.title} [${c.evidenceId}] ${c.url}`);
        if (outcome.report.contradictoryClaims.length) {
          console.log(chalk.red('\nContradictions:'));
          outcome.report.contradictoryClaims.forEach((c) => console.log(`  ! ${c}`));
        }
        if (outcome.report.singleSourceClaims.length) {
          console.log(chalk.yellow('\nSingle-source claims:'));
          outcome.report.singleSourceClaims.forEach((c) => console.log(`  - ${c}`));
        }
      } else {
        console.log(chalk.red('Reason:'), outcome.reason);
      }
      console.log(chalk.gray('\nTelemetry:'), JSON.stringify(outcome.telemetry));
    } catch (error: any) {
      console.error(chalk.red('Research failed:'), error.message);
      process.exit(1);
    }
  });

// Parse arguments
program.parse();

// Show help if no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
