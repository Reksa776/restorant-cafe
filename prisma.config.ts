import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },

  datasource: {
    // `prisma generate` only reads the schema, but it is also run while the
    // Docker image is being built, before runtime secrets are available.
    // Use a syntactically valid non-routable placeholder for that build-only
    // case. All database-changing commands receive DATABASE_URL at runtime;
    // application startup still rejects a missing value in src/lib/prisma.ts.
    url:
      process.env.DATABASE_URL ??
      "mysql://prisma_build:prisma_build@127.0.0.1:9/prisma_build",
  },
});
