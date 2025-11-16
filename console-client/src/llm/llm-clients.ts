import { llmConfig } from '../../../lib/config/index.js';
import { TimeUtils } from '../../../lib/utils/time-utils.js';
import { resourceMonitor } from '../../../lib/utils/resource-monitor.js';
import { logger } from '../../../lib/observability/logger.js';

export interface LLMResponse {
  text: string;
  model: string;
  cached: boolean;
  cost: number;
  tokensUsed?: number;
}

export interface LLMClient {
  generate(prompt: string, options?: any): Promise<LLMResponse>;
  isAvailable(): Promise<boolean>;
  name: string;
}

export class QwenClient implements LLMClient {
  name = 'qwen';
  private endpoint: string;

  constructor(endpoint: string = 'http://localhost:8000') {
    this.endpoint = endpoint;
  }

  async generate(prompt: string, options: any = {}): Promise<LLMResponse> {
    const { temperature = 0.1, maxTokens = 2000 } = options;

    try {
      const response = await fetch(`${this.endpoint}/v1/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen2.5-coder',
          prompt,
          temperature,
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        throw new Error(`Qwen API error: ${response.status}`);
      }

      const data = await response.json();

      return {
        text: data.choices[0].text,
        model: 'qwen2.5-coder',
        cached: false,
        cost: 0,
        tokensUsed: data.usage?.total_tokens,
      };
    } catch (error: any) {
      logger.error('Qwen generation failed', { error: error.message });
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export class OllamaClient implements LLMClient {
  name: string;
  private endpoint: string;
  private model: string;

  constructor(model: string = 'deepseek-coder:6.7b', endpoint: string = 'http://localhost:11434') {
    this.name = model.split(':')[0];
    this.endpoint = endpoint;
    this.model = model;
  }

  async generate(prompt: string, options: any = {}): Promise<LLMResponse> {
    const { temperature = 0.1 } = options;

    try {
      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          temperature,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const data = await response.json();

      return {
        text: data.response,
        model: this.model,
        cached: false,
        cost: 0,
      };
    } catch (error: any) {
      logger.error('Ollama generation failed', { model: this.model, error: error.message });
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) return false;

      const data = await response.json();
      return data.models?.some((m: any) => m.name === this.model);
    } catch {
      return false;
    }
  }
}
