import { describe, it, expect, vi } from 'vitest';
import { IntelligentRetry } from '../../lib/resilience/retry.js';

describe('IntelligentRetry', () => {
  const retry = new IntelligentRetry();

  it('should succeed on first attempt', async () => {
    const mockAction = vi.fn().mockResolvedValue('success');

    const result = await retry.executeWithRetry(mockAction, { maxAttempts: 3 });

    expect(result).toBe('success');
    expect(mockAction).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure', async () => {
    const mockAction = vi
      .fn()
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValue('success');

    const result = await retry.executeWithRetry(mockAction, {
      maxAttempts: 3,
      retryableErrors: ['timeout'],
    });

    expect(result).toBe('success');
    expect(mockAction).toHaveBeenCalledTimes(2);
  });

  it('should not retry non-retryable errors', async () => {
    const mockAction = vi.fn().mockRejectedValue(new Error('Fatal error'));

    await expect(
      retry.executeWithRetry(mockAction, {
        maxAttempts: 3,
        retryableErrors: ['timeout'],
      })
    ).rejects.toThrow('Fatal error');

    expect(mockAction).toHaveBeenCalledTimes(1);
  });
});
