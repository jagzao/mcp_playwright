import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { isValidMasterKey } from './secret-resolver.js';

export class SecretsManager {
  private algorithm = 'aes-256-gcm';
  private keyLength = 32;
  private key: Buffer;

  constructor(masterKey: string) {
    // BLOCKER-I: reject known placeholders/weak keys via the shared resolver, not
    // just a raw length check. The public `.env.example` placeholder must never
    // become a usable encryption key.
    if (!isValidMasterKey(masterKey)) {
      throw new Error('Master key must be a strong random key of at least 32 characters (not a placeholder/default)');
    }
    // Derive a key from the master key
    this.key = scryptSync(masterKey, 'salt', this.keyLength);
  }

  // Encriptar sesiones guardadas
  encrypt(data: any): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.key, iv);

    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(data), 'utf8'),
      cipher.final(),
    ]);

    const authTag = (cipher as any).getAuthTag();

    return JSON.stringify({
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      encrypted: encrypted.toString('hex'),
    });
  }

  // Desencriptar sesiones
  decrypt(encryptedData: string): any {
    const { iv, authTag, encrypted } = JSON.parse(encryptedData);

    const decipher = createDecipheriv(
      this.algorithm,
      this.key,
      Buffer.from(iv, 'hex')
    );

    (decipher as any).setAuthTag(Buffer.from(authTag, 'hex'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'hex')),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf8'));
  }
}
