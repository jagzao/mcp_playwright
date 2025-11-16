#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../lib/observability/logger.js';
import { playwrightTools } from './tools/playwright/index.js';
import { visionTools } from './tools/vision/index.js';
import { dataTools } from './tools/data/index.js';

const server = new Server(
  {
    name: 'mcp-playwright-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Combine all tools
const allTools = [
  ...playwrightTools,
  ...visionTools,
  ...dataTools,
];

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const tool = allTools.find(t => t.name === toolName);

  if (!tool) {
    throw new Error(`Tool not found: ${toolName}`);
  }

  try {
    logger.info('Tool called', { tool: toolName, args: request.params.arguments });
    const result = await tool.execute(request.params.arguments || {});
    logger.info('Tool completed', { tool: toolName, success: true });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error: any) {
    logger.error('Tool failed', { tool: toolName, error: error.message });
    throw error;
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP Playwright server started');
}

main().catch((error) => {
  logger.error('Server error', { error: error.message });
  process.exit(1);
});
