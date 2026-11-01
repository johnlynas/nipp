import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { teamMembershipKey } from '@/lib/team-membership-key';

/** Reference implementation — exactly what the Better Auth 1.7 org plugin does
 * (adapter.ts computeTeamMembershipKey) and what the backfill script computes:
 * base64url-no-padding(SHA-256(JSON.stringify([teamId, userId]))). */
function reference(teamId: string, userId: string): string {
  const digest = createHash('sha256').update(JSON.stringify([teamId, userId])).digest();
  return digest.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

describe('teamMembershipKey (1.7 canonical key)', () => {
  it.each([
    ['team-a1', 'user_aaaa'],
    ['team-b1', 'user_bbbb'],
    ['members-team', 'user-9'],
    ['team-1', 'user-1'],
    ['T3_very-long-team-id-with-specials!', 'u-😀-emoji-user'],
    ['', 'empty-team'],
    ['only-user-side-empty', ''],
  ])('matches node:crypto reference for (%s, %s)', (teamId, userId) => {
    expect(teamMembershipKey(teamId, userId)).toBe(reference(teamId, userId));
  });

  it('is deterministic and order-sensitive (array position is part of the hash input)', () => {
    expect(teamMembershipKey('a', 'b')).not.toBe(teamMembershipKey('b', 'a'));
    expect(teamMembershipKey('a', 'b')).toBe(teamMembershipKey('a', 'b'));
  });

  it('produces base64url WITHOUT padding (43 chars for a 32-byte digest)', () => {
    // ceil(32*8/6) = 43 base64url chars; the final 6-bit group needs only 2 of
    // its 6 bits, so one '=' pad is dropped — never 44.
    const key = teamMembershipKey('team-x', 'user-x');
    expect(key).toHaveLength(43);
    expect(key).not.toMatch(/[+/=]/);
  });
});
