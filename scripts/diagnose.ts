#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import chalk from 'chalk';
import { createSessionVault } from '../lib/browser-gateway/infrastructure/gateway-factory.js';
import { createEnvOperators } from '../lib/browser-gateway/infrastructure/llm/env-operators.js';
import { EnvSecretProvider } from '../lib/browser-gateway/infrastructure/secret-provider/env-secret-provider.js';
import { launchWithFallback } from '../lib/browser-gateway/infrastructure/engines/playwright/launch-with-fallback.js';
import {
  isValidMasterKey,
  resolveApprovalSecret,
} from '../lib/security/secret-resolver.js';

console.log(chalk.blue('\n🔍 MCP Playwright Automation - System Diagnostic\n'));

interface Check {
  name: string;
  check: () => boolean | Promise<boolean>;
  fix?: string;
  optional?: boolean;
}

const checks: Check[] = [];

// Helper to run command and check (cross-platform: `where` on Windows, `command -v` on Unix)
function commandExists(cmd: string): boolean {
  try {
    const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(probe, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function commandRuns(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// --- Base environment checks -------------------------------------------------

// Node.js version
checks.push({
  name: 'Node.js >= 20.0.0',
  check: () => {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0]);
    return major >= 20;
  },
  fix: 'Install Node.js 20+ from https://nodejs.org',
});

// npm
checks.push({
  name: 'npm installed',
  check: () => commandExists('npm'),
  fix: 'Install npm (comes with Node.js)',
});

// TypeScript compiler
checks.push({
  name: 'Project compiled',
  check: () => existsSync('dist'),
  fix: 'Run: npm run build',
});

// .env file
checks.push({
  name: '.env file exists',
  check: () => existsSync('.env'),
  fix: 'Run: npm run init (or copy .env.example to .env)',
});

// --- Browser Agent Gateway readiness -----------------------------------------

// Obscura readiness (REAL engine: launches the obscura-node CDP binary)
checks.push({
  name: 'Obscura engine available',
  check: async () => {
    const { ObscuraEngine } = await import(
      '../lib/browser-gateway/infrastructure/engines/obscura/obscura-engine.js'
    );
    const health = await new ObscuraEngine().health().catch(() => ({ healthy: false }));
    return health.healthy;
  },
  fix: 'Install the Obscura browser binary: npm install obscura-node (launches automatically on first use). Optional; Playwright fallback applies otherwise.',
  optional: true,
});

// Playwright browser available (bundled chromium OR system Chrome via channel: 'chrome')
checks.push({
  name: 'Playwright browser available',
  check: async () => {
    let browser;
    try {
      browser = await launchWithFallback({ headless: true });
      return true;
    } catch {
      return false;
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  },
  fix: 'Run: npx playwright install chromium (or install Google Chrome to use the system-Chrome fallback)',
});

// MASTER_KEY (secret/session infrastructure)
checks.push({
  name: 'MASTER_KEY configured (32+ chars)',
  check: () => isValidMasterKey(process.env.MASTER_KEY),
  fix: 'Set a MASTER_KEY of 32+ random characters in .env (required for durable encrypted sessions)',
});

// SessionVault availability
checks.push({
  name: 'SessionVault available (encrypted sessions)',
  check: () => Boolean(createSessionVault()),
  fix: 'Set a valid MASTER_KEY (32+ chars) in .env to enable the SessionVault',
  optional: true,
});

// Approval registry secret (BLOCKER-F): the approval HMAC must never fall back
// to a known default. Either APPROVAL_SECRET or a valid MASTER_KEY (32+ chars,
// from which a dedicated subkey is HKDF-derived) must be configured.
checks.push({
  name: 'Approval secret configured (APPROVAL_SECRET or MASTER_KEY 32+)',
  check: () => resolveApprovalSecret() !== undefined,
  fix: 'Set APPROVAL_SECRET (a random string) OR a MASTER_KEY of 32+ random characters in .env. Without one, the approval registry is fail-closed and side-effect approvals cannot be issued/verified.',
});

// --- LLM provider readiness (availability only, never the key) ----------------

const envOps = createEnvOperators();
const llmRoles: Array<{ label: string; op: (typeof envOps)['primary'] }> = [
  { label: 'LLM primary', op: envOps.primary },
  { label: 'LLM escalation', op: envOps.escalation },
  { label: 'LLM alternate', op: envOps.alternate },
];
for (const { label, op } of llmRoles) {
  checks.push({
    name: `${label} (${op.provider}/${op.model})`,
    check: () => op.available(),
    fix: `Set the API key for provider "${op.provider}" in .env (e.g. ${op.provider.toUpperCase()}_API_KEY)`,
    optional: true,
  });
}

// --- Search provider readiness (availability only, never the key) -------------

const secretProvider = new EnvSecretProvider();
const searchOrder = (process.env.SEARCH_PROVIDER_ORDER || 'brave,exa,tavily')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
for (const id of searchOrder) {
  checks.push({
    name: `Search provider "${id}"`,
    check: async () => Boolean(await secretProvider.resolve(`search.${id}`)),
    fix: `Set SEARCH_${id.toUpperCase()}_API_KEY in .env to enable the "${id}" search provider`,
    optional: true,
  });
}

// --- Run checks --------------------------------------------------------------

console.log(chalk.gray('Running diagnostics...\n'));

let passed = 0;
let failed = 0;
let optionalSkipped = 0;

async function run() {
  for (const check of checks) {
    let result: boolean;
    try {
      result = await check.check();
    } catch {
      result = false;
    }

    if (result) {
      passed++;
      console.log(`${chalk.green('✓')} ${check.name.padEnd(46)} ${chalk.green('OK')}`);
      continue;
    }

    if (check.optional) {
      optionalSkipped++;
      console.log(`${chalk.yellow('○')} ${check.name.padEnd(46)} ${chalk.yellow('OPTIONAL')}`);
    } else {
      failed++;
      console.log(`${chalk.red('✗')} ${check.name.padEnd(46)} ${chalk.red('FAIL')}`);
    }

    if (check.fix) {
      console.log(chalk.gray(`  → ${check.fix}`));
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`${passed} passed, ${failed} failed, ${optionalSkipped} optional/skipped`);
  console.log('='.repeat(60) + '\n');

  if (failed === 0) {
    console.log(chalk.green('🎉 All required checks passed! System is ready.\n'));
    console.log(chalk.blue('Try running:'));
    console.log(chalk.gray('  npm run smoke:gateway'));
    console.log(chalk.gray('  npm run agent "Navigate to google.com"'));
    console.log(chalk.gray('  npm run research "What is the Browser Agent Gateway?" --mode quick\n'));
  } else {
    console.log(chalk.yellow('⚠️  Some required checks failed. Please fix the issues above.\n'));
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(chalk.red('Diagnostic failed:'), error.message);
  process.exit(1);
});
