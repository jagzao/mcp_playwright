import { Action, ObservationData } from '../../../lib/types/index.js';
import { LLMPlanner } from './llm-planner.js';
import { CacheLayer } from './cache-layer.js';
import { IntentDetector } from './intent-detector.js';
import { logger } from '../../../lib/observability/logger.js';
import { agentConfig } from '../../../lib/config/index.js';

export class SmartPlanner {
  private llmPlanner: LLMPlanner;
  private cache: CacheLayer;
  private intentDetector: IntentDetector;
  private plannedActions: Action[] = [];
  private planIndex: number = 0;

  constructor() {
    this.llmPlanner = new LLMPlanner();
    this.cache = new CacheLayer();
    this.intentDetector = new IntentDetector();
  }

  async plan(context: {
    instruction: string;
    currentUrl?: string;
    observation: ObservationData;
    stepHistory: Action[];
    attemptNumber?: number;
  }): Promise<Action> {
    const { instruction, observation, stepHistory } = context;

    // On first call, detect intent and potentially use pre-planned actions
    if (stepHistory.length === 0) {
      const intent = this.intentDetector.detectIntent(instruction);
      this.intentDetector.logIntent(instruction, intent);

      if (this.intentDetector.shouldUsePlan(intent)) {
        logger.info('Using pre-planned actions for intent', {
          intentType: intent.type,
          actionCount: intent.suggestedActions?.length || 0,
        });

        this.plannedActions = intent.suggestedActions || [];
        this.planIndex = 0;
      }
    }

    // If we have pre-planned actions, use them
    if (this.planIndex < this.plannedActions.length) {
      const action = this.plannedActions[this.planIndex];
      this.planIndex++;

      logger.info('Using pre-planned action', {
        step: this.planIndex,
        total: this.plannedActions.length,
        type: action.type,
      });

      return action;
    }

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

    // If a pre-planned action failed, switch to LLM planning
    if (this.planIndex > 0 && this.planIndex <= this.plannedActions.length) {
      logger.warn('Pre-planned action failed, switching to LLM planning', {
        failedAction: action.type,
        remainingPlannedActions: this.plannedActions.length - this.planIndex,
      });
      this.plannedActions = [];
      this.planIndex = 0;
    }
  }

  clearCache() {
    this.cache.clear();
  }

  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Check if there are remaining pre-planned actions to execute
   */
  hasRemainingActions(): boolean {
    return this.planIndex < this.plannedActions.length;
  }

  /**
   * Get count of remaining pre-planned actions
   */
  getRemainingActionCount(): number {
    return Math.max(0, this.plannedActions.length - this.planIndex);
  }
}
