import { Action, ActionResult } from "../../../lib/types/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { logger } from "../../../lib/observability/logger.js";
import { retry } from "../../../lib/resilience/retry.js";
import { metrics } from "../../../lib/observability/metrics.js";
import { TimeUtils } from "../../../lib/utils/time-utils.js";

export class MCPExecutor {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  async connect() {
    if (this.client) {
      return; // Already connected
    }

    try {
      // Create MCP client
      this.client = new Client(
        {
          name: "mcp-playwright-agent-client",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      // Connect to MCP server via stdio
      this.transport = new StdioClientTransport({
        command: "node",
        args: ["dist/mcp-server/src/index.js"],
      });

      await this.client.connect(this.transport);

      logger.info("Connected to MCP server");
    } catch (error: any) {
      logger.error("Failed to connect to MCP server", { error: error.message });
      throw error;
    }
  }

  async disconnect() {
    if (this.client && this.transport) {
      await this.client.close();
      this.client = null;
      this.transport = null;
      logger.info("Disconnected from MCP server");
    }
  }

  async execute(action: Action): Promise<ActionResult> {
    if (!this.client) {
      throw new Error("MCP client not connected. Call connect() first.");
    }

    const start = Date.now();

    try {
      logger.info("Executing action", {
        type: action.type,
        selector: action.selector,
        url: action.url,
      });

      // Add human-like delay
      await this.humanDelay();

      // Use more aggressive retry for login-related actions
      const isLoginAction = this.isLoginRelatedAction(action);
      const retryConfig = isLoginAction
        ? {
            maxAttempts: 4, // More attempts for login
            backoffStrategy: "exponential" as const,
            retryableErrors: ["timeout", "network", "not-found", "detached"],
          }
        : {
            maxAttempts: 2,
            backoffStrategy: "linear" as const,
            retryableErrors: ["timeout", "network"],
          };

      const result = await retry.executeWithRetry(
        async () => {
          return await this.executeWithMCP(action);
        },
        retryConfig
      );

      const duration = Date.now() - start;

      metrics.recordAction(action.type);

      logger.info("Action executed successfully", {
        type: action.type,
        duration,
      });

      return {
        success: true,
        duration,
        data: result,
      };
    } catch (error: any) {
      const duration = Date.now() - start;

      logger.error("Action execution failed", {
        type: action.type,
        error: error.message,
        duration,
      });

      metrics.recordError(action.type);

      return {
        success: false,
        error: error.message,
        duration,
      };
    }
  }

  /**
   * Call a vision tool to get page state
   */
  async callVisionTool(toolName: string): Promise<any> {
    if (!this.client) {
      throw new Error("MCP client not connected. Call connect() first.");
    }

    try {
      const result = await this.client.callTool({
        name: toolName,
        arguments: {},
      });

      if (
        !result.content ||
        !Array.isArray(result.content) ||
        result.content.length === 0
      ) {
        throw new Error("No response from MCP vision tool");
      }

      const content = result.content[0];
      if (content.type === "text") {
        const parsed = JSON.parse((content as any).text);
        if (!parsed.success) {
          throw new Error(parsed.error || "Vision tool execution failed");
        }
        return parsed;
      }

      throw new Error("Unexpected response format from MCP vision tool");
    } catch (error: any) {
      logger.error("Vision tool call failed", {
        toolName,
        error: error.message,
      });
      throw error;
    }
  }

  private async executeWithMCP(action: Action): Promise<any> {
    const toolName = this.getToolName(action.type);
    const args = this.getToolArgs(action);

    const result = await this.client!.callTool({
      name: toolName,
      arguments: args,
    });

    if (
      !result.content ||
      !Array.isArray(result.content) ||
      result.content.length === 0
    ) {
      throw new Error("No response from MCP tool");
    }

    const content = result.content[0];
    if (content.type === "text") {
      const parsed = JSON.parse((content as any).text);
      if (!parsed.success) {
        throw new Error(parsed.error || "Tool execution failed");
      }
      return parsed;
    }

    throw new Error("Unexpected response format from MCP tool");
  }

  private getToolName(actionType: string): string {
    const mapping: Record<string, string> = {
      navigate: "playwright_navigate",
      click: "playwright_click",
      fill: "playwright_fill",
      screenshot: "playwright_screenshot",
      wait: "playwright_wait_for",
      scroll: "playwright_scroll",
      select: "playwright_select",
    };

    const toolName = mapping[actionType];
    if (!toolName) {
      throw new Error(`Unknown action type: ${actionType}`);
    }

    return toolName;
  }

  private getToolArgs(action: Action): any {
    switch (action.type) {
      case "navigate":
        return {
          url: action.url,
          waitUntil: "load",
        };

      case "click":
        return {
          selector: action.selector,
          timeout: action.timeout || 30000,
        };

      case "fill":
        let fillValue = action.value;

        // Replace environment variables in fill values
        if (fillValue && fillValue.includes("${LINKEDIN_EMAIL}")) {
          fillValue = fillValue.replace(
            "${LINKEDIN_EMAIL}",
            process.env.LINKEDIN_EMAIL || ""
          );
        }
        if (fillValue && fillValue.includes("${LINKEDIN_PASSWORD}")) {
          fillValue = fillValue.replace(
            "${LINKEDIN_PASSWORD}",
            process.env.LINKEDIN_PASSWORD || ""
          );
        }

        return {
          selector: action.selector,
          value: fillValue,
          timeout: action.timeout || 30000,
        };

      case "screenshot":
        return {
          path: action.path || action.value || "screenshot.png",
          fullPage: false,
        };

      case "wait":
        return {
          selector: action.selector || "*",
          timeout: action.timeout || 5000,
          state: "visible",
        };

      default:
        return {};
    }
  }

  private isLoginRelatedAction(action: Action): boolean {
    // Check if action is related to login
    if (action.value?.includes("${LINKEDIN_EMAIL}") || action.value?.includes("${LINKEDIN_PASSWORD}")) {
      return true;
    }

    const loginSelectors = [
      "#username", "#password", "#session_key", "#session_password",
      "input[name=session_key]", "input[name=session_password]",
      ".sign-in-form__submit-button", ".login__form_action_container"
    ];

    if (action.selector && loginSelectors.some(s => action.selector?.includes(s))) {
      return true;
    }

    if (action.url?.includes("/login")) {
      return true;
    }

    return false;
  }

  private async humanDelay() {
    // Add random delay between actions to appear more human
    const min = 100;
    const max = 300;
    await TimeUtils.randomDelay(min, max);
  }
}
