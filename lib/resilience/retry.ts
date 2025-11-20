import { RetryConfig } from '../types/index.js';

export class IntelligentRetry {
  async executeWithRetry<T>(
    action: () => Promise<T>,
    config: RetryConfig = {}
  ): Promise<T> {
    const {
      maxAttempts = 3,
      backoffStrategy = 'exponential',
      retryableErrors = ['timeout', 'network', 'rate-limit'],
      onRetry = () => {},
    } = config;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await action();
      } catch (error: any) {
        // No reintentar si no es un error recuperable
        if (!this.isRetryable(error, retryableErrors)) {
          throw error;
        }

        if (attempt === maxAttempts) {
          throw new Error(`Failed after ${maxAttempts} attempts: ${error.message}`);
        }

        // Calcular delay
        const delay = this.calculateDelay(attempt, backoffStrategy);

        onRetry(attempt, error);
        console.log(`🔄 Retry ${attempt}/${maxAttempts} in ${delay}ms...`);

        await this.sleep(delay);
      }
    }

    throw new Error('Should never reach here');
  }

  private calculateDelay(attempt: number, strategy: string): number {
    switch (strategy) {
      case 'exponential':
        return Math.min(1000 * Math.pow(2, attempt), 30000); // Max 30s
      case 'linear':
        return 1000 * attempt;
      case 'fibonacci':
        return 1000 * this.fibonacci(attempt);
      default:
        return 1000;
    }
  }

  private fibonacci(n: number): number {
    if (n <= 1) return n;
    let a = 0, b = 1;
    for (let i = 2; i <= n; i++) {
      [a, b] = [b, a + b];
    }
    return b;
  }

  private isRetryable(error: any, retryableErrors: string[]): boolean {
    const errorType = this.classifyError(error);
    return retryableErrors.includes(errorType);
  }

  private classifyError(error: any): string {
    const errorMessage = error.message?.toLowerCase() || '';

    if (error.name === 'TimeoutError' || errorMessage.includes('timeout')) return 'timeout';
    if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || errorMessage.includes('network')) return 'network';
    if (error.status === 429 || errorMessage.includes('rate limit')) return 'rate-limit';
    if (error.status >= 500) return 'server-error';

    // Additional error types for Playwright
    if (errorMessage.includes('not found') || errorMessage.includes('no element')) return 'not-found';
    if (errorMessage.includes('detached') || errorMessage.includes('detached from frame')) return 'detached';
    if (errorMessage.includes('navigation') || errorMessage.includes('navigating')) return 'navigation';

    return 'unknown';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const retry = new IntelligentRetry();
