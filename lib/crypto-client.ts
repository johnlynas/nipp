/**
 * Client-side (browser) AES-256-GCM encryption/decryption with Additional Authenticated Data (AAD).
 *
 * Uses the Web Crypto API — no Node.js Buffer dependency.
 * Produces raw binary output in the format:
 *   <12-byte nonce><ciphertext><16-byte auth tag>
 */

import { NONCE_BYTES, AUTH_TAG_BYTES, MIN_ENCRYPTED_BYTES, decodeBase64url } from './payload-format';

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
// Helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
/** Fatal decoder to detect malformed plaintext instead of silently producing replacement characters. */
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Convert a string to Uint8Array. */
function strToBytes(str: string): Uint8Array {
  return encoder.encode(str);
}

/** Convert a Uint8Array to string. */
function bytesToStr(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Concatenate multiple Uint8Arrays into one. */
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * Encrypt plaintext using AES-256-GCM with AAD.
 * @param cryptoKey - CryptoKey (AES-GCM, encrypt usage)
 * @param plaintext - Data to encrypt as string or Uint8Array
 * @param aad - Additional Authenticated Data (optional)
 * @returns Encrypted bytes: nonce + ciphertext + auth tag
 */
export async function encryptWithAad(
  cryptoKey: CryptoKey,
  plaintext: string | Uint8Array,
  aad?: Uint8Array,
): Promise<EncryptionResult> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));

  // Pass the Uint8Array directly — .buffer can have a non-zero byteOffset
  // that would encrypt the wrong bytes from the underlying ArrayBuffer.
  const data = typeof plaintext === 'string' ? strToBytes(plaintext) : new Uint8Array(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: aad ? new Uint8Array(aad) : undefined,
    },
    cryptoKey,
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  );

  // Web Crypto returns ciphertext + auth tag concatenated
  const encryptedBytes = new Uint8Array(encrypted);
  const ciphertext = encryptedBytes.subarray(0, -AUTH_TAG_BYTES);
  const authTag = encryptedBytes.subarray(-AUTH_TAG_BYTES);

  return {
    encrypted: concatBytes(nonce, ciphertext, authTag),
  };
}

// ---------------------------------------------------------------------------
// Decryption
// ---------------------------------------------------------------------------

/**
 * Decrypt bytes previously encrypted with `encryptWithAad`.
 * @param cryptoKey - CryptoKey (AES-GCM, decrypt usage)
 * @param encrypted - Raw binary: nonce + ciphertext + auth tag
 * @param options - Decryption options including AAD
 * @returns Decrypted plaintext string
 */
export async function decryptWithAad(
  cryptoKey: CryptoKey,
  encrypted: Uint8Array,
  options?: DecryptOptions,
): Promise<string> {
  if (encrypted.length < MIN_ENCRYPTED_BYTES) {
    throw new PayloadDecryptionError('Encrypted payload is too short');
  }

  const nonce = new Uint8Array(encrypted.subarray(0, NONCE_BYTES));
  // ciphertextWithTag already starts right after the nonce — no redundant slicing needed.
  const ciphertextWithTag = encrypted.subarray(NONCE_BYTES);

  if (ciphertextWithTag.length < AUTH_TAG_BYTES) {
    throw new PayloadDecryptionError('Encrypted payload is too short (missing auth tag)');
  }

  try {
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        additionalData: options?.aad ? new Uint8Array(options.aad) : undefined,
      },
      cryptoKey,
      ciphertextWithTag.buffer.slice(
        ciphertextWithTag.byteOffset,
        ciphertextWithTag.byteOffset + ciphertextWithTag.byteLength,
      ) as ArrayBuffer,
    );

    return bytesToStr(new Uint8Array(decrypted));
  } catch {
    throw new PayloadDecryptionError(
      'Authentication failed: payload may have been tampered with',
    );
  }
}

// ---------------------------------------------------------------------------
// Key import helpers
// ---------------------------------------------------------------------------

/**
 * Import a raw AES-256 key from base64url-encoded material.
 *
 * @param base64urlKey - Base64url-encoded 32-byte key material (43 chars)
 * @param extractable - Whether the key should be extractable (default: false)
 * @returns CryptoKey ready for AES-GCM operations
 */
export async function importAesGcmKey(
  base64urlKey: string,
  extractable = false,
): Promise<CryptoKey> {
  // Use shared decodeBase64url and wrap decode errors with a typed error.
  let keyBytes: Uint8Array;
  try {
    keyBytes = decodeBase64url(base64urlKey);
  } catch {
    throw new PayloadEncryptionError('Invalid base64url key material');
  }

  // Validate exactly 32 bytes (256 bits)
  if (keyBytes.length !== 32) {
    throw new PayloadEncryptionError(
      `Key must be exactly 32 bytes, got ${keyBytes.length}`,
    );
  }

  return crypto.subtle.importKey(
    'raw',
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Check if the current environment supports Web Crypto.
 */
export function isWebCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
}

/**
 * Check if the current context is secure (required for Web Crypto in browsers).
 */
export function isSecureContext(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost')
  );
}
