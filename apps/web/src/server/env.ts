import { z } from "zod";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/, error: "must be a postgresql:// URL" }),
  // Optional: without it the GitHub pages say "not connected". Fine-grained only, so the token
  // can be limited to read permissions on chosen repositories (ADR-016). Blank means unset.
  GITHUB_TOKEN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .regex(/^github_pat_\w{20,}$/, {
        error: "must be a fine-grained personal access token (starts with github_pat_)",
      })
      .optional(),
  ),
  // Overridable for tests (a local mock server) and GitHub Enterprise.
  GITHUB_API_URL: z
    .url({ protocol: /^https?$/ })
    .refine((url) => url.startsWith("https:") || LOOPBACK.has(new URL(url).hostname), {
      error: "must be https:// (http:// only for a loopback test server)",
    })
    .default("https://api.github.com"),
  // Shared secret the Agent Bridge sends as a bearer token. Blank = bridge API off (503).
  ADCC_BRIDGE_TOKEN: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(32, { error: "must be at least 32 characters" }).optional(),
  ),
  // 0 turns background sync off; manual refresh still works.
  // A blank value means the default, not 0 (off).
  GITHUB_SYNC_INTERVAL_MINUTES: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce
      .number()
      .int()
      .refine((n) => n === 0 || (n >= 5 && n <= 1440), { error: "must be 0 or 5–1440" })
      .default(15),
  ),
});

export type Env = z.infer<typeof envSchema>;

/** Validates env vars. The error lists bad keys only, never their values (they hold secrets). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
