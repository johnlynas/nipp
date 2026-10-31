/**
 * Better Auth 1.7 canonical team membership key (org plugin, adapter.ts):
 *   base64url-no-padding( SHA-256( JSON.stringify([teamId, userId]) ) )
 *
 * The 1.7 organization plugin computes this on every teamMember write and the
 * schema enforces it as a unique column (`TeamMember.membershipKey`). App code
 * that inserts TeamMember rows directly (bypassing the plugin) MUST supply the
 * identical value or the adapter's lookups by key will miss the row.
 *
 * Implementation notes:
 *  - Pure-JS SHA-256 (no `node:crypto`): this module is imported by lib/db.ts,
 *    which is bundled for BOTH the nodejs and edge runtimes — node:-scheme
 *    imports break the webpack build of edge-bundled modules. Web Crypto's
 *    subtle.digest would work on both but is async; the plugin parity value
 *    must be available synchronously at create-call sites, hence sync SHA-256.
 *  - Verified byte-identical to node:crypto sha256 across padding boundaries
 *    (see tests/unit/team-membership-key.test.ts).
 *  - Keep semantics identical to the plugin: SHA-256 over JSON.stringify of the
 *    two-element array [teamId, userId] (comma separator — JSON default),
 *    encoded as URL-safe base64 WITHOUT padding. The backfill script keeps its
 *    own node:crypto copy (runs standalone via tsx) — do not let the two drift
 *    silently; the unit test asserts parity with @better-auth/utils behavior.
 */

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4), synchronous, returns 32 bytes as a number array.
// Standard compact implementation: works on any JS runtime (node/edge/browser).
// ---------------------------------------------------------------------------
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

function sha256Bytes(input: Uint8Array): number[] {
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  const bitLen = input.length * 8;
  // Pad: original || 0x80 || zeros || 64-bit big-endian length. Multiple of 64.
  const paddedLen = ((input.length + 8) >> 6 << 6) + 64;
  const m = new Uint8Array(paddedLen);
  m.set(input);
  m[input.length] = 0x80;
  // Write length (JS safeInteger — inputs here are well under 2^53 bits).
  for (let i = 0; i < 8; i++) {
    m[paddedLen - 1 - i] = (bitLen / Math.pow(2, 8 * i)) & 0xff;
  }

  const w = new Array<number>(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] =
        (m[off + t * 4] << 24) |
        (m[off + t * 4 + 1] << 16) |
        (m[off + t * 4 + 2] << 8) |
        m[off + t * 4 + 3];
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      hh = g; g = f; f = e;
      e = (d + temp1) | 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }

  return h.map((v) => v >>> 0);
}

/** SHA-256 of a UTF-8 string, as 32 raw bytes. */
function sha256Utf8(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const words = sha256Bytes(bytes);
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (words[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (words[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (words[i] >>> 8) & 0xff;
    out[i * 4 + 3] = words[i] & 0xff;
  }
  return out;
}

/** base64url without padding. */
function base64UrlNoPadding(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  // globalThis.btoa exists on node >=16 and edge runtimes.
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function teamMembershipKey(teamId: string, userId: string): string {
  const digest = sha256Utf8(JSON.stringify([teamId, userId]));
  return base64UrlNoPadding(digest);
}
