/**
 * Unit tests for crypto-server.ts — server-side AES-256-GCM with AAD.
 */

import { describe, it, expect } from 'vitest';
import {
  encryptWithAad,
  decryptWithAad,
  generateKey,
  deriveKey,
  PayloadEncryptionError,
  PayloadDecryptionError,
} from '@/lib/crypto-server';

describe('generateKey', () => {
  it('should generate a 32-byte key', () => {
    const key = generateKey();
    expect(key).toHaveLength(32);
  });

  it('should generate unique keys', () => {
    const key1 = generateKey();
    const key2 = generateKey();
    expect(key1).not.toEqual(key2);
  });

  it('should generate random-looking bytes', () => {
    const key = generateKey();
    // Check that not all bytes are zero (extremely unlikely for random)
    const hasNonZero = key.some((b) => b !== 0);
    expect(hasNonZero).toBe(true);
  });
});

describe('deriveKey', () => {
  it('should derive a deterministic key from same inputs', () => {
    const ikm = new Uint8Array(32).fill(42);
    const salt = new Uint8Array(16).fill(0);
    const info = 'test-context';

    const key1 = deriveKey(ikm, salt, info);
    const key2 = deriveKey(ikm, salt, info);

    expect(key1).toEqual(key2);
  });

  it('should produce different keys for different salts', () => {
    const ikm = new Uint8Array(32).fill(42);
    const info = 'test-context';

    const key1 = deriveKey(ikm, new Uint8Array(16).fill(0), info);
    const key2 = deriveKey(ikm, new Uint8Array(16).fill(1), info);

    expect(key1).not.toEqual(key2);
  });

  it('should produce a 32-byte derived key', () => {
    const ikm = new Uint8Array(32).fill(42);
    const key = deriveKey(ikm, null, 'info');
    expect(key).toHaveLength(32);
  });

  it('should handle null salt', () => {
    const ikm = new Uint8Array(32).fill(42);
    expect(() => deriveKey(ikm, null, 'info')).not.toThrow();
  });

  it('should produce different keys for different info', () => {
    const ikm = new Uint8Array(32).fill(42);
    const salt = new Uint8Array(16).fill(0);

    const key1 = deriveKey(ikm, salt, 'context-a');
    const key2 = deriveKey(ikm, salt, 'context-b');

    expect(key1).not.toEqual(key2);
  });
});

describe('encryptWithAad / decryptWithAad', () => {
  it('should round-trip encrypt and decrypt a simple string', () => {
    const key = generateKey();
    const plaintext = 'Hello, World!';
    const aad = new TextEncoder().encode('test-aad');

    const { encrypted } = encryptWithAad(key, plaintext, aad);
    const decrypted = decryptWithAad(key, encrypted, { aad });

    expect(decrypted).toBe(plaintext);
  });

  it('should round-trip with empty plaintext', () => {
    const key = generateKey();
    const aad = new TextEncoder().encode('aad');

    const { encrypted } = encryptWithAad(key, '', aad);
    const decrypted = decryptWithAad(key, encrypted, { aad });

    expect(decrypted).toBe('');
  });

  it('should round-trip with unicode text', () => {
    const key = generateKey();
    const plaintext = 'こんにちは 🌍 café résumé';
    const aad = new TextEncoder().encode('unicode-aad');

    const { encrypted } = encryptWithAad(key, plaintext, aad);
    const decrypted = decryptWithAad(key, encrypted, { aad });

    expect(decrypted).toBe(plaintext);
  });

  it('should round-trip with large payload', () => {
    const key = generateKey();
    const plaintext = 'x'.repeat(10000);

    const { encrypted } = encryptWithAad(key, plaintext);
    const decrypted = decryptWithAad(key, encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it('should reject wrong key', () => {
    const key1 = generateKey();
    const key2 = generateKey();
    const plaintext = 'secret data';

    const { encrypted } = encryptWithAad(key1, plaintext);
    expect(() => decryptWithAad(key2, encrypted)).toThrow(PayloadDecryptionError);
  });

  it('should reject tampered ciphertext', () => {
    const key = generateKey();
    const plaintext = 'secret data';

    const { encrypted } = encryptWithAad(key, plaintext);
    // Tamper with the ciphertext portion (after nonce)
    encrypted[20] ^= 0xff;

    expect(() => decryptWithAad(key, encrypted)).toThrow(PayloadDecryptionError);
  });

  it('should reject truncated payload', () => {
    const key = generateKey();
    const plaintext = 'secret data';

    const { encrypted } = encryptWithAad(key, plaintext);
    // Truncate the payload
    const truncated = encrypted.subarray(0, 15);

    expect(() => decryptWithAad(key, truncated)).toThrow(PayloadDecryptionError);
  });

  it('should reject AAD mismatch', () => {
    const key = generateKey();
    const plaintext = 'secret data';

    const { encrypted } = encryptWithAad(key, plaintext, new TextEncoder().encode('correct-aad'));
    const wrongAad = new TextEncoder().encode('wrong-aad');

    expect(() => decryptWithAad(key, encrypted, { aad: wrongAad })).toThrow(PayloadDecryptionError);
  });

  it('should reject missing AAD when one was used', () => {
    const key = generateKey();
    const plaintext = 'secret data';

    const { encrypted } = encryptWithAad(key, plaintext, new TextEncoder().encode('some-aad'));

    expect(() => decryptWithAad(key, encrypted)).toThrow(PayloadDecryptionError);
  });

  it('should reject payload shorter than minimum', () => {
    const key = generateKey();
    expect(() => decryptWithAad(key, new Uint8Array([1, 2, 3]))).toThrow(PayloadDecryptionError);
  });

  it('should reject invalid key length', () => {
    const shortKey = new Uint8Array(16); // 16 bytes, not 32
    expect(() => encryptWithAad(shortKey, 'data')).toThrow(PayloadEncryptionError);
  });

  it('should produce unique nonces for each encryption', () => {
    const key = generateKey();
    const plaintext = 'same data';

    const { encrypted: enc1 } = encryptWithAad(key, plaintext);
    const { encrypted: enc2 } = encryptWithAad(key, plaintext);

    // Nonces are the first 12 bytes
    const nonce1 = enc1.subarray(0, 12);
    const nonce2 = enc2.subarray(0, 12);

    expect(nonce1).not.toEqual(nonce2);
  });

  it('should produce encrypted output with correct structure', () => {
    const key = generateKey();
    const plaintext = 'test';

    const { encrypted } = encryptWithAad(key, plaintext);
    // Should be: 12-byte nonce + ciphertext + 16-byte tag
    expect(encrypted.length).toBeGreaterThan(28); // at least nonce + tag
  });

  it('should work with Uint8Array plaintext input', () => {
    const key = generateKey();
    const plaintextBytes = new TextEncoder().encode('binary test');

    const { encrypted } = encryptWithAad(key, plaintextBytes);
    const decrypted = decryptWithAad(key, encrypted);

    expect(decrypted).toBe('binary test');
  });
});
