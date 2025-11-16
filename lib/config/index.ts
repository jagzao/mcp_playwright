import { readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Load configuration files
const loadConfig = <T>(filename: string): T => {
  const path = join(process.cwd(), 'config', filename);
  return JSON.parse(readFileSync(path, 'utf-8'));
};

export const llmConfig = loadConfig<any>('llm-config.json');
export const agentConfig = loadConfig<any>('agent-config.json');
export const resourceLimits = loadConfig<any>('resource-limits.json');

export const config = {
  env: process.env.NODE_ENV || 'development',

  llm: {
    qwenEndpoint: process.env.QWEN_ENDPOINT || 'http://localhost:8000',
    ollamaEndpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
  },

  security: {
    masterKey: process.env.MASTER_KEY || '',
    webhookSecret: process.env.WEBHOOK_SECRET || '',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    wsPort: parseInt(process.env.WS_PORT || '8080', 10),
  },

  notifications: {
    email: process.env.NOTIFICATION_EMAIL,
    slackWebhook: process.env.SLACK_WEBHOOK_URL,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  paths: {
    data: join(process.cwd(), 'data'),
    sessions: join(process.cwd(), 'data', 'sessions'),
    recordings: join(process.cwd(), 'recordings'),
    videos: join(process.cwd(), 'data', 'videos'),
    screenshots: join(process.cwd(), 'data', 'screenshots'),
    logs: join(process.cwd(), 'logs'),
    backups: join(process.cwd(), 'backups'),
  },
};

// Validate critical configuration
export function validateConfig() {
  const errors: string[] = [];

  if (!config.security.masterKey || config.security.masterKey.length < 32) {
    errors.push('MASTER_KEY must be at least 32 characters. Set it in .env file.');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}
