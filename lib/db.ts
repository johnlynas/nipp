import { PrismaClient } from '@prisma/client';
import { env } from '@/lib/env';

/**
 * Prisma Client singleton.
 *
 * In development, we use a global variable to prevent multiple instances
 * during hot-reloading. In production, a single instance is created per process.
 */
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma || new PrismaClient();

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
