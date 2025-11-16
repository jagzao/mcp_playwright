import { Action, ObservationData, TaskContext } from '../../../lib/types/index.js';
import { llmManager } from '../../../console-client/src/llm/index.js';
import { logger } from '../../../lib/observability/logger.js';

export class LLMPlanner {
  async planNextAction(context: {
    instruction: string;
    currentUrl?: string;
    observation: ObservationData;
    stepHistory: Action[];
    attemptNumber?: number;
  }): Promise<Action> {
    const { instruction, currentUrl, observation, stepHistory, attemptNumber = 1 } = context;

    // Build prompt for LLM
    const prompt = this.buildPrompt(instruction, currentUrl, observation, stepHistory, attemptNumber);

    logger.debug('Planning next action', {
      instruction,
      stepNumber: stepHistory.length + 1,
      elementCount: observation.elements.length,
    });

    try {
      const response = await llmManager.generate(prompt, {
        temperature: 0.1,
        maxTokens: 500,
      });

      // Parse LLM response to extract action
      const action = this.parseAction(response.text);

      logger.info('Action planned', {
        type: action.type,
        selector: action.selector,
        llm: response.model,
        cached: response.cached,
      });

      return action;
    } catch (error: any) {
      logger.error('Planning failed', { error: error.message });
      throw new Error(`Failed to plan next action: ${error.message}`);
    }
  }

  private buildPrompt(
    instruction: string,
    currentUrl: string | undefined,
    observation: ObservationData,
    stepHistory: Action[],
    attemptNumber: number
  ): string {
    const parts = [];

    parts.push('You are a web automation agent. Your task is to complete the following instruction:');
    parts.push(`\nInstruction: ${instruction}`);

    if (currentUrl) {
      parts.push(`\nCurrent URL: ${currentUrl}`);
    }

    if (stepHistory.length > 0) {
      parts.push('\nSteps completed so far:');
      stepHistory.slice(-3).forEach((action, i) => {
        parts.push(`${i + 1}. ${action.type} ${action.selector || action.url || ''}`);
      });
    }

    parts.push('\nPage observation:');
    parts.push(this.formatObservation(observation));

    if (attemptNumber > 1) {
      parts.push(`\n(This is attempt #${attemptNumber} - previous attempt failed)`);
    }

    parts.push('\nWhat should be the next action? Respond in JSON format:');
    parts.push('{');
    parts.push('  "type": "navigate|click|fill|wait|screenshot",');
    parts.push('  "selector": "CSS selector (if applicable)",');
    parts.push('  "value": "value to fill (if type is fill)",');
    parts.push('  "url": "URL to navigate (if type is navigate)",');
    parts.push('  "reasoning": "brief explanation of why this action"');
    parts.push('}');

    return parts.join('\n');
  }

  private formatObservation(observation: ObservationData): string {
    if (observation.elements.length === 0) {
      return 'No interactive elements found on the page.';
    }

    const parts = [];
    parts.push(`Found ${observation.elements.length} interactive elements:`);

    // Group by type
    const byType = observation.elements.reduce((acc, el) => {
      if (!acc[el.type]) acc[el.type] = [];
      acc[el.type].push(el);
      return acc;
    }, {} as Record<string, typeof observation.elements>);

    Object.entries(byType).forEach(([type, elements]) => {
      parts.push(`\n${type}s:`);
      elements.slice(0, 5).forEach(el => {
        const label = el.label || el.placeholder || 'unlabeled';
        parts.push(`  - "${label}" (selector: ${el.selector})`);
      });
      if (elements.length > 5) {
        parts.push(`  ... and ${elements.length - 5} more`);
      }
    });

    return parts.join('\n');
  }

  private parseAction(llmResponse: string): Action {
    try {
      // Try to extract JSON from the response
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in LLM response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate required fields
      if (!parsed.type) {
        throw new Error('Action type is required');
      }

      const action: Action = {
        type: parsed.type,
      };

      if (parsed.selector) action.selector = parsed.selector;
      if (parsed.value) action.value = parsed.value;
      if (parsed.url) action.url = parsed.url;
      if (parsed.timeout) action.timeout = parsed.timeout;

      return action;
    } catch (error: any) {
      logger.error('Failed to parse LLM response', {
        response: llmResponse,
        error: error.message,
      });

      // Fallback: try to extract action from natural language
      return this.fallbackParse(llmResponse);
    }
  }

  private fallbackParse(text: string): Action {
    const lower = text.toLowerCase();

    // Simple heuristics
    if (lower.includes('click')) {
      return { type: 'click', selector: 'button' };
    }

    if (lower.includes('navigate') || lower.includes('go to')) {
      return { type: 'navigate', url: 'about:blank' };
    }

    if (lower.includes('fill') || lower.includes('type')) {
      return { type: 'fill', selector: 'input', value: '' };
    }

    if (lower.includes('wait')) {
      return { type: 'wait', selector: '*', timeout: 5000 };
    }

    // Default: wait
    return { type: 'wait', timeout: 2000 };
  }
}
