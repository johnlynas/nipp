/**
 * Integration tests for payload encryption round-trip.
 *
 * Tests the full cycle: client encrypt → server decrypt → server encrypt → client decrypt.
 * These tests verify interoperability between crypto-server and crypto-client modules.
 */

import { describe, it, expect } from 'vitest';
import { encryptWithAad as serverEncrypt, decryptWithAad as serverDecrypt } from '@/lib/crypto-server';
import { encryptWithAad as clientEncrypt, decryptWithAad as clientDecrypt } from '@/lib/crypto-client';
import { importAesGcmKey, isWebCryptoAvailable } from '@/lib/crypto-client';
import { generateKey } from '@/lib/crypto-server';
import { encodeBase64url, decodeBase64url } from '@/lib/payload-format';
import { buildRequestAad, buildResponseAad } from '@/lib/payload-format';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a test key and return both server-side Uint8Array and client-side CryptoKey. */
async function createTestKey(): Promise<{
  keyBytes: Uint8Array;
  cryptoKey: CryptoKey;
  base64urlKey: string;
}> {
  const keyBytes = generateKey();
  const base64urlKey = encodeBase64url(keyBytes);
  const cryptoKey = await importAesGcmKey(base64urlKey, false);
  return { keyBytes, cryptoKey, base64urlKey };
}

/** Build a test AAD for request encryption. */
function buildTestRequestAad(): Uint8Array {
  return buildRequestAad(
    'test-key-id',
    'test-session-id',
    'POST',
    '/api/admin/organizations/org-123/members',
    '1700000000',
    'test-nonce-abc123def456ghi789jkl',
  );
}

/** Build a test AAD for response encryption. */
function buildTestResponseAad(): Uint8Array {
  return buildResponseAad(
    'test-key-id',
    'test-session-id',
    'POST',
    '/api/admin/organizations/org-123/members',
    'test-nonce-abc123def456ghi789jkl',
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Payload Encryption Integration', () => {
  describe('Server ↔ Client interoperability', () => {
    it('should encrypt on server and decrypt on client (round-trip)', async () => {
      const plaintext = JSON.stringify({ name: 'John Doe', email: 'john@example.com' });
      const { keyBytes, cryptoKey } = await createTestKey();

      // Server encrypts
      const serverResult = serverEncrypt(keyBytes, plaintext, buildTestRequestAad());

      // Client decrypts
      const clientDecrypted = await clientDecrypt(cryptoKey, serverResult.encrypted, {
        aad: buildTestRequestAad(),
      });

      expect(clientDecrypted).toBe(plaintext);
    });

    it('should encrypt on client and decrypt on server (reverse round-trip)', async () => {
      const plaintext = JSON.stringify({ name: 'Jane Doe', email: 'jane@example.com' });
      const { keyBytes, cryptoKey } = await createTestKey();

      // Client encrypts
      const clientResult = await clientEncrypt(cryptoKey, plaintext, buildTestRequestAad());

      // Server decrypts
      const serverDecrypted = serverDecrypt(keyBytes, clientResult.encrypted, {
        aad: buildTestRequestAad(),
      });

      expect(serverDecrypted).toBe(plaintext);
    });

    it('should encrypt response on server and decrypt on client', async () => {
      const plaintext = JSON.stringify({ results: [{ id: '1', name: 'Test' }], total: 1 });
      const { keyBytes, cryptoKey } = await createTestKey();

      // Server encrypts response
      const serverResult = serverEncrypt(keyBytes, plaintext, buildTestResponseAad());

      // Client decrypts response
      const clientDecrypted = await clientDecrypt(cryptoKey, serverResult.encrypted, {
        aad: buildTestResponseAad(),
      });

      expect(clientDecrypted).toBe(plaintext);
    });

    it('should handle Unicode characters correctly', async () => {
      const unicodeText = 'Hello 世界 🌍 Привет مرحبا';
      const { keyBytes, cryptoKey } = await createTestKey();

      // Server encrypts
      const serverResult = serverEncrypt(keyBytes, unicodeText, buildTestRequestAad());

      // Client decrypts
      const clientDecrypted = await clientDecrypt(cryptoKey, serverResult.encrypted, {
        aad: buildTestRequestAad(),
      });

      expect(clientDecrypted).toBe(unicodeText);
    });

    it('should handle empty string payload', async () => {
      const plaintext = '';
      const { keyBytes, cryptoKey } = await createTestKey();

      // Server encrypts
      const serverResult = serverEncrypt(keyBytes, plaintext, buildTestRequestAad());

      // Client decrypts
      const clientDecrypted = await clientDecrypt(cryptoKey, serverResult.encrypted, {
        aad: buildTestRequestAad(),
      });

      expect(clientDecrypted).toBe(plaintext);
    });

    it('should handle large payloads', async () => {
      const largeData = Array(100).fill({ id: 'test', name: 'Name'.repeat(10), email: 'test@example.com' });
      const plaintext = JSON.stringify(largeData);
      const { keyBytes, cryptoKey } = await createTestKey();

      // Server encrypts
      const serverResult = serverEncrypt(keyBytes, plaintext, buildTestRequestAad());

      // Client decrypts
      const clientDecrypted = await clientDecrypt(cryptoKey, serverResult.encrypted, {
        aad: buildTestRequestAad(),
      });

      expect(clientDecrypted).toBe(plaintext);
    });
  });

  describe('AAD mismatch detection', () => {
    it('should reject decryption with wrong request AAD', async () => {
      const plaintext = JSON.stringify({ name: 'Test' });
      const { keyBytes, cryptoKey } = await createTestKey();

      // Encrypt with correct AAD
      const serverResult = serverEncrypt(keyBytes, plaintext, buildTestRequestAad());

      // Try to decrypt with wrong AAD
      const wrongAad = buildRequestAad(
        'wrong-key-id', // Different key ID
        'test-session-id',
        'POST',
        '/api/admin/organizations/org-123/members',
        '1700000000',
        'test-nonce-abc123def456ghi789jkl',
      );

      await expect(
        clientDecrypt(cryptoKey, serverResult.encrypted, { aad: wrongAad }),
      ).rejects.toThrow('Authentication failed');
    });

    it('should reject decryption with wrong method in AAD', async () => {
      const plaintext = JSON.stringify({ name: 'Test' });
      const { keyBytes, cryptoKey } = await createTestKey();

      // Encrypt with POST
      const serverResult = serverEncrypt(keyBytes, plaintext, buildTestRequestAad());

      // Try to decrypt with GET method in AAD
      const wrongAad = buildRequestAad(
        'test-key-id',
        'test-session-id',
        'GET', // Different method
        '/api/admin/organizations/org-123/members',
        '1700000000',
        'test-nonce-abc123def456ghi789jkl',
      );

      await expect(
        clientDecrypt(cryptoKey, serverResult.encrypted, { aad: wrongAad }),
      ).rejects.toThrow('Authentication failed');
    });

    it('should reject decryption with wrong path in AAD', async () => {
      const plaintext = JSON.stringify({ name: 'Test' });
      const { keyBytes, cryptoKey } = await createTestKey();

      // Encrypt with correct path
      const serverResult = serverEncrypt(keyBytes, plaintext, buildTestRequestAad());

      // Try to decrypt with wrong path in AAD
      const wrongAad = buildRequestAad(
        'test-key-id',
        'test-session-id',
        'POST',
        '/api/admin/organizations/org-456/members', // Different org ID
        '1700000000',
        'test-nonce-abc123def456ghi789jkl',
      );

      await expect(
        clientDecrypt(cryptoKey, serverResult.encrypted, { aad: wrongAad }),
      ).rejects.toThrow('Authentication failed');
    });
  });

  describe('Tamper detection', () => {
    it('should reject tampered ciphertext', async () => {
      const plaintext = JSON.stringify({ name: 'Test' });
      const { keyBytes, cryptoKey } = await createTestKey();

      // Encrypt
      const serverResult = serverEncrypt(keyBytes, plaintext, buildTestRequestAad());

      // Tamper with ciphertext (flip a byte in the middle)
      const tampered = new Uint8Array(serverResult.encrypted);
      const midPoint = Math.floor(tampered.length / 2);
      tampered[midPoint] ^= 0x01; // Flip one bit

      await expect(
        clientDecrypt(cryptoKey, tampered, { aad: buildTestRequestAad() }),
      ).rejects.toThrow('Authentication failed');
    });

    it('should reject truncated ciphertext', async () => {
      const plaintext = JSON.stringify({ name: 'Test' });
      const { keyBytes, cryptoKey } = await createTestKey();

      // Encrypt
      const serverResult = serverEncrypt(keyBytes, plaintext, buildTestRequestAad());

      // Truncate the payload (remove last 20 bytes)
      const truncated = serverResult.encrypted.subarray(0, -20);

      await expect(
        clientDecrypt(cryptoKey, truncated, { aad: buildTestRequestAad() }),
      ).rejects.toThrow();
    });

    it('should reject payload with missing auth tag', async () => {
      const plaintext = JSON.stringify({ name: 'Test' });
      const { keyBytes, cryptoKey } = await createTestKey();

      // Encrypt
      const serverResult = serverEncrypt(keyBytes, plaintext, buildTestRequestAad());

      // Remove auth tag (last 16 bytes)
      const noTag = serverResult.encrypted.subarray(0, -16);

      await expect(
        clientDecrypt(cryptoKey, noTag, { aad: buildTestRequestAad() }),
      ).rejects.toThrow();
    });
  });

  describe('Key mismatch', () => {
    it('should reject decryption with wrong key', async () => {
      const plaintext = JSON.stringify({ name: 'Test' });
      const { keyBytes, cryptoKey } = await createTestKey();

      // Encrypt with first key
      const serverResult = serverEncrypt(keyBytes, plaintext, buildTestRequestAad());

      // Try to decrypt with different key
      const { cryptoKey: wrongCryptoKey } = await createTestKey();

      await expect(
        clientDecrypt(wrongCryptoKey, serverResult.encrypted, { aad: buildTestRequestAad() }),
      ).rejects.toThrow('Authentication failed');
    });
  });

  describe('Web Crypto availability', () => {
    it('should detect Web Crypto availability', () => {
      // In Node.js test environment, Web Crypto is available via globalThis.crypto
      expect(isWebCryptoAvailable()).toBe(true);
    });

    it('should import and use a key successfully', async () => {
      const { cryptoKey } = await createTestKey();

      expect(cryptoKey).toBeDefined();
      expect(cryptoKey.type).toBe('secret');
      expect(cryptoKey.algorithm.name).toBe('AES-GCM');
    });
  });

  describe('Base64url key transport', () => {
    it('should round-trip a key through base64url encoding', async () => {
      const originalKey = generateKey();
      const encoded = encodeBase64url(originalKey);
      const decoded = decodeBase64url(encoded);

      // Compare byte-by-byte since originalKey is a Buffer and decoded is Uint8Array
      expect(decoded.length).toBe(originalKey.length);
      for (let i = 0; i < decoded.length; i++) {
        expect(decoded[i]).toBe(originalKey[i]);
      }
    });

    it('should produce consistent base64url encoding', async () => {
      const key = generateKey();
      const encoded1 = encodeBase64url(key);
      const encoded2 = encodeBase64url(key);

      expect(encoded1).toBe(encoded2);
    });
  });
});
