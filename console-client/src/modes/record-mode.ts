import { spawn } from 'child_process';
import { logger } from '../../../lib/observability/logger.js';
import chalk from 'chalk';

export class RecordMode {
  async execute(url: string, options: any = {}) {
    console.log(chalk.blue('\n🎬 Record Mode\n'));
    console.log(chalk.cyan('URL:'), url);
    console.log(chalk.gray('\nStarting Playwright Codegen...\n'));
    console.log(chalk.yellow('👉 Perform your actions in the browser'));
    console.log(chalk.yellow('👉 Close the browser when done\n'));

    const name = options.name || `recording-${Date.now()}`;
    const outputPath = `recordings/manual/${name}.spec.ts`;

    try {
      await this.runCodegen(url, outputPath);

      console.log(chalk.green('\n✅ Recording saved!'));
      console.log(chalk.gray('\nFile:'), outputPath);
      console.log(chalk.gray('\nYou can now:'));
      console.log(chalk.gray('  1. Replay:'), `npm run replay ${outputPath}`);
      console.log(chalk.gray('  2. Edit:'), `code ${outputPath}`);
      console.log(chalk.gray('  3. Use in tests:'), `npx playwright test ${outputPath}\n`);

      return { success: true, path: outputPath };
    } catch (error: any) {
      console.log(chalk.red('\n❌ Recording failed:'), error.message);
      throw error;
    }
  }

  private runCodegen(url: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('npx', ['playwright', 'codegen', url, '--target', 'playwright-test', '--output', outputPath], {
        stdio: 'inherit',
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Codegen exited with code ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }
}
