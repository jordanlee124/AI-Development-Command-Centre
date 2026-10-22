import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/** E2E writes real rows, so it gets its own database and never touches the dev one. */
export const E2E_DATABASE = "adcc_e2e";

/** DATABASE_URL from the environment or apps/web/.env, pointed at the e2e database. */
export function e2eDatabaseUrl(): string | undefined {
  const envFile = new URL("../.env", import.meta.url);
  const base =
    process.env.DATABASE_URL ??
    (existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")).DATABASE_URL : undefined);
  if (!base) return undefined;
  const url = new URL(base);
  url.pathname = `/${E2E_DATABASE}`;
  return url.toString();
}
