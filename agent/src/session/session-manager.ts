import { Page } from 'playwright';
import { logger } from '../../../lib/observability/logger.js';
import { SessionEncryption } from '../../../lib/security/session-encryption.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface SessionData {
  name: string;
  cookies: any[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  url: string;
  timestamp: number;
}

export class SessionManager {
  private sessionsDir: string;
  private encryption: SessionEncryption;

  constructor() {
    this.sessionsDir = path.join(process.cwd(), 'data', 'sessions');
    this.encryption = new SessionEncryption();
    this.ensureSessionsDir();
  }

  private async ensureSessionsDir() {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
    } catch (error: any) {
      logger.error('Failed to create sessions directory', { error: error.message });
    }
  }

  /**
   * Save current page session
   */
  async saveSession(page: Page, name: string): Promise<void> {
    try {
      const context = page.context();

      // Get cookies
      const cookies = await context.cookies();

      // Get localStorage
      const localStorage = await page.evaluate(() => {
        const data: Record<string, string> = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key) {
            data[key] = window.localStorage.getItem(key) || '';
          }
        }
        return data;
      });

      // Get sessionStorage
      const sessionStorage = await page.evaluate(() => {
        const data: Record<string, string> = {};
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const key = window.sessionStorage.key(i);
          if (key) {
            data[key] = window.sessionStorage.getItem(key) || '';
          }
        }
        return data;
      });

      const sessionData: SessionData = {
        name,
        cookies,
        localStorage,
        sessionStorage,
        url: page.url(),
        timestamp: Date.now(),
      };

      // Encrypt and save
      const encrypted = this.encryption.encrypt(JSON.stringify(sessionData));
      const sessionPath = path.join(this.sessionsDir, `${name}.session`);

      await fs.writeFile(sessionPath, encrypted);

      logger.info('Session saved successfully', {
        name,
        cookieCount: cookies.length,
        localStorageKeys: Object.keys(localStorage).length,
        path: sessionPath,
      });
    } catch (error: any) {
      logger.error('Failed to save session', {
        name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Restore session to page
   */
  async restoreSession(page: Page, name: string): Promise<boolean> {
    try {
      const sessionPath = path.join(this.sessionsDir, `${name}.session`);

      // Check if session exists
      try {
        await fs.access(sessionPath);
      } catch {
        logger.warn('Session not found', { name, path: sessionPath });
        return false;
      }

      // Read and decrypt
      const encrypted = await fs.readFile(sessionPath, 'utf-8');
      const decrypted = this.encryption.decrypt(encrypted);
      const sessionData: SessionData = JSON.parse(decrypted);

      const context = page.context();

      // Restore cookies
      await context.addCookies(sessionData.cookies);

      // Navigate to saved URL first
      await page.goto(sessionData.url, { waitUntil: 'domcontentloaded' });

      // Restore localStorage
      await page.evaluate((data) => {
        Object.entries(data).forEach(([key, value]) => {
          window.localStorage.setItem(key, value);
        });
      }, sessionData.localStorage);

      // Restore sessionStorage
      await page.evaluate((data) => {
        Object.entries(data).forEach(([key, value]) => {
          window.sessionStorage.setItem(key, value);
        });
      }, sessionData.sessionStorage);

      // Reload to apply session
      await page.reload({ waitUntil: 'domcontentloaded' });

      logger.info('Session restored successfully', {
        name,
        cookieCount: sessionData.cookies.length,
        age: Date.now() - sessionData.timestamp,
      });

      return true;
    } catch (error: any) {
      logger.error('Failed to restore session', {
        name,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * List all saved sessions
   */
  async listSessions(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.sessionsDir);
      return files
        .filter((f) => f.endsWith('.session'))
        .map((f) => f.replace('.session', ''));
    } catch (error: any) {
      logger.error('Failed to list sessions', { error: error.message });
      return [];
    }
  }

  /**
   * Delete a session
   */
  async deleteSession(name: string): Promise<boolean> {
    try {
      const sessionPath = path.join(this.sessionsDir, `${name}.session`);
      await fs.unlink(sessionPath);

      logger.info('Session deleted', { name });
      return true;
    } catch (error: any) {
      logger.error('Failed to delete session', {
        name,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Check if session exists
   */
  async sessionExists(name: string): Promise<boolean> {
    try {
      const sessionPath = path.join(this.sessionsDir, `${name}.session`);
      await fs.access(sessionPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get session info without restoring
   */
  async getSessionInfo(name: string): Promise<SessionData | null> {
    try {
      const sessionPath = path.join(this.sessionsDir, `${name}.session`);
      const encrypted = await fs.readFile(sessionPath, 'utf-8');
      const decrypted = this.encryption.decrypt(encrypted);
      const sessionData: SessionData = JSON.parse(decrypted);

      return sessionData;
    } catch (error: any) {
      logger.error('Failed to get session info', {
        name,
        error: error.message,
      });
      return null;
    }
  }
}
