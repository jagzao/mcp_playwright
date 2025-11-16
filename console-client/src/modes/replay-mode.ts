import { spawn } from 'child_process';
import { logger } from '../../../lib/observability/logger.js';
import chalk from 'chalk';

export class ReplayMode {
  async execute(workflowPath: string, options: any = {}) {
    console.log(chalk.blue('\n▶️  Replay Mode\n'));
    console.log(chalk.cyan('Workflow:'), workflowPath);

    if (options.data) {
      console.log(chalk.cyan('Data:'), options.data);
    }

    console.log('');

    try {
      await this.runPlaywright(workflowPath, options);

      console.log(chalk.green('\n✅ Replay completed successfully!\n'));

      return { success: true };
    } catch (error: any) {
      console.log(chalk.red('\n❌ Replay failed:'), error.message);
      throw error;
    }
  }

  private runPlaywright(workflowPath: string, options: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = ['playwright', 'test', workflowPath];

      if (options.headed) {
        args.push('--headed');
      }

      if (options.debug) {
        args.push('--debug');
      }

      const child = spawn('npx', args, {
        stdio: 'inherit',
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Playwright test exited with code ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }
}
