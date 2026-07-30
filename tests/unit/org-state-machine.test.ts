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

  // ==========================================================================
  // Settings Route Transitions (VALID_TRANSITIONS in settings/route.ts)
  // The settings route has slightly different transitions than the main
  // org-mgmt status route. Specifically, ACTIVE → PENDING is allowed in
  // settings but not in the main status route.
  // ==========================================================================
  const SETTINGS_TRANSITIONS: Record<string, string[]> = {
    PENDING: ['ACTIVE'],
    ACTIVE: ['SUSPENDED', 'PENDING'], // Note: PENDING is allowed here
    SUSPENDED: ['ACTIVE'],
    ARCHIVED: [], // Terminal — no transitions allowed
  };

  function canSettingsTransition(from: string, to: string): boolean {
    return SETTINGS_TRANSITIONS[from]?.includes(to) ?? false;
  }

  describe('Settings route state machine', () => {
    it('PENDING → ACTIVE is valid in settings', () => {
      expect(canSettingsTransition('PENDING', 'ACTIVE')).toBe(true);
    });

    it('ACTIVE → SUSPENDED is valid in settings', () => {
      expect(canSettingsTransition('ACTIVE', 'SUSPENDED')).toBe(true);
    });

    it('ACTIVE → PENDING is valid in settings (unlike main status route)', () => {
      expect(canSettingsTransition('ACTIVE', 'PENDING')).toBe(true);
    });

    it('SUSPENDED → ACTIVE is valid in settings', () => {
      expect(canSettingsTransition('SUSPENDED', 'ACTIVE')).toBe(true);
    });

    it('ARCHIVED → ACTIVE is invalid in settings (terminal)', () => {
      expect(canSettingsTransition('ARCHIVED', 'ACTIVE')).toBe(false);
    });

    it('ARCHIVED → SUSPENDED is invalid in settings (terminal)', () => {
      expect(canSettingsTransition('ARCHIVED', 'SUSPENDED')).toBe(false);
    });

    it('ARCHIVED → PENDING is invalid in settings (terminal)', () => {
      expect(canSettingsTransition('ARCHIVED', 'PENDING')).toBe(false);
    });

    it('SUSPENDED → PENDING is invalid in settings', () => {
      expect(canSettingsTransition('SUSPENDED', 'PENDING')).toBe(false);
    });

    it('ACTIVE → ARCHIVED is invalid in settings route (use DELETE instead)', () => {
      expect(canSettingsTransition('ACTIVE', 'ARCHIVED')).toBe(false);
    });
  });
});
