import { LLMClient, LLMResponse } from './llm-clients.js';
import { LLMScheduler } from './scheduler.js';
import { logger } from '../../../lib/observability/logger.js';
import { CircuitBreaker } from '../../../lib/resilience/circuit-breaker.js';
import { retry } from '../../../lib/resilience/retry.js';
import { metrics } from '../../../lib/observability/metrics.js';

export class FallbackManager {
  private clients: Map<string, LLMClient>;
  private scheduler: LLMScheduler;
  private circuitBreakers: Map<string, CircuitBreaker>;
  private cache: Map<string, LLMResponse>;
  private cacheEnabled: boolean;

  constructor(clients: Map<string, LLMClient>, scheduler: LLMScheduler) {
    this.clients = clients;
    this.scheduler = scheduler;
    this.circuitBreakers = new Map();
    this.cache = new Map();
    this.cacheEnabled = true;

    // Create circuit breakers for each client
    clients.forEach((client, name) => {
      this.circuitBreakers.set(
        name,
        new CircuitBreaker({
          failureThreshold: 3,
          successThreshold: 2,
          timeout: 60000, // 1 minute
        })
      );
    });
  }

  async generate(prompt: string, options: any = {}): Promise<LLMResponse> {
    // Check cache first
    const cacheKey = this.getCacheKey(prompt, options);
    if (this.cacheEnabled && this.cache.has(cacheKey)) {
      logger.info('Cache hit', { prompt: prompt.substring(0, 50) });
      metrics.recordLLMCall(true);
      const cached = this.cache.get(cacheKey)!;
      return { ...cached, cached: true };
    }

    // Get prioritized available LLMs
    const availableLLMs = this.scheduler.getPrioritizedLLMs(this.clients);

    if (availableLLMs.length === 0) {
      throw new Error('No LLMs available at this time');
    }

    // Try each LLM in order
    let lastError: Error | null = null;

    for (const client of availableLLMs) {
      const circuitBreaker = this.circuitBreakers.get(client.name)!;

      // Skip if circuit breaker is open
      if (circuitBreaker.getState() === 'OPEN') {
        logger.warn('Circuit breaker open, skipping', { llm: client.name });
        continue;
      }

      try {
        logger.info('Attempting LLM generation', {
          llm: client.name,
          promptLength: prompt.length,
        });

        const response = await circuitBreaker.execute(async () => {
          return await retry.executeWithRetry(
            () => client.generate(prompt, options),
            {
              maxAttempts: 2,
              backoffStrategy: 'linear',
              retryableErrors: ['timeout', 'network'],
            }
          );
        });

        logger.info('LLM generation successful', {
          llm: client.name,
          responseLength: response.text.length,
        });

        // Cache the response
        if (this.cacheEnabled) {
          this.cache.set(cacheKey, response);
        }

        metrics.recordLLMCall(false);

        return response;
      } catch (error: any) {
        lastError = error;
        logger.warn('LLM generation failed, trying next', {
          llm: client.name,
          error: error.message,
        });
        continue;
      }
    }

    // All LLMs failed
    throw new Error(`All LLMs failed. Last error: ${lastError?.message}`);
  }

  async checkHealth(): Promise<Map<string, boolean>> {
    const health = new Map<string, boolean>();

    const checks = Array.from(this.clients.entries()).map(async ([name, client]) => {
      try {
        const available = await client.isAvailable();
        health.set(name, available);
      } catch {
        health.set(name, false);
      }
    });

    await Promise.all(checks);

    return health;
  }

  private getCacheKey(prompt: string, options: any): string {
    const optionsStr = JSON.stringify(options);
    return `${prompt}:${optionsStr}`;
  }

  clearCache() {
    this.cache.clear();
    logger.info('LLM cache cleared');
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      enabled: this.cacheEnabled,
    };
  }

  disableCache() {
    this.cacheEnabled = false;
  }

  enableCache() {
    this.cacheEnabled = true;
  }
}
