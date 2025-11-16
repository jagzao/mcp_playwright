#!/usr/bin/env node

import { Command } from 'commander';
import { AgentMode } from './modes/agent-mode.js';
import { RecordMode } from './modes/record-mode.js';
import { ReplayMode } from './modes/replay-mode.js';
import { validateConfig } from '../../lib/config/index.js';
import { logger } from '../../lib/observability/logger.js';
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

// Parse arguments
program.parse();

// Show help if no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
