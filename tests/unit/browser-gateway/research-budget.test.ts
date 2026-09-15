import { describe, expect, it } from 'vitest';
import {
  defaultBudget,
  firstBottleneck,
  reasonForKey,
  type BudgetUsage,
  type ResearchBudget,
} from '../../../lib/browser-gateway/application/research-budget.js';

function usage(partial: Partial<BudgetUsage> = {}): BudgetUsage {
  return { searchRequests: 0, pagesRead: 0, modelCalls: 0, screenshots: 0, costUsd: 0, ...partial };
}

describe('research-budget (US-003 / AC15)', () => {
  it('returns deterministic per-mode default envelopes', () => {
    expect(defaultBudget('quick')).toEqual({ maxSearchRequests: 2, maxPagesRead: 3, maxModelCalls: 4, maxScreenshots: 0, maxCostUsd: 0.5 });
    expect(defaultBudget('standard')).toEqual({ maxSearchRequests: 8, maxPagesRead: 12, maxModelCalls: 14, maxScreenshots: 1, maxCostUsd: 1.0 });
    expect(defaultBudget('deep')).toEqual({ maxSearchRequests: 30, maxPagesRead: 40, maxModelCalls: 20, maxScreenshots: 3, maxCostUsd: 2.0 });
  });

  it('reports no bottleneck while usage is below every dimension', () => {
    expect(firstBottleneck(defaultBudget('standard'), usage())).toBeUndefined();
  });

  it('flags each dimension independently as it is reached', () => {
    const budget: ResearchBudget = { maxSearchRequests: 1, maxPagesRead: 1, maxModelCalls: 1, maxScreenshots: 5, maxCostUsd: 1 };
    expect(firstBottleneck(budget, usage({ searchRequests: 1 }))).toBe('search_requests');
    expect(firstBottleneck(budget, usage({ pagesRead: 1 }))).toBe('pages_read');
    expect(firstBottleneck(budget, usage({ modelCalls: 1 }))).toBe('model_calls');
  });

  it('flags cost exhaustion when cost ceiling is hit but other budgets are untouched', () => {
    const budget: ResearchBudget = { maxSearchRequests: 10, maxPagesRead: 10, maxModelCalls: 10, maxScreenshots: 5, maxCostUsd: 0.5 };
    expect(firstBottleneck(budget, usage({ costUsd: 0.5 }))).toBe('cost');
  });

  it('maps budget keys to typed depletion reasons', () => {
    expect(reasonForKey('searchRequests')).toBe('search_requests');
    expect(reasonForKey('pagesRead')).toBe('pages_read');
    expect(reasonForKey('modelCalls')).toBe('model_calls');
    expect(reasonForKey('screenshots')).toBe('screenshots');
    expect(reasonForKey('costUsd')).toBe('cost');
  });

  it('budget exhaustion is deterministic — a consumed envelope never frees up', () => {
    const budget: ResearchBudget = { maxSearchRequests: 2, maxPagesRead: 5, maxModelCalls: 5, maxScreenshots: 5, maxCostUsd: 1 };
    const afterOne = usage({ searchRequests: 1 });
    expect(firstBottleneck(budget, afterOne)).toBeUndefined();
    const afterTwo = { ...afterOne, searchRequests: 2 };
    expect(firstBottleneck(budget, afterTwo)).toBe('search_requests');
  });
});
