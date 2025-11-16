#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import chalk from 'chalk';

console.log(chalk.blue('\n🔍 MCP Playwright Automation - System Diagnostic\n'));

const checks: Array<{ name: string; check: () => boolean; fix?: string }> = [];

// Helper to run command and check
function commandExists(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
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
  fix: 'Run: npm run init',
});

// MASTER_KEY in .env
checks.push({
  name: 'MASTER_KEY configured',
  check: () => {
    if (!existsSync('.env')) return false;
    const env = readFileSync('.env', 'utf8');
    return env.includes('MASTER_KEY=') && !env.includes('your-32-character');
  },
  fix: 'Run: npm run init (or set MASTER_KEY manually in .env)',
});

// Playwright
checks.push({
  name: 'Playwright installed',
  check: () => commandExists('playwright'),
  fix: 'Run: npx playwright install',
});

// Ollama
checks.push({
  name: 'Ollama installed',
  check: () => commandExists('ollama'),
  fix: 'Run: npm run setup',
});

// Ollama running
checks.push({
  name: 'Ollama service running',
  check: () => commandRuns('ollama list'),
  fix: 'Run: ollama serve &',
});

// Tesseract
checks.push({
  name: 'Tesseract OCR installed',
  check: () => commandExists('tesseract'),
  fix: 'Optional: Install tesseract for OCR support',
});

// Run checks
console.log(chalk.gray('Running diagnostics...\n'));

let passed = 0;
let failed = 0;

checks.forEach(check => {
  const result = check.check();
  const icon = result ? chalk.green('✓') : chalk.red('✗');
  const status = result ? chalk.green('OK') : chalk.red('FAIL');

  console.log(`${icon} ${check.name.padEnd(30)} ${status}`);

  if (!result && check.fix) {
    console.log(chalk.gray(`  → ${check.fix}`));
  }

  if (result) passed++;
  else failed++;
});

console.log('\n' + '='.repeat(60));
console.log(`${passed} passed, ${failed} failed`);
console.log('='.repeat(60) + '\n');

if (failed === 0) {
  console.log(chalk.green('🎉 All checks passed! System is ready.\n'));
  console.log(chalk.blue('Try running:'));
  console.log(chalk.gray('  npm run agent "Navigate to google.com"\n'));
} else {
  console.log(chalk.yellow('⚠️  Some checks failed. Please fix the issues above.\n'));
  process.exit(1);
}
