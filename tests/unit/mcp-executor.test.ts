import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPExecutor } from '../../agent/src/executor/mcp-executor.js';
import { Action } from '../../lib/types/index.js';

describe('MCPExecutor', () => {
  let executor: MCPExecutor;

  beforeEach(async () => {
    executor = new MCPExecutor();
  });

  afterEach(async () => {
    await executor.disconnect();
  });

  describe('execute', () => {
    it('should throw error if not connected', async () => {
      const action: Action = { type: 'navigate', url: 'https://example.com' };

      await expect(executor.execute(action)).rejects.toThrow(
        'MCP client not connected'
      );
    });

    it('should add human-like delay between actions', async () => {
      // This test verifies that the humanDelay method is called
      const startTime = Date.now();

      await executor.connect();
      const action: Action = { type: 'wait', timeout: 1000 };
      await executor.execute(action);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should take at least 100ms (minimum humanDelay) + action time
      expect(duration).toBeGreaterThan(100);
    }, 20000);
  });

  describe('getToolName', () => {
    it('should map action types to correct tool names', () => {
      const testCases = [
        { actionType: 'navigate', expectedTool: 'playwright_navigate' },
        { actionType: 'click', expectedTool: 'playwright_click' },
        { actionType: 'fill', expectedTool: 'playwright_fill' },
        { actionType: 'screenshot', expectedTool: 'playwright_screenshot' },
        { actionType: 'wait', expectedTool: 'playwright_wait_for' },
      ];

      testCases.forEach(({ actionType, expectedTool }) => {
        const toolName = (executor as any).getToolName(actionType);
        expect(toolName).toBe(expectedTool);
      });
    });

    it('should throw error for unknown action type', () => {
      expect(() => (executor as any).getToolName('unknown')).toThrow(
        'Unknown action type'
      );
    });
  });

  describe('getToolArgs', () => {
    it('should handle navigate action args', () => {
      const action: Action = { type: 'navigate', url: 'https://example.com' };
      const args = (executor as any).getToolArgs(action);

      expect(args).toEqual({
        url: 'https://example.com',
        waitUntil: 'load',
      });
    });

    it('should handle fill action with environment variables', () => {
      process.env.LINKEDIN_EMAIL = 'test@example.com';
      process.env.LINKEDIN_PASSWORD = 'testpassword';

      const action: Action = {
        type: 'fill',
        selector: '#email',
        value: '${LINKEDIN_EMAIL}',
      };

      const args = (executor as any).getToolArgs(action);
      expect(args.value).toBe('test@example.com');
    });

    it('should handle screenshot action with default path', () => {
      const action: Action = { type: 'screenshot' };
      const args = (executor as any).getToolArgs(action);

      expect(args.path).toBe('screenshot.png');
    });
  });
});
