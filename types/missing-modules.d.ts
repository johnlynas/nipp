// Stubs for optional platform-specific imports in @better-auth/core.
// These are only used when running on Bun or Cloudflare Workers —
// we run on Node.js, so empty declarations satisfy the type checker.

declare module 'bun:sqlite' {
  export class Database {
    constructor(filename: string);
  }
}

declare module '@cloudflare/workers-types' {
  export type D1Database = object;
}
