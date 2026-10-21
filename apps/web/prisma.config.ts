import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer loads .env itself; Next.js reads the same file.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Not required for `prisma generate`, so a fresh clone without .env still installs.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
