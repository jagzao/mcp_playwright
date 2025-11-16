import { LLMClient, LLMResponse } from './llm-clients.js';
import { TimeUtils } from '../../../lib/utils/time-utils.js';
import { resourceMonitor } from '../../../lib/utils/resource-monitor.js';
import { logger } from '../../../lib/observability/logger.js';
import { llmConfig } from '../../../lib/config/index.js';

export class LLMScheduler {
  /**
   * Get available LLMs based on current time and resource constraints
   */
  getAvailableLLMs(clients: Map<string, LLMClient>): LLMClient[] {
    const isNighttime = TimeUtils.isNighttime();
    const resourceCheck = resourceMonitor.checkLimits();

    if (!resourceCheck.allowed) {
      logger.warn('Resource limits exceeded', { reason: resourceCheck.reason });
      return [];
    }

    // Get allowed models based on time
    const allowedModelNames = isNighttime
      ? llmConfig.fallbackChain.nighttime
      : llmConfig.fallbackChain.daytime;

    const availableClients: LLMClient[] = [];

    for (const modelName of allowedModelNames) {
      const client = clients.get(modelName);
      if (client) {
        // Check if model is allowed at this time
        if (this.isModelAllowedNow(modelName)) {
          availableClients.push(client);
        }
      }
    }

    return availableClients;
  }

  private isModelAllowedNow(modelName: string): boolean {
    const modelConfig = llmConfig.llms.find((m: any) => m.name === modelName);
    if (!modelConfig) return false;

    // If schedule is "always", it's always allowed
    if (modelConfig.schedule === 'always') {
      return true;
    }

    // Check specific schedule
    if (typeof modelConfig.schedule === 'object') {
      const schedule = modelConfig.schedule as any;

      // If daytime is specified
      if (schedule.daytime !== undefined) {
        return schedule.daytime === TimeUtils.isDaytime();
      }

      // If allowed time ranges are specified
      if (schedule.allowed && Array.isArray(schedule.allowed)) {
        return schedule.allowed.some((range: any) =>
          TimeUtils.isInTimeRange(range.start, range.end)
        );
      }
    }

    return true;
  }

  /**
   * Get priority-ordered LLMs (highest priority first)
   */
  getPrioritizedLLMs(clients: Map<string, LLMClient>): LLMClient[] {
    const available = this.getAvailableLLMs(clients);

    // Sort by priority (lower number = higher priority)
    return available.sort((a, b) => {
      const priorityA = this.getModelPriority(a.name);
      const priorityB = this.getModelPriority(b.name);
      return priorityA - priorityB;
    });
  }

  private getModelPriority(modelName: string): number {
    const modelConfig = llmConfig.llms.find((m: any) => m.name === modelName);
    return modelConfig?.priority ?? 999;
  }

  /**
   * Check if we should wait for nighttime to use heavier models
   */
  shouldWaitForNight(): boolean {
    if (TimeUtils.isNighttime()) return false;

    // Check if there are better models available at night
    const currentAvailable = llmConfig.fallbackChain.daytime.length;
    const nightAvailable = llmConfig.fallbackChain.nighttime.length;

    return nightAvailable > currentAvailable;
  }

  getTimeUntilNight(): number {
    return TimeUtils.getDelayUntilNight();
  }
}

export const scheduler = new LLMScheduler();
