/**
 * Unit tests for lib/crypto-client.ts — client-side AES-256-GCM encryption
 * with AAD, key import helpers, and environment checks.
 *
 * Uses the real Web Crypto API (Node 22 globals) — no crypto mocks.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  encryptWithAad,
  decryptWithAad,
  importAesGcmKey,
  isWebCryptoAvailable,
  isSecureContext,
  PayloadDecryptionError,
  PayloadEncryptionError,
} from '@/lib/crypto-client';
import { encodeBase64url, MIN_ENCRYPTED_BYTES, NONCE_BYTES, AUTH_TAG_BYTES } from '@/lib/payload-format';

// ---------------------------------------------------------------------------
// Key material helpers
// ---------------------------------------------------------------------------

/** Generate a fresh random 32-byte key as base64url (43 chars). */
function freshKeyMaterial(): string {
  return encodeBase64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function makeKey(material: string): Promise<CryptoKey> {
  return importAesGcmKey(material);
}

// ---------------------------------------------------------------------------
// encryptWithAad
// ---------------------------------------------------------------------------

describe('encryptWithAad', () => {
  it('produces output of size nonce + ciphertext + auth tag for empty plaintext', async () => {
    const key = await makeKey(freshKeyMaterial());
    const { encrypted } = await encryptWithAad(key, '');

    expect(encrypted.length).toBe(NONCE_BYTES + 0 + AUTH_TAG_BYTES);
    expect(encrypted.length).toBe(MIN_ENCRYPTED_BYTES);
  });

  it('produces output of size nonce + ciphertext + auth tag for non-empty plaintext', async () => {
    const key = await makeKey(freshKeyMaterial());
    const plaintext = '{"name":"Ada Lovelace"}';
    const { encrypted } = await encryptWithAad(key, plaintext);

    expect(encrypted.length).toBe(new TextEncoder().encode(plaintext).length + NONCE_BYTES + AUTH_TAG_BYTES);
  });

  it('produces different ciphertext for the same plaintext (random nonce)', async () => {
    const key = await makeKey(freshKeyMaterial());
    const a = (await encryptWithAad(key, 'same payload')).encrypted;
    const b = (await encryptWithAad(key, 'same payload')).encrypted;

    expect(a.length).toBe(b.length);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('accepts a Uint8Array plaintext with a non-zero byteOffset and only encrypts the view', async () => {
    const key = await makeKey(freshKeyMaterial());

    // Backing buffer is larger; the view starts at offset 4 and spans 8 bytes.
    const backing = new Uint8Array(16).fill(0xff);
    for (let i = 0; i < 8; i++) backing[4 + i] = i;
    const view = backing.subarray(4, 12);

    const { encrypted } = await encryptWithAad(key, view);
    expect(encrypted.length).toBe(view.length + NONCE_BYTES + AUTH_TAG_BYTES);

    const decryptedBytes = new TextEncoder().encode(await decryptWithAad(key, encrypted));
    expect(Buffer.from(decryptedBytes).equals(Buffer.from(view))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// decryptWithAad (round-trips + failure modes)
// ---------------------------------------------------------------------------

describe('decryptWithAad', () => {
  it('round-trips a string plaintext without AAD', async () => {
    const key = await makeKey(freshKeyMaterial());
    const { encrypted } = await encryptWithAad(key, '{"hello":"world"}');

    expect(await decryptWithAad(key, encrypted)).toBe('{"hello":"world"}');
  });

  it('round-trips a string plaintext with AAD', async () => {
    const key = await makeKey(freshKeyMaterial());
    const aad = new TextEncoder().encode('v1\x00request\x00GET\x00/api/admin/users');
    const { encrypted } = await encryptWithAad(key, 'secret payload', aad);

    expect(await decryptWithAad(key, encrypted, { aad })).toBe('secret payload');
  });

  it('round-trips non-ASCII multi-byte plaintext provided as raw UTF-8 bytes', async () => {
    const key = await makeKey(freshKeyMaterial());
    // NUL, control char, multi-byte latin/cjk chars — valid UTF-8 that proves
    // byte-exact round-tripping beyond pure ASCII.
    const text = 'héllo 世界 \u0000\u0001';
    const bytes = new TextEncoder().encode(text);

    const { encrypted } = await encryptWithAad(key, bytes);
    expect(await decryptWithAad(key, encrypted)).toBe(text);
  });

  it('rejects decrypted plaintext that is not valid UTF-8 (fatal decoder)', async () => {
    const key = await makeKey(freshKeyMaterial());
    // 0xff/0xfe are never valid as standalone UTF-8 leading bytes. The client
    // deliberately uses a fatal TextDecoder so malformed plaintext is surfaced
    // as an auth failure instead of silently producing replacement characters.
    const { encrypted } = await encryptWithAad(key, new Uint8Array([0xff, 0xfe, 0x41]));

    await expect(decryptWithAad(key, encrypted)).rejects.toThrow(PayloadDecryptionError);
  });

  it('round-trips an empty string plaintext', async () => {
    const key = await makeKey(freshKeyMaterial());
    const { encrypted } = await encryptWithAad(key, '');

    expect(await decryptWithAad(key, encrypted)).toBe('');
  });

  it('decrypted text from extractable key round-trips', async () => {
    // Two independent imports of the same material must interoperate.
    const material = freshKeyMaterial();
    const key1 = await importAesGcmKey(material, true);
    const key2 = await importAesGcmKey(material, false);

    expect(key1.extractable).toBe(true);
    expect(key2.extractable).toBe(false);

    const { encrypted } = await encryptWithAad(key1, 'cross-import');
    expect(await decryptWithAad(key2, encrypted)).toBe('cross-import');
  });

  it('accepts a ciphertext passed as a subarray view with non-zero byteOffset', async () => {
    const key = await makeKey(freshKeyMaterial());
    const { encrypted } = await encryptWithAad(key, 'offset-proof');

    // Embed the ciphertext inside a larger buffer and hand over only a subarray.
    const padded = new Uint8Array(encrypted.length + 16);
    padded.set(encrypted, 7);
    const slice = padded.subarray(7, 7 + encrypted.length) as Uint8Array;

    expect(await decryptWithAad(key, slice)).toBe('offset-proof');
  });

  it('rejects payloads shorter than the minimum size', async () => {
    const key = await makeKey(freshKeyMaterial());

    await expect(decryptWithAad(key, new Uint8Array(27))).rejects.toThrow(PayloadDecryptionError);
    await expect(decryptWithAad(key, new Uint8Array(MIN_ENCRYPTED_BYTES - 1)))
      .rejects.toThrow('Encrypted payload is too short');
    await expect(decryptWithAad(key, new Uint8Array(0))).rejects.toThrow(PayloadDecryptionError);
  });

  it('throws PayloadDecryptionError on tampered ciphertext', async () => {
    const key = await makeKey(freshKeyMaterial());
    const { encrypted } = await encryptWithAad(key, 'do not touch');
    encrypted[Math.floor(encrypted.length / 2)] ^= 0x01;

    await expect(decryptWithAad(key, encrypted)).rejects.toThrow('Authentication failed: payload may have been tampered with');
  });

  it('throws PayloadDecryptionError on a tampered auth tag', async () => {
    const key = await makeKey(freshKeyMaterial());
    const { encrypted } = await encryptWithAad(key, 'tag integrity');
    encrypted[encrypted.length - 1] ^= 0xff;

    await expect(decryptWithAad(key, encrypted)).rejects.toThrow(PayloadDecryptionError);
  });

  it('throws PayloadDecryptionError when decrypted with the wrong key', async () => {
    const { encrypted } = await encryptWithAad(await makeKey(freshKeyMaterial()), 'wrong-key test');
    const otherKey = await makeKey(freshKeyMaterial());

    await expect(decryptWithAad(otherKey, encrypted)).rejects.toThrow(PayloadDecryptionError);
  });

  it('throws PayloadDecryptionError when AAD does not match', async () => {
    const key = await makeKey(freshKeyMaterial());
    const aad = new TextEncoder().encode('correct aad');
    const wrongAad = new TextEncoder().encode('wrong aad');
    const { encrypted } = await encryptWithAad(key, 'aad-bound', aad);

    await expect(decryptWithAad(key, encrypted, { aad: wrongAad })).rejects.toThrow(PayloadDecryptionError);
  });

  it('throws PayloadDecryptionError when AAD required at encrypt time is missing at decrypt time', async () => {
    const key = await makeKey(freshKeyMaterial());
    const aad = new TextEncoder().encode('needed');
    const { encrypted } = await encryptWithAad(key, 'aad-required', aad);

    await expect(decryptWithAad(key, encrypted)).rejects.toThrow(PayloadDecryptionError);
  });
});

// ---------------------------------------------------------------------------
// importAesGcmKey
// ---------------------------------------------------------------------------

describe('importAesGcmKey', () => {
  it('imports a valid 32-byte base64url key for AES-GCM encrypt+decrypt', async () => {
    const key = await importAesGcmKey(freshKeyMaterial());

    expect(key.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
    expect(Array.from(key.usages)).toEqual(expect.arrayContaining(['encrypt', 'decrypt']));
  });

  it('rejects key material that is not exactly 32 bytes', async () => {
    const short31 = encodeBase64url(crypto.getRandomValues(new Uint8Array(31)));
    const long33 = encodeBase64url(crypto.getRandomValues(new Uint8Array(33)));

    await expect(importAesGcmKey(short31)).rejects.toThrow('Key must be exactly 32 bytes, got 31');
    await expect(importAesGcmKey(long33)).rejects.toThrow('Key must be exactly 32 bytes, got 33');
    await expect(importAesGcmKey('')).rejects.toThrow(PayloadEncryptionError);
  });

  it('produces a key that round-trips with the shared helpers', async () => {
    const material = freshKeyMaterial();
    const key = await importAesGcmKey(material);

    const { encrypted } = await encryptWithAad(key, 'imported-key round trip');
    expect(await decryptWithAad(key, encrypted)).toBe('imported-key round trip');
  });
});

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

describe('error classes', () => {
  it('PayloadDecryptionError extends PayloadEncryptionError sets correct names', () => {
    const sub = new PayloadDecryptionError('sub message');
    const base = new PayloadEncryptionError('base message');

    expect(sub.name).toBe('PayloadDecryptionError');
    expect(sub.message).toBe('sub message');
    expect(sub).toBeInstanceOf(PayloadDecryptionError);
    expect(sub).toBeInstanceOf(PayloadEncryptionError);
    expect(sub).toBeInstanceOf(Error);

    expect(base.name).toBe('PayloadEncryptionError');
    expect(base).toBeInstanceOf(PayloadEncryptionError);
    expect(base).not.toBeInstanceOf(PayloadDecryptionError);
  });
});

// ---------------------------------------------------------------------------
// Environment checks
// ---------------------------------------------------------------------------

describe('environment checks', () => {
  it('reports Web Crypto as available in this runtime', () => {
    // Node 22+ always exposes globalThis.crypto.subtle.
    expect(isWebCryptoAvailable()).toBe(true);
  });

  describe('isSecureContext', () => {
    const ORIGINAL_WINDOW = (globalThis as { window?: unknown }).window;
    const ORIGINAL_LOCATION = (globalThis as { location?: unknown }).location;

    function stubWindowAndLocation(window: unknown, location?: unknown) {
      if (window === undefined) vi.unstubAllGlobals();
      else vi.stubGlobal('window', window);
      if (location !== undefined) vi.stubGlobal('location', location);
    }

    it.each([
      ['https protocol', { isSecureContext: false }, { protocol: 'https:', hostname: 'example.com' }, true],
      ['localhost hostname', { isSecureContext: false }, { protocol: 'http:', hostname: 'localhost' }, true],
      ['non-secure window over http on non-localhost', { isSecureContext: false }, { protocol: 'http:', hostname: 'intranet.example' }, false],
    ])('returns %s for window.isSecureContext flag=%o + location', async (_label, winFlags, loc, expected) => {
      stubWindowAndLocation(winFlags as object, loc);
      expect(isSecureContext()).toBe(expected);
      vi.unstubAllGlobals();
    });

    it('returns true when window.isSecureContext is true regardless of location', () => {
      stubWindowAndLocation({ isSecureContext: true }, { protocol: 'http:', hostname: 'example.com' });
      expect(isSecureContext()).toBe(true);
    });

    it('returns false when there is no window (Node / SSR)', () => {
      vi.unstubAllGlobals();
      expect(ORIGINAL_WINDOW).toBeUndefined(); // node test env has no DOM window
      expect(isSecureContext()).toBe(false);
    });
  });
});
