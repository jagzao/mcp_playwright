import { Action, ObservationData, TaskResult } from '../../../lib/types/index.js';
import { HybridObserver } from '../observer/index.js';
import { SmartPlanner } from '../planner/index.js';
import { ActionExecutor } from '../executor/index.js';
import { logger } from '../../../lib/observability/logger.js';
import { metrics } from '../../../lib/observability/metrics.js';
import { agentConfig } from '../../../lib/config/index.js';
import { randomUUID } from 'crypto';

export interface AgentTask {
  instruction: string;
  maxSteps?: number;
  data?: string;
  session?: string;
  onProgress?: (progress: TaskProgress) => void;
}

export interface TaskProgress {
  stepNumber: number;
  totalSteps: number;
  action: string;
  status: 'observing' | 'thinking' | 'acting' | 'verifying';
  message: string;
}

export class AgentOrchestrator {
  private observer: HybridObserver;
  private planner: SmartPlanner;
  private executor: ActionExecutor;
  private running: boolean = false;

  constructor() {
    this.observer = new HybridObserver();
    this.planner = new SmartPlanner();
    this.executor = new ActionExecutor();
  }

  async executeTask(task: AgentTask): Promise<TaskResult> {
    const taskId = randomUUID();
    const startTime = Date.now();

    logger.info('Task started', {
      taskId,
      instruction: task.instruction,
    });

    this.running = true;

    const stepHistory: Action[] = [];
    const maxSteps = task.maxSteps || agentConfig.agent.execution.maxStepsPerTask;

    let currentUrl: string | undefined;
    let lastObservation: ObservationData | null = null;
    let stuckCounter = 0;

    try {
      // Connect to MCP server
      await this.executor.connect();

      // Main agent loop: observe → think → act
      for (let step = 1; step <= maxSteps && this.running; step++) {
        logger.info(`Step ${step}/${maxSteps}`, { taskId });

        // 1. OBSERVE
        task.onProgress?.({
          stepNumber: step,
          totalSteps: maxSteps,
          action: 'observe',
          status: 'observing',
          message: 'Observing page state...',
        });

        const observation = await this.observe();

        if (!this.observer.isSufficient(observation)) {
          logger.warn('Insufficient observation data');
          stuckCounter++;

          if (stuckCounter > 3) {
            throw new Error('Agent stuck: No interactive elements found for 3 consecutive steps');
          }
        } else {
          stuckCounter = 0;
        }

        lastObservation = observation;

        // 2. THINK
        task.onProgress?.({
          stepNumber: step,
          totalSteps: maxSteps,
          action: 'think',
          status: 'thinking',
          message: 'Planning next action...',
        });

        const action = await this.planner.plan({
          instruction: task.instruction,
          currentUrl,
          observation,
          stepHistory,
        });

        logger.info('Action planned', {
          step,
          type: action.type,
          selector: action.selector,
        });

        // 3. ACT
        task.onProgress?.({
          stepNumber: step,
          totalSteps: maxSteps,
          action: action.type,
          status: 'acting',
          message: `Executing: ${action.type} ${action.selector || action.url || ''}`,
        });

        const result = await this.executor.execute(action);

        stepHistory.push(action);

        // 4. VERIFY
        task.onProgress?.({
          stepNumber: step,
          totalSteps: maxSteps,
          action: action.type,
          status: 'verifying',
          message: 'Verifying result...',
        });

        if (result.success) {
          this.planner.recordSuccess(task.instruction, observation, action);

          // Update current URL if we navigated
          if (action.type === 'navigate' && action.url) {
            currentUrl = action.url;
          }

          // Check if task is complete
          if (this.isTaskComplete(task.instruction, stepHistory)) {
            logger.info('Task appears complete', { step });
            break;
          }
        } else {
          this.planner.recordFailure(task.instruction, observation, action);

          logger.warn('Action failed', {
            step,
            type: action.type,
            error: result.error,
          });

          stuckCounter++;

          if (stuckCounter > 5) {
            throw new Error('Agent stuck: Too many consecutive failures');
          }
        }
      }

      // Task completed
      const duration = Date.now() - startTime;

      logger.info('Task completed', {
        taskId,
        stepsExecuted: stepHistory.length,
        duration,
      });

      metrics.recordTaskComplete(duration / 1000);

      const taskResult: TaskResult = {
        taskId,
        success: true,
        instruction: task.instruction,
        duration: duration / 1000,
        stepsExecuted: stepHistory.length,
        llmCallsUsed: 0, // TODO: track this
        cacheHitRate: 0, // TODO: track this
        cost: 0,
      };

      return taskResult;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      logger.error('Task failed', {
        taskId,
        error: error.message,
        stepsExecuted: stepHistory.length,
      });

      metrics.recordTaskFailed(duration / 1000);
      metrics.recordError('task-failed');

      return {
        taskId,
        success: false,
        instruction: task.instruction,
        duration: duration / 1000,
        stepsExecuted: stepHistory.length,
        llmCallsUsed: 0,
        cacheHitRate: 0,
        cost: 0,
        error: error.message,
      };
    } finally {
      await this.executor.disconnect();
      this.running = false;
    }
  }

  private async observe(): Promise<ObservationData> {
    // For now, return a simple observation
    // In a full implementation, this would call MCP tools to get page state
    return {
      method: 'accessibility',
      elements: [],
      cost: 0,
      speed: 'fast',
    };
  }

  private isTaskComplete(instruction: string, stepHistory: Action[]): boolean {
    // Simple heuristic: if we've done a reasonable number of steps, consider it done
    // In reality, this would use the LLM to determine if the task is complete

    const minSteps = 3;
    if (stepHistory.length < minSteps) {
      return false;
    }

    // Check if we've been doing the same action repeatedly (stuck)
    const lastActions = stepHistory.slice(-3).map(a => a.type);
    const allSame = lastActions.every(a => a === lastActions[0]);

    if (allSame) {
      logger.warn('Detected repeated actions, assuming task complete or stuck');
      return true;
    }

    return false;
  }

  stop() {
    this.running = false;
    logger.info('Agent stop requested');
  }
}
