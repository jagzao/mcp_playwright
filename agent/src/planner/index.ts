import { Action, ObservationData } from '../../../lib/types/index.js';
import { LLMPlanner } from './llm-planner.js';
import { CacheLayer } from './cache-layer.js';
import { logger } from '../../../lib/observability/logger.js';
import { agentConfig } from '../../../lib/config/index.js';

export class SmartPlanner {
  private llmPlanner: LLMPlanner;
  private cache: CacheLayer;

  constructor() {
    this.llmPlanner = new LLMPlanner();
    this.cache = new CacheLayer();
  }

  async plan(context: {
    instruction: string;
    currentUrl?: string;
    observation: ObservationData;
    stepHistory: Action[];
    attemptNumber?: number;
  }): Promise<Action> {
    const { instruction, observation } = context;

    // Try cache first if enabled
    if (agentConfig.agent.memory.enabled) {
      const cached = this.cache.get(instruction, observation);
      if (cached) {
        return cached;
      }

      // Try fuzzy match
      const similar = this.cache.findSimilar(instruction, observation, 0.85);
      if (similar) {
        logger.info('Using similar cached action');
        return similar;
      }
    }

    // Call LLM to plan
    const action = await this.llmPlanner.planNextAction(context);

    return action;
  }

  recordSuccess(instruction: string, observation: ObservationData, action: Action) {
    if (agentConfig.agent.memory.enabled && agentConfig.agent.memory.rememberSuccesses) {
      this.cache.set(instruction, observation, action);
    }
  }

  recordFailure(instruction: string, observation: ObservationData, action: Action) {
    if (agentConfig.agent.memory.enabled && agentConfig.agent.memory.rememberFailures) {
      // For now, we don't cache failures
      // In future, could implement negative caching
      logger.debug('Action failed', { type: action.type, selector: action.selector });
    }
  }

  clearCache() {
    this.cache.clear();
  }

  getCacheStats() {
    return this.cache.getStats();
  }
}
