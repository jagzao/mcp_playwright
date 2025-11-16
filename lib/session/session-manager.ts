import { Page } from 'playwright';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { SecretsManager } from '../security/secrets-manager.js';
import { logger } from '../observability/logger.js';
import { SessionData } from '../types/index.js';
import { config } from '../config/index.js';

export class SessionManager {
  private secretsManager: SecretsManager;
  private sessionsDir: string;

  constructor(masterKey: string) {
    this.secretsManager = new SecretsManager(masterKey);
    this.sessionsDir = config.paths.sessions;

    // Ensure sessions directory exists
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Save current browser session (cookies + localStorage)
   */
  async saveSession(page: Page, sessionName: string): Promise<void> {
    try {
      logger.info('Saving session', { sessionName });

      // Get cookies from browser context
      const cookies = await page.context().cookies();

      // Get localStorage from page
      const localStorage = await page.evaluate(() => {
        return JSON.stringify(window.localStorage);
      });

      const sessionData: SessionData = {
        cookies,
        localStorage,
        timestamp: Date.now(),
      };

      // Encrypt session data
      const encrypted = this.secretsManager.encrypt(sessionData);

      // Save to file
      const sessionPath = join(this.sessionsDir, `${sessionName}.session`);
      writeFileSync(sessionPath, encrypted, 'utf-8');

      logger.info('Session saved successfully', {
        sessionName,
        path: sessionPath,
        cookieCount: cookies.length,
      });
    } catch (error: any) {
      logger.error('Failed to save session', {
        sessionName,
        error: error.message,
      });
      throw new Error(`Failed to save session: ${error.message}`);
    }
  }

  /**
   * Restore a previously saved session
   */
  async restoreSession(page: Page, sessionName: string): Promise<boolean> {
    try {
      const sessionPath = join(this.sessionsDir, `${sessionName}.session`);

      if (!existsSync(sessionPath)) {
        logger.warn('Session file not found', { sessionName, path: sessionPath });
        return false;
      }

      logger.info('Restoring session', { sessionName });

      // Read and decrypt session data
      const encrypted = readFileSync(sessionPath, 'utf-8');
      const sessionData: SessionData = this.secretsManager.decrypt(encrypted);

      // Check if session is too old (optional: expire after 7 days)
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
      if (Date.now() - sessionData.timestamp > maxAge) {
        logger.warn('Session expired', {
          sessionName,
          age: Math.floor((Date.now() - sessionData.timestamp) / (24 * 60 * 60 * 1000)),
        });
        return false;
      }

      // Restore cookies to browser context
      if (sessionData.cookies && sessionData.cookies.length > 0) {
        await page.context().addCookies(sessionData.cookies);
        logger.debug('Cookies restored', { count: sessionData.cookies.length });
      }

      // Restore localStorage to page
      if (sessionData.localStorage) {
        await page.evaluate((localStorageData) => {
          const data = JSON.parse(localStorageData);
          for (const key in data) {
            window.localStorage.setItem(key, data[key]);
          }
        }, sessionData.localStorage);
        logger.debug('localStorage restored');
      }

      logger.info('Session restored successfully', { sessionName });
      return true;
    } catch (error: any) {
      logger.error('Failed to restore session', {
        sessionName,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Delete a saved session
   */
  deleteSession(sessionName: string): boolean {
    try {
      const sessionPath = join(this.sessionsDir, `${sessionName}.session`);

      if (!existsSync(sessionPath)) {
        logger.warn('Session file not found', { sessionName });
        return false;
      }

      const fs = require('fs');
      fs.unlinkSync(sessionPath);

      logger.info('Session deleted', { sessionName });
      return true;
    } catch (error: any) {
      logger.error('Failed to delete session', {
        sessionName,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * List all saved sessions
   */
  listSessions(): string[] {
    try {
      const fs = require('fs');
      const files = fs.readdirSync(this.sessionsDir);

      return files
        .filter((f: string) => f.endsWith('.session'))
        .map((f: string) => f.replace('.session', ''));
    } catch (error: any) {
      logger.error('Failed to list sessions', { error: error.message });
      return [];
    }
  }

  /**
   * Get session info without loading it
   */
  getSessionInfo(sessionName: string): { exists: boolean; age?: number } {
    try {
      const sessionPath = join(this.sessionsDir, `${sessionName}.session`);

      if (!existsSync(sessionPath)) {
        return { exists: false };
      }

      const encrypted = readFileSync(sessionPath, 'utf-8');
      const sessionData: SessionData = this.secretsManager.decrypt(encrypted);

      const ageInDays = Math.floor((Date.now() - sessionData.timestamp) / (24 * 60 * 60 * 1000));

      return {
        exists: true,
        age: ageInDays,
      };
    } catch (error: any) {
      logger.error('Failed to get session info', {
        sessionName,
        error: error.message,
      });
      return { exists: false };
    }
  }
}
