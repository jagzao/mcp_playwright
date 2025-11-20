import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentOrchestrator } from '../../agent/src/orchestrator/index.js';
import { AgentTask } from '../../lib/types/index.js';

describe('Agent Integration Flow', () => {
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    orchestrator = new AgentOrchestrator();
  });

  afterEach(async () => {
    // Cleanup if needed
  });

  it('should execute simple navigation task', async () => {
    const task: AgentTask = {
      instruction: 'Navigate to example.com and take a screenshot',
      maxSteps: 10,
    };

    const result = await orchestrator.executeTask(task);

    expect(result).toBeDefined();
    expect(result.stepsExecuted).toBeGreaterThan(0);
  }, 120000); // 120 second timeout for integration test

  it('should handle task with observation', async () => {
    const task: AgentTask = {
      instruction: 'Navigate to google.com and observe the page',
      maxSteps: 5,
    };

    const result = await orchestrator.executeTask(task);

    expect(result).toBeDefined();
    expect(result.success).toBeDefined();
    expect(result.duration).toBeGreaterThan(0);
  }, 120000);

  it('should stop after max steps', async () => {
    const task: AgentTask = {
      instruction: 'Do an impossible task that loops forever',
      maxSteps: 3,
    };

    const result = await orchestrator.executeTask(task);

    expect(result.stepsExecuted).toBeLessThanOrEqual(3);
  }, 120000);

  it('should track progress during execution', async () => {
    const progressUpdates: any[] = [];

    const task: AgentTask = {
      instruction: 'Navigate to example.com',
      maxSteps: 5,
      onProgress: (progress) => {
        progressUpdates.push(progress);
      },
    };

    await orchestrator.executeTask(task);

    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(progressUpdates[0]).toHaveProperty('status');
    expect(progressUpdates[0]).toHaveProperty('message');
    expect(progressUpdates[0]).toHaveProperty('stepNumber');
  }, 120000);

  it('should calculate cost correctly', async () => {
    const task: AgentTask = {
      instruction: 'Navigate to example.com',
      maxSteps: 5,
    };

    const result = await orchestrator.executeTask(task);

    expect(result.cost).toBeDefined();
    expect(result.cost).toBe(0); // Using local LLMs, cost should be 0
  }, 120000);
});
