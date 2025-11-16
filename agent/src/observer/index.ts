import { ObservationData } from '../../../lib/types/index.js';
import { AccessibilityObserver } from './accessibility-observer.js';
import { DOMObserver } from './dom-observer.js';
import { logger } from '../../../lib/observability/logger.js';
import { agentConfig } from '../../../lib/config/index.js';

export class HybridObserver {
  private a11yObserver: AccessibilityObserver;
  private domObserver: DOMObserver;

  constructor() {
    this.a11yObserver = new AccessibilityObserver();
    this.domObserver = new DOMObserver();
  }

  /**
   * Observe page using best available method
   * Strategy: Try accessibility first (fast), fall back to DOM if needed
   */
  async observe(pageData: {
    accessibility?: any;
    dom?: any;
    screenshot?: Buffer;
  }): Promise<ObservationData> {
    const config = agentConfig.agent.observation;

    // Try accessibility tree first (fastest and free)
    if (pageData.accessibility) {
      try {
        const a11yData = await this.a11yObserver.observe(pageData.accessibility);

        if (!this.a11yObserver.isEmpty(a11yData)) {
          logger.info('Using accessibility observation', {
            elementCount: a11yData.elements.length,
          });
          return a11yData;
        }

        logger.debug('Accessibility tree empty, trying DOM');
      } catch (error: any) {
        logger.warn('Accessibility observation failed', { error: error.message });
      }
    }

    // Fallback to DOM parsing
    if (pageData.dom) {
      try {
        const domData = await this.domObserver.observe(pageData.dom);

        if (!this.domObserver.isEmpty(domData)) {
          logger.info('Using DOM observation', {
            elementCount: domData.elements.length,
          });
          return domData;
        }

        logger.debug('DOM parsing empty');
      } catch (error: any) {
        logger.warn('DOM observation failed', { error: error.message });
      }
    }

    // Last resort: return empty observation
    logger.warn('All observation methods failed or returned empty');
    return {
      method: 'accessibility',
      elements: [],
      cost: 0,
      speed: 'fast',
    };
  }

  /**
   * Determine if we have enough data to proceed
   */
  isSufficient(data: ObservationData): boolean {
    // We need at least one interactive element
    return data.elements.length > 0;
  }

  /**
   * Get a summary of the observation for the LLM
   */
  summarize(data: ObservationData): string {
    const summary = [];

    summary.push(`Observation method: ${data.method}`);
    summary.push(`Interactive elements found: ${data.elements.length}`);

    if (data.elements.length > 0) {
      summary.push('\nElements:');

      // Group by type
      const byType = data.elements.reduce((acc, el) => {
        if (!acc[el.type]) acc[el.type] = [];
        acc[el.type].push(el);
        return acc;
      }, {} as Record<string, typeof data.elements>);

      Object.entries(byType).forEach(([type, elements]) => {
        summary.push(`\n${type}s (${elements.length}):`);
        elements.slice(0, 5).forEach(el => {
          const label = el.label || el.placeholder || el.selector;
          summary.push(`  - ${label} (${el.selector})`);
        });
        if (elements.length > 5) {
          summary.push(`  ... and ${elements.length - 5} more`);
        }
      });
    }

    return summary.join('\n');
  }
}
