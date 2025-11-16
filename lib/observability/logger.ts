import winston from 'winston';
import { config } from '../config/index.js';
import { mkdirSync, existsSync } from 'fs';

// Ensure logs directory exists
if (!existsSync(config.paths.logs)) {
  mkdirSync(config.paths.logs, { recursive: true });
}

const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'mcp-playwright-agent' },
  transports: [
    // Logs a archivo
    new winston.transports.File({
      filename: `${config.paths.logs}/error.log`,
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: `${config.paths.logs}/combined.log`,
      maxsize: 10485760,
      maxFiles: 10,
    }),
  ],
});

// Logs a consola en desarrollo
if (config.env !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    })
  );
}

export { logger };
