import { Action, ObservationData, TaskResult } from '../../../lib/types/index.js';
import { HybridObserver } from '../observer/index.js';
import { SmartPlanner } from '../planner/index.js';
import { ActionExecutor } from '../executor/index.js';
import { logger } from '../../../lib/observability/logger.js';
import { metrics } from '../../../lib/observability/metrics.js';
import { agentConfig } from '../../../lib/config/index.js';
import { llmManager } from '../../../console-client/src/llm/index.js';
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
          if (await this.isTaskComplete(task.instruction, stepHistory, observation)) {
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
    try {
      // Call MCP vision tools to get page state
      logger.debug('Calling vision tools for page observation');

      // Try accessibility tree first (fast and free)
      let accessibility = null;
      let dom = null;

      try {
        const a11yResult = await this.executor.callVisionTool('vision_accessibility_tree');
        accessibility = a11yResult.snapshot;
        logger.debug('Got accessibility snapshot', {
          hasData: !!accessibility,
        });
      } catch (error: any) {
        logger.warn('Failed to get accessibility tree', { error: error.message });
      }

      // Get DOM structure as fallback
      try {
        const domResult = await this.executor.callVisionTool('vision_get_dom_structure');
        dom = domResult.structure;
        logger.debug('Got DOM structure', {
          inputs: dom?.inputs?.length || 0,
          buttons: dom?.buttons?.length || 0,
          links: dom?.links?.length || 0,
        });
      } catch (error: any) {
        logger.warn('Failed to get DOM structure', { error: error.message });
      }

      // Use HybridObserver to process the raw data
      const observation = await this.observer.observe({
        accessibility,
        dom,
      });

      logger.debug('Observation complete', {
        method: observation.method,
        elementCount: observation.elements.length,
      });

      return observation;
    } catch (error: any) {
      logger.error('Observation failed', { error: error.message });

      // Return empty observation on failure
      return {
        method: 'accessibility',
        elements: [],
        cost: 0,
        speed: 'fast',
      };
    }
  }

  private async isTaskComplete(instruction: string, stepHistory: Action[], observation: ObservationData): Promise<boolean> {
    // Minimum steps before checking completion
    const minSteps = 2;
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

    // Use LLM to intelligently determine if task is complete
    try {
      const prompt = this.buildCompletionCheckPrompt(instruction, stepHistory, observation);
      const response = await llmManager.generate(prompt, {
        temperature: 0.0, // Use low temperature for consistent yes/no answers
        maxTokens: 100,
      });

      const answer = response.text.toLowerCase().trim();
      const isComplete = answer.includes('yes') || answer.includes('complete') || answer.includes('done');

      logger.debug('Task completion check', {
        isComplete,
        llmResponse: answer,
      });

      return isComplete;
    } catch (error: any) {
      logger.warn('Failed to check task completion with LLM', { error: error.message });
      // Fallback to heuristic: assume not complete if we can't check
      return false;
    }
  }

  private buildCompletionCheckPrompt(instruction: string, stepHistory: Action[], observation: ObservationData): string {
    const parts = [];

    parts.push('You are evaluating whether a web automation task has been completed.');
    parts.push(`\nOriginal instruction: "${instruction}"`);
    parts.push(`\nSteps executed (${stepHistory.length}):`);

    stepHistory.forEach((action, i) => {
      const detail = action.url || action.selector || action.value || '';
      parts.push(`${i + 1}. ${action.type} ${detail}`);
    });

    parts.push('\nCurrent page state:');
    if (observation.elements.length > 0) {
      parts.push(`- ${observation.elements.length} interactive elements found`);
      const types = [...new Set(observation.elements.map(e => e.type))];
      parts.push(`- Element types: ${types.join(', ')}`);
    } else {
      parts.push('- No interactive elements (page may have finished loading/submitting)');
    }

    parts.push('\nBased on the instruction and steps executed, is the task complete?');
    parts.push('Answer with YES if the task is complete, or NO if more steps are needed.');
    parts.push('Consider the task complete if:');
    parts.push('- The main goal of the instruction has been achieved');
    parts.push('- A form was submitted successfully (indicated by navigation or empty page)');
    parts.push('- The requested information was found/displayed');
    parts.push('\nAnswer (YES or NO):');

    return parts.join('\n');
  }

  stop() {
    this.running = false;
    logger.info('Agent stop requested');
  }
}
