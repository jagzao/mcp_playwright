import { QwenClient, OllamaClient, LLMClient } from "./llm-clients.js";
import { FallbackManager } from "./fallback-manager.js";
import { scheduler } from "./scheduler.js";
import { config } from "../../../lib/config/index.js";

// Initialize LLM clients
const clients = new Map<string, LLMClient>();

// Qwen client (primary)
clients.set("qwen", new QwenClient("qwen:7b", config.llm.ollamaEndpoint));

// Ollama clients (fallback)
clients.set(
  "deepseek",
  new OllamaClient("deepseek-coder:6.7b", config.llm.ollamaEndpoint)
);
clients.set(
  "codellama",
  new OllamaClient("codellama:7b", config.llm.ollamaEndpoint)
);

// Create fallback manager
export const llmManager = new FallbackManager(clients, scheduler);

// Export for direct access if needed
export { clients, scheduler };
