import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7: the CLI no longer loads .env or reads datasource URLs from the
// schema at runtime — prisma.config.ts is the single source of truth for
// CLI operations (migrate / db push / studio / seed / diff).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Same URL the app role connects with (DATABASE_URL). RLS bootstrap DDL
    // for the owner account is handled inside prisma/seed.ts via SEED_RLS_DSN.
    url: env("DATABASE_URL"),
  },
});
