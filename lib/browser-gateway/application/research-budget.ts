/**
 * Research budget envelopes (US-003 / AC15).
 *
 * Every research task gets a deterministic budget envelope. Exhaustion of any
 * dimension yields a typed `partial`/`blocked` outcome — never an unbounded
 * loop. Web content is untrusted input and can never expand these budgets.
 */

export type ResearchMode = 'quick' | 'standard' | 'deep';

export interface ResearchBudget {
  maxSearchRequests: number;
  maxPagesRead: number;
  maxModelCalls: number;
  maxScreenshots: number;
  /** Estimated USD ceiling, when a cost model is available. */
  maxCostUsd: number;
}

/** Budget usage counters. Strictly non-decreasing; never reset by content. */
export interface BudgetUsage {
  searchRequests: number;
  pagesRead: number;
  modelCalls: number;
  screenshots: number;
  costUsd: number;
}

export type BudgetDepletedReason =
  | 'search_requests'
  | 'pages_read'
  | 'model_calls'
  | 'screenshots'
  | 'cost';

/** Defaults per mode (configurable by project/intent via env or injection). */
export function defaultBudget(mode: ResearchMode): ResearchBudget {
  switch (mode) {
    case 'quick':
      return { maxSearchRequests: 2, maxPagesRead: 3, maxModelCalls: 4, maxScreenshots: 0, maxCostUsd: 0.5 };
    case 'standard':
      return { maxSearchRequests: 8, maxPagesRead: 12, maxModelCalls: 14, maxScreenshots: 1, maxCostUsd: 1.0 };
    case 'deep':
      return { maxSearchRequests: 30, maxPagesRead: 40, maxModelCalls: 20, maxScreenshots: 3, maxCostUsd: 2.0 };
  }
}

const REASON_BY_KEY: Array<[keyof BudgetUsage, BudgetDepletedReason]> = [
  ['searchRequests', 'search_requests'],
  ['pagesRead', 'pages_read'],
  ['modelCalls', 'model_calls'],
  ['screenshots', 'screenshots'],
  ['costUsd', 'cost'],
];

/** Which budget dimension would be exceeded by one more consumption. */
export function firstBottleneck(
  budget: ResearchBudget,
  usage: BudgetUsage,
): BudgetDepletedReason | undefined {
  if (usage.searchRequests >= budget.maxSearchRequests) return 'search_requests';
  if (usage.pagesRead >= budget.maxPagesRead) return 'pages_read';
  if (usage.modelCalls >= budget.maxModelCalls) return 'model_calls';
  if (usage.screenshots > budget.maxScreenshots) return 'screenshots';
  if (usage.costUsd >= budget.maxCostUsd) return 'cost';
  return undefined;
}

/** Convert a budget key to a deprecation reason (for typing when building outcomes). */
export function reasonForKey(key: keyof BudgetUsage): BudgetDepletedReason {
  for (const [k, reason] of REASON_BY_KEY) {
    if (k === key) return reason;
  }
  return 'cost';
}
