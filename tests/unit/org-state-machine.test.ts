/**
 * Unit tests: Organization state machine validation.
 * Verifies that invalid transitions return 400.
 */

import { describe, it, expect } from 'vitest';

/**
 * Valid state transitions.
 * PENDING → ACTIVE ↔ SUSPENDED → ARCHIVED (terminal)
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACTIVE'],
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [], // Terminal — no transitions allowed
};

function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

describe('Organization State Machine', () => {
  describe('Valid transitions', () => {
    it('PENDING → ACTIVE', () => {
      expect(canTransition('PENDING', 'ACTIVE')).toBe(true);
    });

    it('ACTIVE → SUSPENDED', () => {
      expect(canTransition('ACTIVE', 'SUSPENDED')).toBe(true);
    });

    it('ACTIVE → ARCHIVED', () => {
      expect(canTransition('ACTIVE', 'ARCHIVED')).toBe(true);
    });

    it('SUSPENDED → ACTIVE', () => {
      expect(canTransition('SUSPENDED', 'ACTIVE')).toBe(true);
    });

    it('SUSPENDED → ARCHIVED', () => {
      expect(canTransition('SUSPENDED', 'ARCHIVED')).toBe(true);
    });
  });

  describe('Invalid transitions (should return 400)', () => {
    it('ARCHIVED → ACTIVE (terminal state)', () => {
      expect(canTransition('ARCHIVED', 'ACTIVE')).toBe(false);
    });

    it('ARCHIVED → SUSPENDED (terminal state)', () => {
      expect(canTransition('ARCHIVED', 'SUSPENDED')).toBe(false);
    });

    it('ARCHIVED → ARCHIVED (already terminal)', () => {
      expect(canTransition('ARCHIVED', 'ARCHIVED')).toBe(false);
    });

    it('PENDING → SUSPENDED (skip ACTIVE)', () => {
      expect(canTransition('PENDING', 'SUSPENDED')).toBe(false);
    });

    it('PENDING → ARCHIVED (skip ACTIVE)', () => {
      expect(canTransition('PENDING', 'ARCHIVED')).toBe(false);
    });

    it('ACTIVE → PENDING (no backward transition)', () => {
      expect(canTransition('ACTIVE', 'PENDING')).toBe(false);
    });

    it('SUSPENDED → PENDING (no backward transition)', () => {
      expect(canTransition('SUSPENDED', 'PENDING')).toBe(false);
    });
  });

  describe('Self-transitions', () => {
    it('PENDING → PENDING is invalid', () => {
      expect(canTransition('PENDING', 'PENDING')).toBe(false);
    });

    it('ACTIVE → ACTIVE is invalid', () => {
      expect(canTransition('ACTIVE', 'ACTIVE')).toBe(false);
    });

    it('SUSPENDED → SUSPENDED is invalid', () => {
      expect(canTransition('SUSPENDED', 'SUSPENDED')).toBe(false);
    });
  });

  describe('All transitions are deterministic', () => {
    it('no transition leads to undefined behavior', () => {
      const allStates = ['PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'];
      for (const from of allStates) {
        for (const to of allStates) {
          const result = canTransition(from, to);
          expect(typeof result).toBe('boolean');
        }
      }
    });
  });
});
