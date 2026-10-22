import { execSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { E2E_DATABASE, e2eDatabaseUrl } from "./database";

function client(url: string) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 3000 }),
  });
}

/**
 * Creates the e2e database if needed, migrates it, and empties it, so every run starts clean.
 * If Postgres is down, it says so and returns: database tests then skip, the rest still run.
 */
export default async function globalSetup() {
  const url = e2eDatabaseUrl();
  if (!url) {
    console.warn("[e2e] No DATABASE_URL; database tests will skip.");
    return;
  }
  // Guard: the truncate below must only ever hit the e2e database.
  if (new URL(url).pathname !== `/${E2E_DATABASE}`) throw new Error(`Refusing to reset ${url}`);

  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  const admin = client(maintenance.toString());
  try {
    const rows = await admin.$queryRaw<{ n: number }[]>`
      SELECT 1 AS n FROM pg_database WHERE datname = ${E2E_DATABASE}`;
    if (rows.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${E2E_DATABASE}"`);
  } catch (error) {
    console.warn(`[e2e] Postgres unreachable; database tests will skip. (${String(error)})`);
    return;
  } finally {
    await admin.$disconnect();
  }

  execSync("pnpm exec prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });

  const db = client(url);
  try {
    const tables = await db.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
    if (list) await db.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
  } finally {
    await db.$disconnect();
  }
}
