import { Action, ActionResult } from '../../../lib/types/index.js';
import { MCPExecutor } from './mcp-executor.js';
import { logger } from '../../../lib/observability/logger.js';
import { agentConfig } from '../../../lib/config/index.js';

export class SelfHealingExecutor {
  private executor: MCPExecutor;
  private maxRetries: number;

  constructor(executor: MCPExecutor) {
    this.executor = executor;
    this.maxRetries = agentConfig.agent.selfHealing.maxRetries;
  }

  async execute(action: Action): Promise<ActionResult> {
    let lastResult: ActionResult = { success: false, error: 'Not attempted' };

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.executor.execute(action);

        if (result.success) {
          if (attempt > 1) {
            logger.info('Action succeeded after retry', {
              type: action.type,
              attempt,
            });
          }
          return result;
        }

        lastResult = result;

        if (attempt < this.maxRetries) {
          // Try to heal the action
          const healed = this.healAction(action, result, attempt);

          if (healed) {
            logger.info('Attempting healed action', {
              original: action.selector,
              healed: healed.selector,
              attempt,
            });
            action = healed;
          } else {
            // Can't heal, return failure
            break;
          }
        }
      } catch (error: any) {
        lastResult = {
          success: false,
          error: error.message,
        };

        if (attempt === this.maxRetries) {
          break;
        }
      }
    }

    return lastResult;
  }

  private healAction(action: Action, failureResult: ActionResult, attempt: number): Action | null {
    const strategies = agentConfig.agent.selfHealing.retryStrategies;

    // Try different healing strategies
    for (const strategy of strategies) {
      switch (strategy) {
        case 'alternative_selector':
          const alt = this.tryAlternativeSelector(action);
          if (alt) return alt;
          break;

        case 'wait_longer':
          const withWait = this.addWaitTime(action);
          if (withWait) return withWait;
          break;

        default:
          break;
      }
    }

    return null;
  }

  private tryAlternativeSelector(action: Action): Action | null {
    if (action.type !== 'click' && action.type !== 'fill') {
      return null;
    }

    if (!action.selector) {
      return null;
    }

    // Try common alternative selectors
    const alternatives = this.generateAlternatives(action.selector);

    if (alternatives.length > 0) {
      return {
        ...action,
        selector: alternatives[0],
      };
    }

    return null;
  }

  private generateAlternatives(selector: string): string[] {
    const alternatives: string[] = [];

    // If it's an ID selector, try class or tag
    if (selector.startsWith('#')) {
      const id = selector.substring(1);
      alternatives.push(`[id="${id}"]`);
    }

    // If it's a button, try different selectors
    if (selector === 'button') {
      alternatives.push('button[type="submit"]');
      alternatives.push('[role="button"]');
      alternatives.push('input[type="submit"]');
    }

    // If it's an input, try different types
    if (selector.startsWith('input')) {
      alternatives.push('input');
      alternatives.push('textarea');
      alternatives.push('[contenteditable="true"]');
    }

    return alternatives;
  }

  private addWaitTime(action: Action): Action | null {
    return {
      ...action,
      timeout: (action.timeout || 30000) * 2, // Double the timeout
    };
  }
}
