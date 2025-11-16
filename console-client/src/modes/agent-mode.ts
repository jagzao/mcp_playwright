import { AgentOrchestrator, AgentTask, TaskProgress } from '../../../agent/src/orchestrator/index.js';
import { logger } from '../../../lib/observability/logger.js';
import { metrics } from '../../../lib/observability/metrics.js';
import chalk from 'chalk';

export class AgentMode {
  private orchestrator: AgentOrchestrator;

  constructor() {
    this.orchestrator = new AgentOrchestrator();
  }

  async execute(instruction: string, options: any = {}) {
    console.log(chalk.blue('\n🤖 Agent Mode\n'));
    console.log(chalk.cyan('Instruction:'), instruction);

    if (options.data) {
      console.log(chalk.cyan('Data file:'), options.data);
    }

    if (options.session) {
      console.log(chalk.cyan('Session:'), options.session);
    }

    console.log('');

    const task: AgentTask = {
      instruction,
      maxSteps: options.maxSteps || 50,
      data: options.data,
      session: options.session,
      onProgress: (progress) => this.onProgress(progress),
    };

    try {
      const result = await this.orchestrator.executeTask(task);

      console.log('\n' + '='.repeat(60));

      if (result.success) {
        console.log(chalk.green('\n✅ Task completed successfully!\n'));
      } else {
        console.log(chalk.red('\n❌ Task failed\n'));
        console.log(chalk.red('Error:'), result.error);
      }

      console.log(chalk.gray('\n📊 Summary:'));
      console.log(chalk.gray('  Steps executed:'), result.stepsExecuted);
      console.log(chalk.gray('  Duration:'), `${result.duration.toFixed(1)}s`);
      console.log(chalk.gray('  Cost:'), `$${result.cost.toFixed(2)}`);

      console.log('='.repeat(60) + '\n');

      // Show metrics
      this.showMetrics();

      return result;
    } catch (error: any) {
      console.log(chalk.red('\n❌ Fatal error:'), error.message);
      throw error;
    }
  }

  private onProgress(progress: TaskProgress) {
    const icons = {
      observing: '🔭',
      thinking: '🧠',
      acting: '⚡',
      verifying: '✅',
    };

    const icon = icons[progress.status] || '📝';
    const stepInfo = chalk.gray(`[${progress.stepNumber}/${progress.totalSteps}]`);

    console.log(`${stepInfo} ${icon} ${progress.message}`);
  }

  private showMetrics() {
    const m = metrics.getMetrics();

    console.log(chalk.blue('\n📈 Session Metrics:'));
    console.log(chalk.gray('  Tasks completed:'), m.tasksCompleted);
    console.log(chalk.gray('  Success rate:'), `${(metrics.getSuccessRate() * 100).toFixed(1)}%`);
    console.log(chalk.gray('  Cache hit rate:'), `${(metrics.getCacheHitRate() * 100).toFixed(1)}%`);
    console.log('');
  }
}
