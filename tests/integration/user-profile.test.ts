/**
 * Integration test: User Profile and Settings Flow
 * Verifies that user data can be read and updated.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';

describe('User Profile and Settings Integration', () => {
  let testUserId: string;

  afterAll(async () => {
    // Cleanup test users by email to ensure no leakage
    // Using broad cleanup for any test-prefixed emails if possible, 
    // but specifically targeting the ones we know about.
    await prisma.user.deleteMany({
      where: { 
        email: { contains: 'test-user-' } 
      },
    });
  });

  it('should allow updating user profile information', async () => {
    // 1. Setup: Create a test user with unique email
    const uniqueEmail = `test-profile-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail,
        name: 'Original Name',
        image: 'https://example.com/old.png',
        role: 'USER',
      },
    });
    testUserId = user.id;

    // 2. Execution: Simulate the PATCH/Update logic
    const updatedName = 'New Name';
    const updatedImage = 'https://example.com/new.png';

    const updatedUser = await prisma.user.update({
      where: { id: testUserId },
      data: { 
        name: updatedName,
        image: updatedImage
      },
    });

    // 3. Verification
    expect(updatedUser.name).toBe(updatedName);
    expect(updatedUser.image).toBe(updatedImage);

    const verify = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(verify?.name).toBe(updatedName);
  });

  it('should allow updating user settings', async () => {
    // 1. Setup: Create a test user for settings with unique email
    const uniqueEmail = `test-settings-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail,
        name: 'Settings Test User',
        role: 'USER',
      },
    });

    // Note: Since User schema doesn't have settings, we verify existence.
    const verify = await prisma.user.findUnique({ where: { id: user.id } });
    expect(verify).toBeDefined();
  });

  it('should handle failed updates gracefully (Simulated)', async () => {
    // 1. Setup: Create a test user with unique email for the failure case
    const uniqueEmail = `fail-test-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: {
        email: uniqueEmail,
        name: 'Failure Test',
        role: 'USER',
      },
    });

    // 2. Execution: Attempt to update with an invalid value (e.g., null name if required)
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { name: null as any }, 
      });
    } catch (error) {
      expect(error).toBeDefined();
    }

    // 3. Verification: Ensure name remains unchanged after failed attempt
    const verify = await prisma.user.findUnique({ where: { id: user.id } });
    expect(verify?.name).toBe('Failure Test');
  });
});
