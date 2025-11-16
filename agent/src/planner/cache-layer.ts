import { Action, ObservationData } from '../../../lib/types/index.js';
import { logger } from '../../../lib/observability/logger.js';
import crypto from 'crypto';

interface CachedPlan {
  stateHash: string;
  instruction: string;
  action: Action;
  successCount: number;
  timestamp: number;
}

export class CacheLayer {
  private cache: Map<string, CachedPlan>;
  private maxSize: number;
  private ttl: number; // Time to live in milliseconds

  constructor(maxSize = 1000, ttlHours = 24) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttlHours * 60 * 60 * 1000;
  }

  /**
   * Try to get a cached action for the current state
   */
  get(instruction: string, observation: ObservationData): Action | null {
    const stateHash = this.hashState(instruction, observation);

    const cached = this.cache.get(stateHash);

    if (!cached) {
      return null;
    }

    // Check if expired
    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(stateHash);
      return null;
    }

    logger.info('Cache hit', {
      instruction: instruction.substring(0, 50),
      successCount: cached.successCount,
    });

    return cached.action;
  }

  /**
   * Store a successful action
   */
  set(instruction: string, observation: ObservationData, action: Action) {
    const stateHash = this.hashState(instruction, observation);

    const existing = this.cache.get(stateHash);

    const cached: CachedPlan = {
      stateHash,
      instruction,
      action,
      successCount: existing ? existing.successCount + 1 : 1,
      timestamp: Date.now(),
    };

    this.cache.set(stateHash, cached);

    // Cleanup old entries if cache is too large
    if (this.cache.size > this.maxSize) {
      this.cleanup();
    }

    logger.debug('Action cached', { stateHash, successCount: cached.successCount });
  }

  /**
   * Find similar cached state (fuzzy match)
   */
  findSimilar(instruction: string, observation: ObservationData, threshold = 0.9): Action | null {
    const currentHash = this.hashState(instruction, observation);

    for (const cached of this.cache.values()) {
      const similarity = this.calculateSimilarity(currentHash, cached.stateHash);

      if (similarity >= threshold) {
        logger.info('Similar cache hit', {
          similarity,
          successCount: cached.successCount,
        });

        return cached.action;
      }
    }

    return null;
  }

  private hashState(instruction: string, observation: ObservationData): string {
    // Create a hash of the current state
    const state = {
      instruction: instruction.toLowerCase().trim(),
      elementCount: observation.elements.length,
      elementTypes: [...new Set(observation.elements.map(e => e.type))].sort(),
      method: observation.method,
    };

    const stateStr = JSON.stringify(state);
    return crypto.createHash('sha256').update(stateStr).digest('hex');
  }

  private calculateSimilarity(hash1: string, hash2: string): number {
    // Simple similarity based on common prefix
    let common = 0;
    const minLen = Math.min(hash1.length, hash2.length);

    for (let i = 0; i < minLen; i++) {
      if (hash1[i] === hash2[i]) {
        common++;
      } else {
        break;
      }
    }

    return common / minLen;
  }

  private cleanup() {
    // Remove oldest entries
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = entries.slice(0, Math.floor(this.maxSize * 0.2)); // Remove 20%

    toRemove.forEach(([key]) => {
      this.cache.delete(key);
    });

    logger.debug('Cache cleanup', {
      removed: toRemove.length,
      remaining: this.cache.size,
    });
  }

  clear() {
    this.cache.clear();
    logger.info('Cache cleared');
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
    };
  }
}
