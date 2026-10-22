import { homedir } from "node:os";
import { join, win32 } from "node:path";
import { approvedFoldersSchema } from "@adcc/shared";
import { z } from "zod";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const blankIsUnset = (value: unknown) => (value === "" ? undefined : value);

const configSchema = z.object({
  // Loopback only: the bridge token and session metadata never leave this machine.
  ADCC_WEB_URL: z
    .url({ protocol: /^http$/ })
    .refine((url) => LOOPBACK.has(new URL(url).hostname), {
      error: "must be http://127.0.0.1 or http://localhost",
    })
    .default("http://127.0.0.1:3000"),
  ADCC_BRIDGE_TOKEN: z.string().min(32, { error: "must be at least 32 characters" }),
  BRIDGE_APPROVED_FOLDERS: z
    .string({ error: "is required: list the project folders the bridge may read" })
    .transform((value) =>
      value
        .split(";")
        .map((folder) => folder.trim())
        .filter((folder, i, all) => folder !== "" && all.indexOf(folder) === i),
    )
    .pipe(
      z
        .array(
          z
            .string()
            .refine(
              (folder) => win32.isAbsolute(folder) && !/(^|[\\/])\.\.?([\\/]|$)/.test(folder),
              {
                error: "each folder must be an absolute Windows path without . or ..",
              },
            ),
        )
        .min(1, { error: "must list at least one folder" })
        .pipe(approvedFoldersSchema),
    ),
  CLAUDE_PROJECTS_DIR: z.preprocess(
    blankIsUnset,
    z.string().default(join(homedir(), ".claude", "projects")),
  ),
  // Codex's own variable, so a custom location set for Codex is picked up as-is.
  CODEX_HOME: z.preprocess(blankIsUnset, z.string().default(join(homedir(), ".codex"))),
  // An .exe only: Node can't run claude.cmd without a shell, and the bridge never uses one.
  CLAUDE_EXE: z.preprocess(
    blankIsUnset,
    z
      .string()
      .regex(/\.exe$/i, { error: "must be the path to claude.exe" })
      // A relative name would be looked up in the current folder first.
      .refine((exe) => win32.isAbsolute(exe), { error: "must be an absolute path" })
      .default(
        join(
          process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
          "npm",
          "node_modules",
          "@anthropic-ai",
          "claude-code",
          "bin",
          "claude.exe",
        ),
      ),
  ),
  BRIDGE_POLL_SECONDS: z.preprocess(
    blankIsUnset,
    z.coerce.number().int().min(5).max(300).default(10),
  ),
});

export type Config = z.infer<typeof configSchema>;

/** The error names bad keys only, never their values (the token is a secret). */
export function parseConfig(source: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid bridge configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
