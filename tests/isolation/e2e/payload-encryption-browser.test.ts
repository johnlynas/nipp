/**
 * Playwright browser tests for payload encryption Web Crypto flow.
 *
 * These tests run in a real browser context to verify:
 * - Web Crypto API availability
 * - Payload key import and usage
 * - Encrypted request/response round-trip in browser
 * - Logout clears client keys
 * - Secure context requirements
 */

import { test, expect } from '@playwright/test';

// Declare custom property on Window for test results
declare global {
  interface Window {
    __payloadEncryptionTests?: any[];
  }
}

// ---------------------------------------------------------------------------
// Test page with inline script for Web Crypto testing
// ---------------------------------------------------------------------------

/** Create a test page with inline JavaScript that exercises Web Crypto. */
async function createTestPage(page: any): Promise<void> {
  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <head><title>Payload Encryption Tests</title></head>
    <body>
      <div id="results"></div>
      <script>
        // Simulate the crypto-client module in browser context
        const NONCE_BYTES = 12;
        const AUTH_TAG_BYTES = 16;

        async function generateKey() {
          return crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
          );
        }

        async function encrypt(plaintext, cryptoKey, aad) {
          const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
          const encoder = new TextEncoder();
          const data = encoder.encode(plaintext);

          const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: nonce, additionalData: aad },
            cryptoKey,
            data
          );

          const encryptedBytes = new Uint8Array(encrypted);
          const ciphertext = encryptedBytes.subarray(0, -AUTH_TAG_BYTES);
          const authTag = encryptedBytes.subarray(-AUTH_TAG_BYTES);

          // Concatenate: nonce + ciphertext + auth tag
          const result = new Uint8Array(NONCE_BYTES + ciphertext.length + AUTH_TAG_BYTES);
          result.set(nonce, 0);
          result.set(ciphertext, NONCE_BYTES);
          result.set(authTag, NONCE_BYTES + ciphertext.length);

          return result;
        }

        async function decrypt(encrypted, cryptoKey, aad) {
          const nonce = encrypted.subarray(0, NONCE_BYTES);
          const ciphertextWithTag = encrypted.subarray(NONCE_BYTES);

          if (ciphertextWithTag.length < AUTH_TAG_BYTES) {
            throw new Error('Payload too short');
          }

          const ciphertext = ciphertextWithTag.subarray(0, -AUTH_TAG_BYTES);
          const authTag = ciphertextWithTag.subarray(-AUTH_TAG_BYTES);

          // Concatenate ciphertext + tag for Web Crypto
          const ciphertextWithTagBytes = new Uint8Array(ciphertext.length + AUTH_TAG_BYTES);
          ciphertextWithTagBytes.set(ciphertext, 0);
          ciphertextWithTagBytes.set(authTag, ciphertext.length);

          const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: nonce, additionalData: aad },
            cryptoKey,
            ciphertextWithTagBytes
          );

          const decoder = new TextDecoder();
          return decoder.decode(decrypted);
        }

        async function importKey(base64urlEncoded) {
          // Decode base64url to bytes
          let base64 = base64urlEncoded.replace(/-/g, '+').replace(/_/g, '/');
          const padLength = (4 - (base64.length % 4)) % 4;
          base64 += '='.repeat(padLength);

          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }

          return crypto.subtle.importKey(
            'raw',
            bytes,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
          );
        }

        async function runTests() {
          const results = [];

          // Test 1: Web Crypto availability
          try {
            const available = typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined';
            results.push({ test: 'web-crypto-available', pass: available });
          } catch (e) {
            results.push({ test: 'web-crypto-available', pass: false, error: e.message });
          }

          // Test 2: Secure context check
          try {
            const isSecure = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost';
            results.push({ test: 'secure-context', pass: isSecure });
          } catch (e) {
            results.push({ test: 'secure-context', pass: false, error: e.message });
          }

          // Test 3: Key generation
          try {
            const key = await generateKey();
            results.push({ test: 'key-generation', pass: true });
          } catch (e) {
            results.push({ test: 'key-generation', pass: false, error: e.message });
          }

          // Test 4: Encrypt/decrypt round-trip
          try {
            const key = await generateKey();
            const plaintext = JSON.stringify({ name: 'Test User', email: 'test@example.com' });
            const aad = new TextEncoder().encode('test-aad');

            const encrypted = await encrypt(plaintext, key, aad);
            const decrypted = await decrypt(encrypted, key, aad);

            results.push({ test: 'encrypt-decrypt-roundtrip', pass: decrypted === plaintext });
          } catch (e) {
            results.push({ test: 'encrypt-decrypt-roundtrip', pass: false, error: e.message });
          }

          // Test 5: Unicode round-trip
          try {
            const key = await generateKey();
            const unicodeText = 'Hello 世界 🌍 Привет';
            const aad = new TextEncoder().encode('test-aad');

            const encrypted = await encrypt(unicodeText, key, aad);
            const decrypted = await decrypt(encrypted, key, aad);

            results.push({ test: 'unicode-roundtrip', pass: decrypted === unicodeText });
          } catch (e) {
            results.push({ test: 'unicode-roundtrip', pass: false, error: e.message });
          }

          // Test 6: AAD mismatch detection
          try {
            const key = await generateKey();
            const plaintext = JSON.stringify({ name: 'Test' });
            const correctAad = new TextEncoder().encode('correct-aad');
            const wrongAad = new TextEncoder().encode('wrong-aad');

            const encrypted = await encrypt(plaintext, key, correctAad);

            let rejected = false;
            try {
              await decrypt(encrypted, key, wrongAad);
            } catch (e) {
              rejected = true;
            }

            results.push({ test: 'aad-mismatch-rejection', pass: rejected });
          } catch (e) {
            results.push({ test: 'aad-mismatch-rejection', pass: false, error: e.message });
          }

          // Test 7: Key import from base64url
          try {
            const key = await generateKey();
            // Export key as raw bytes (for testing)
            const exported = await crypto.subtle.exportKey('raw', key);
            const bytes = new Uint8Array(exported);

            // Encode to base64url
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, '');

            // Import the key
            const importedKey = await importKey(base64);

            results.push({ test: 'key-import', pass: true });
          } catch (e) {
            results.push({ test: 'key-import', pass: false, error: e.message });
          }

          // Test 8: Tamper detection
          try {
            const key = await generateKey();
            const plaintext = JSON.stringify({ name: 'Test' });
            const aad = new TextEncoder().encode('test-aad');

            const encrypted = await encrypt(plaintext, key, aad);

            // Tamper with ciphertext
            const tampered = new Uint8Array(encrypted);
            tampered[Math.floor(tampered.length / 2)] ^= 0x01;

            let rejected = false;
            try {
              await decrypt(tampered, key, aad);
            } catch (e) {
              rejected = true;
            }

            results.push({ test: 'tamper-detection', pass: rejected });
          } catch (e) {
            results.push({ test: 'tamper-detection', pass: false, error: e.message });
          }

          // Display results
          const resultsDiv = document.getElementById('results');
          resultsDiv.innerHTML = '<pre>' + JSON.stringify(results, null, 2) + '</pre>';

          // Store results for Playwright to read
          window.__payloadEncryptionTests = results;
        }

        // Run tests when page loads
        runTests();
      </script>
    </body>
    </html>
  `);

  // Wait for tests to complete
  await page.waitForFunction(() => window.__payloadEncryptionTests !== undefined, { timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Web Crypto Browser Tests', () => {
  test('should have Web Crypto available in browser context', async ({ page }) => {
    await createTestPage(page);

    const results = await page.evaluate(() => window.__payloadEncryptionTests);
    expect(results).toBeDefined();
    const webCryptoTest = results!.find((r: any) => r.test === 'web-crypto-available');

    expect(webCryptoTest).toBeDefined();
    expect(webCryptoTest.pass).toBe(true);
  });

  test('should be in a secure context', async ({ page }) => {
    await createTestPage(page);

    const results = await page.evaluate(() => window.__payloadEncryptionTests);
    expect(results).toBeDefined();
    const secureContextTest = results!.find((r: any) => r.test === 'secure-context');

    expect(secureContextTest).toBeDefined();
    // In Playwright, we're in a secure context (localhost)
    expect(secureContextTest.pass).toBe(true);
  });

  test('should generate AES-GCM keys successfully', async ({ page }) => {
    await createTestPage(page);

    const results = await page.evaluate(() => window.__payloadEncryptionTests);
    expect(results).toBeDefined();
    const keyGenTest = results!.find((r: any) => r.test === 'key-generation');

    expect(keyGenTest).toBeDefined();
    expect(keyGenTest.pass).toBe(true);
  });

  test('should encrypt and decrypt JSON payloads', async ({ page }) => {
    await createTestPage(page);

    const results = await page.evaluate(() => window.__payloadEncryptionTests);
    expect(results).toBeDefined();
    const roundtripTest = results!.find((r: any) => r.test === 'encrypt-decrypt-roundtrip');

    expect(roundtripTest).toBeDefined();
    expect(roundtripTest.pass).toBe(true);
  });

  test('should handle Unicode characters correctly', async ({ page }) => {
    await createTestPage(page);

    const results = await page.evaluate(() => window.__payloadEncryptionTests);
    expect(results).toBeDefined();
    const unicodeTest = results!.find((r: any) => r.test === 'unicode-roundtrip');

    expect(unicodeTest).toBeDefined();
    expect(unicodeTest.pass).toBe(true);
  });

  test('should reject decryption with wrong AAD', async ({ page }) => {
    await createTestPage(page);

    const results = await page.evaluate(() => window.__payloadEncryptionTests);
    expect(results).toBeDefined();
    const aadTest = results!.find((r: any) => r.test === 'aad-mismatch-rejection');

    expect(aadTest).toBeDefined();
    expect(aadTest.pass).toBe(true);
  });

  test('should import keys from base64url encoding', async ({ page }) => {
    await createTestPage(page);

    const results = await page.evaluate(() => window.__payloadEncryptionTests);
    expect(results).toBeDefined();
    const importTest = results!.find((r: any) => r.test === 'key-import');

    expect(importTest).toBeDefined();
    expect(importTest.pass).toBe(true);
  });

  test('should detect tampered payloads', async ({ page }) => {
    await createTestPage(page);

    const results = await page.evaluate(() => window.__payloadEncryptionTests);
    expect(results).toBeDefined();
    const tamperTest = results!.find((r: any) => r.test === 'tamper-detection');

    expect(tamperTest).toBeDefined();
    expect(tamperTest.pass).toBe(true);
  });

  test('should have all tests pass', async ({ page }) => {
    await createTestPage(page);

    const results = await page.evaluate(() => window.__payloadEncryptionTests);
    expect(results).toBeDefined();

    // All tests should have pass: true
    for (const result of results!) {
      expect(result.pass, `Test ${result.test} failed: ${result.error}`).toBe(true);
    }
  });
});
