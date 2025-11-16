#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import chalk from 'chalk';

console.log(chalk.blue('\n🎉 MCP Playwright Automation - Post Install\n'));

try {
  // 1. Create directories
  console.log('📁 Creating necessary directories...');
  execSync('tsx scripts/create-directories.ts', { stdio: 'inherit' });

  // 2. Check if .env exists
  if (!existsSync('.env')) {
    console.log(chalk.yellow('\n⚠️  No .env file found'));
    console.log(chalk.gray('Run: npm run init (to create .env and setup)\n'));
  } else {
    console.log(chalk.green('✓ .env file exists\n'));
  }

  // 3. Install Playwright browsers
  console.log('🌐 Installing Playwright browsers...');
  execSync('npx playwright install chromium', { stdio: 'inherit' });

  console.log(chalk.green('\n✅ Post-install complete!\n'));

  console.log(chalk.blue('📋 Next steps:\n'));
  console.log(chalk.gray('  1. npm run init           # Initialize project'));
  console.log(chalk.gray('  2. npm run setup          # Install local models (~15GB)'));
  console.log(chalk.gray('  3. npm run build          # Compile TypeScript'));
  console.log(chalk.gray('  4. npm run agent "..."    # Run your first task\n'));

  console.log(chalk.gray('📖 Documentation:'));
  console.log(chalk.gray('  - README.md'));
  console.log(chalk.gray('  - QUICKSTART.md'));
  console.log(chalk.gray('  - IMPLEMENTATION_STATUS.md\n'));

} catch (error: any) {
  console.error(chalk.red('❌ Post-install failed:'), error.message);
  process.exit(1);
}
