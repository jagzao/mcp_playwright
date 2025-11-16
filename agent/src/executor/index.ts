import { Action, ActionResult } from '../../../lib/types/index.js';
import { MCPExecutor } from './mcp-executor.js';
import { SelfHealingExecutor } from './self-healing.js';
import { logger } from '../../../lib/observability/logger.js';

export class ActionExecutor {
  private mcpExecutor: MCPExecutor;
  private selfHealingExecutor: SelfHealingExecutor;
  private connected: boolean = false;

  constructor() {
    this.mcpExecutor = new MCPExecutor();
    this.selfHealingExecutor = new SelfHealingExecutor(this.mcpExecutor);
  }

  async connect() {
    if (!this.connected) {
      await this.mcpExecutor.connect();
      this.connected = true;
    }
  }

  async disconnect() {
    if (this.connected) {
      await this.mcpExecutor.disconnect();
      this.connected = false;
    }
  }

  async execute(action: Action, useSelfHealing = true): Promise<ActionResult> {
    if (!this.connected) {
      throw new Error('Executor not connected. Call connect() first.');
    }

    logger.debug('Executing action', { type: action.type, useSelfHealing });

    if (useSelfHealing) {
      return await this.selfHealingExecutor.execute(action);
    } else {
      return await this.mcpExecutor.execute(action);
    }
  }

  async verify(action: Action, expectedResult: any): Promise<boolean> {
    // Simple verification for now
    // Could be extended to check actual page state
    return true;
  }

  async callVisionTool(toolName: string): Promise<any> {
    if (!this.connected) {
      throw new Error('Executor not connected. Call connect() first.');
    }

    return await this.mcpExecutor.callVisionTool(toolName);
  }
}
