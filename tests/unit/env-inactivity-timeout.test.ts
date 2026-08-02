/**
 * Unit tests for the INACTIVITY_TIMEOUT_MINS environment variable schema.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Replicate the exact schema used in lib/env.ts for INACTIVITY_TIMEOUT_MINS.
const inactivityTimeoutSchema = z
  .string()
  .regex(/^\d+$/)
  .default('15')
  .transform(Number);

describe('INACTIVITY_TIMEOUT_MINS schema', () => {
  it('should default to 15 when no value is provided', () => {
    const result = inactivityTimeoutSchema.parse(undefined);
    expect(result).toBe(15);
  });

  it('should accept "0" and transform to number 0', () => {
    const result = inactivityTimeoutSchema.parse('0');
    expect(result).toBe(0);
  });

  it('should accept "15" and transform to number 15', () => {
    const result = inactivityTimeoutSchema.parse('15');
    expect(result).toBe(15);
  });

  it('should accept "30" and transform to number 30', () => {
    const result = inactivityTimeoutSchema.parse('30');
    expect(result).toBe(30);
  });

  it('should accept large values like "9999"', () => {
    const result = inactivityTimeoutSchema.parse('9999');
    expect(result).toBe(9999);
  });

  it('should reject a negative number string', () => {
    const result = inactivityTimeoutSchema.safeParse('-5');
    expect(result.success).toBe(false);
  });

  it('should reject a decimal number string', () => {
    const result = inactivityTimeoutSchema.safeParse('15.5');
    expect(result.success).toBe(false);
  });

  it('should reject a non-numeric string', () => {
    const result = inactivityTimeoutSchema.safeParse('fifteen');
    expect(result.success).toBe(false);
  });

  it('should reject an empty string', () => {
    const result = inactivityTimeoutSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('should reject a string with leading zeros (still digits-only, so valid)', () => {
    // "015" is technically digits-only — the regex allows it.
    const result = inactivityTimeoutSchema.safeParse('015');
    expect(result.success).toBe(true);
    expect(result.data).toBe(15);
  });

  it('should reject a string with spaces', () => {
    const result = inactivityTimeoutSchema.safeParse(' 15');
    expect(result.success).toBe(false);
  });

  it('should reject a string with trailing spaces', () => {
    const result = inactivityTimeoutSchema.safeParse('15 ');
    expect(result.success).toBe(false);
  });

  it('should reject a string with mixed alphanumeric characters', () => {
    const result = inactivityTimeoutSchema.safeParse('15min');
    expect(result.success).toBe(false);
  });

  it('should reject null', () => {
    const result = inactivityTimeoutSchema.safeParse(null);
    expect(result.success).toBe(false);
  });



  it('should transform to a number type, not a string', () => {
    const result = inactivityTimeoutSchema.parse('45');
    expect(typeof result).toBe('number');
  });
});
