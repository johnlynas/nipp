// Single re-export choke point for the Prisma 7 generated client.
//
// The generator (prisma/schema.prisma) emits an ESM client into
// ./prisma/generated — in Prisma 7 there is no `@prisma/client` package
// surface anymore, and a barrel here keeps every import site at a one-word
// path swap (`@prisma/client` → `lib/prisma`) with zero API drift: the
// client's full export set (PrismaClient value, Prisma namespace, enums,
// model types) passes through unchanged.
export * from '@/prisma/generated/prisma/client';
