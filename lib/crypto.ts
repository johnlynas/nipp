import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * AES-256-GCM encryption/decryption utilities for PII.
 *
 * Keys are loaded from the PII_ENCRYPTION_KEY environment variable (hex-encoded, 32 bytes).
 * Each encryption operation produces: nonce (12 bytes) + ciphertext + auth tag (16 bytes).
 * Output format: <nonce><ciphertext><authTag> (hex-encoded).
 */

const ALGORITHM = 'aes-256-gcm';
const NONCE_LENGTH = 12;

/**
 * Get the encryption key from environment variables.
 */
function getEncryptionKey(): Buffer {
  const key = env.PII_ENCRYPTION_KEY;
  if (!key || key.length === 0) {
    throw new Error(
      'PII_ENCRYPTION_KEY environment variable is not set. ' +
        'Generate one with: openssl rand -hex 32'
    );
  }
  return Buffer.from(key, 'hex');
}

/**
 * Encrypt plaintext data using AES-256-GCM.
 * @param plaintext - The data to encrypt (PII)
 * @returns Hex-encoded string containing nonce + ciphertext + auth tag
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const nonce = randomBytes(NONCE_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, nonce);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return nonce.toString('hex') + encrypted + authTag;
}

/**
 * Decrypt data previously encrypted with `encrypt()`.
 * @param ciphertext - Hex-encoded string from encrypt()
 * @returns Decrypted plaintext
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const nonce = Buffer.from(ciphertext.slice(0, NONCE_LENGTH * 2), 'hex');
  const authTag = Buffer.from(
    ciphertext.slice(-32),
    'hex'
  );
  const encrypted = ciphertext.slice(NONCE_LENGTH * 2, -32);

  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
