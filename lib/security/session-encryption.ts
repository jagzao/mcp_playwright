import * as crypto from 'crypto';
import { logger } from '../observability/logger.js';
import { isValidMasterKey } from './secret-resolver.js';

export class SessionEncryption {
  private algorithm = 'aes-256-gcm';
  private keyLength = 32; // 256 bits
  private ivLength = 16; // 128 bits
  private tagLength = 16; // 128 bits
  private key: Buffer;

  constructor() {
    // Get master key from environment
    const masterKey = process.env.MASTER_KEY;

    // BLOCKER-I: use the shared trusted resolver, not a raw length check. The
    // public `.env.example` placeholder (33 chars) must never become a usable
    // encryption key.
    if (!isValidMasterKey(masterKey)) {
      throw new Error(
        'MASTER_KEY must be a strong random key of at least 32 characters (not a placeholder/default)'
      );
    }

    // Derive key from master key
    this.key = crypto.scryptSync(masterKey as string, 'salt', this.keyLength);
  }

  /**
   * Encrypt data
   */
  encrypt(data: string): string {
    try {
      // Generate random IV
      const iv = crypto.randomBytes(this.ivLength);

      // Create cipher
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

      // Encrypt
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Get auth tag
      const tag = (cipher as any).getAuthTag();

      // Combine: iv + tag + encrypted
      const combined = Buffer.concat([iv, tag, Buffer.from(encrypted, 'hex')]);

      return combined.toString('base64');
    } catch (error: any) {
      logger.error('Encryption failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Decrypt data
   */
  decrypt(encryptedData: string): string {
    try {
      // Decode base64
      const combined = Buffer.from(encryptedData, 'base64');

      // Extract components
      const iv = combined.slice(0, this.ivLength);
      const tag = combined.slice(this.ivLength, this.ivLength + this.tagLength);
      const encrypted = combined.slice(this.ivLength + this.tagLength);

      // Create decipher
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      (decipher as any).setAuthTag(tag);

      // Decrypt
      let decrypted = decipher.update(encrypted.toString('hex'), 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error: any) {
      logger.error('Decryption failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Test encryption/decryption
   */
  test(): boolean {
    try {
      const testData = 'test-data-' + Date.now();
      const encrypted = this.encrypt(testData);
      const decrypted = this.decrypt(encrypted);

      return testData === decrypted;
    } catch {
      return false;
    }
  }
}
