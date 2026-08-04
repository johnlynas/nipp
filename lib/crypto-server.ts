/**
 * Server-side AES-256-GCM encryption/decryption with Additional Authenticated Data (AAD).
 *
 * Uses `node:crypto` and produces raw binary output in the format:
 *   <12-byte nonce><ciphertext><16-byte auth tag>
 */

import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';
import { NONCE_BYTES, AUTH_TAG_BYTES, MIN_ENCRYPTED_BYTES } from './payload-format';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PayloadEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadEncryptionError';
  }
}

export class PayloadDecryptionError extends PayloadEncryptionError {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadDecryptionError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EncryptionResult {
  /** Raw binary: nonce + ciphertext + auth tag */
  encrypted: Uint8Array;
}

export interface DecryptOptions {
  /** Additional Authenticated Data for GCM */
  aad: Uint8Array;
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * Encrypt plaintext bytes using AES-256-GCM with AAD.
 * @param key - 32-byte AES-256 key as Uint8Array
 * @param plaintext - Data to encrypt (string or bytes)
 * @param aad - Additional Authenticated Data (optional)
 * @returns Encrypted bytes: nonce + ciphertext + auth tag
 */
export function encryptWithAad(
  key: Uint8Array,
  plaintext: string | Uint8Array,
  aad?: Uint8Array,
): EncryptionResult {
  if (key.length !== 32) {
    throw new PayloadEncryptionError('Key must be exactly 32 bytes');
  }

  const nonce = randomBytes(NONCE_BYTES);
  const keyBuffer = Buffer.from(key);

  let plaintextBuf: Buffer;
  if (typeof plaintext === 'string') {
    plaintextBuf = Buffer.from(plaintext, 'utf8');
  } else {
    plaintextBuf = Buffer.from(plaintext);
  }

  const cipher = createCipheriv('aes-256-gcm', keyBuffer, nonce);

  if (aad) {
    cipher.setAAD(Buffer.from(aad));
  }

  const encryptedPart = cipher.update(plaintextBuf);
  const finalPart = cipher.final();
  const authTag = cipher.getAuthTag();

  // Concatenate: nonce + encryptedPart + finalPart + authTag
  const totalLength = nonce.length + encryptedPart.length + finalPart.length + authTag.length;
  const result = Buffer.alloc(totalLength);
  nonce.copy(result, 0);
  encryptedPart.copy(result, nonce.length);
  finalPart.copy(result, nonce.length + encryptedPart.length);
  authTag.copy(result, nonce.length + encryptedPart.length + finalPart.length);

  return {
    encrypted: result,
  };
}

// ---------------------------------------------------------------------------
// Decryption
// ---------------------------------------------------------------------------

/**
 * Decrypt bytes previously encrypted with `encryptWithAad`.
 * @param key - 32-byte AES-256 key as Uint8Array
 * @param encrypted - Raw binary: nonce + ciphertext + auth tag
 * @param options - Decryption options including AAD
 * @returns Decrypted plaintext string
 */
export function decryptWithAad(
  key: Uint8Array,
  encrypted: Uint8Array,
  options?: DecryptOptions,
): string {
  if (key.length !== 32) {
    throw new PayloadDecryptionError('Key must be exactly 32 bytes');
  }

  if (encrypted.length < MIN_ENCRYPTED_BYTES) {
    throw new PayloadDecryptionError('Encrypted payload is too short');
  }

  const nonce = encrypted.subarray(0, NONCE_BYTES);
  const ciphertextWithTag = encrypted.subarray(NONCE_BYTES);

  if (ciphertextWithTag.length < AUTH_TAG_BYTES) {
    throw new PayloadDecryptionError('Encrypted payload is too short (missing auth tag)');
  }

  const ciphertext = ciphertextWithTag.subarray(0, -AUTH_TAG_BYTES);
  const authTag = ciphertextWithTag.subarray(-AUTH_TAG_BYTES);

  // Wrap the full decryption setup in try/catch for defensive error mapping.
  try {
    const keyBuffer = Buffer.from(key);
    const decipher = createDecipheriv('aes-256-gcm', keyBuffer, nonce);

    if (options?.aad) {
      decipher.setAAD(Buffer.from(options.aad));
    }

    decipher.setAuthTag(authTag);

    // Pass the ciphertext Buffer directly — never convert to binary string,
    // which can corrupt multi-byte UTF-8 characters at update/final boundaries.
    const decryptedBuf = Buffer.concat([
      decipher.update(Buffer.from(ciphertext)),
      decipher.final(),
    ]);

    return decryptedBuf.toString('utf8');
  } catch {
    throw new PayloadDecryptionError(
      'Authentication failed: payload may have been tampered with',
    );
  }
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

/**
 * Generate a random 32-byte AES-256 key.
 */
export function generateKey(): Uint8Array {
  return randomBytes(32);
}

/**
 * Derive a key from raw material using HKDF-SHA-256.
 *
 * @remarks Currently unused by the random key issuance flow; kept for future use.
 *
 * @param ikm - Input keying material (at least 32 bytes recommended)
 * @param salt - Salt value (can be null for HKDF-Extract with zero-filled salt)
 * @param info - Info/context string
 * @returns 32-byte derived key as Uint8Array
 */
export function deriveKey(
  ikm: Uint8Array,
  salt: Uint8Array | null,
  info: string,
): Uint8Array {
  const saltBuffer = salt ? Buffer.from(salt) : Buffer.alloc(0);

  const rawDerived = hkdfSync(
    'sha256',
    Buffer.from(ikm),
    saltBuffer,
    info,
    32,
  );

  return new Uint8Array(rawDerived);
}
