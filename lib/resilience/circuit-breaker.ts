import { CircuitBreakerConfig } from '../types/index.js';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime?: number;

  constructor(private config: CircuitBreakerConfig) {}

  async execute<T>(action: () => Promise<T>): Promise<T> {
    // Si está abierto, no ejecutar
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime! < this.config.timeout) {
        throw new Error('Circuit breaker is OPEN');
      }
      // Intentar medio-abrir
      this.state = 'HALF_OPEN';
      console.log('🔄 Circuit breaker transitioning to HALF_OPEN');
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failureCount = 0;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'CLOSED';
        this.successCount = 0;
        console.log('✅ Circuit breaker CLOSED (recovered)');
      }
    }
  }

  private onFailure() {
    this.failureCount++;
    this.successCount = 0;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'OPEN';
      console.log('⚠️  Circuit breaker OPEN (too many failures)');
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = undefined;
  }
}
