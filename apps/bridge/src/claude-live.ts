// Live session state from `claude agents --json`, which the Claude Code docs name as the
// supported way to read session state from outside Claude Code (ADR-017).
// This is the bridge's only process launch: a fixed executable and fixed arguments, no shell,
// no input from any agent or request. Nothing here can run anything else.
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import type { BridgeStatus, LiveSession } from "@adcc/shared";
import { isInsideFolder } from "@adcc/shared";
import { z } from "zod";
import { redact } from "./redact.ts";

const ARGS = ["agents", "--json"] as const;

const entrySchema = z.looseObject({
  cwd: z.string().max(1000),
  kind: z.string().max(50),
  startedAt: z.number().int().positive(),
  sessionId: z.string().max(200).optional(),
  status: z.string().max(50).optional(),
});

export type Run = (exe: string, args: readonly string[]) => Promise<string>;

const runFile: Run = (exe, args) =>
  new Promise((resolve, reject) => {
    execFile(
      exe,
      args,
      {
        shell: false,
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
        // Not the repo folder (no project settings to pick up), and without the bridge token.
        cwd: homedir(),
        env: { ...process.env, ADCC_BRIDGE_TOKEN: undefined },
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });

/** Sessions in approved folders only; entries that don't match the documented shape are dropped. */
export function parseLiveSessions(
  stdout: string,
  approvedFolders: readonly string[],
): LiveSession[] {
  const list = z.array(z.unknown()).parse(JSON.parse(stdout));
  return list.flatMap((item) => {
    const entry = entrySchema.safeParse(item);
    if (!entry.success || !approvedFolders.some((f) => isInsideFolder(entry.data.cwd, f)))
      return [];
    return [
      {
        sessionId: entry.data.sessionId ?? null,
        cwd: entry.data.cwd,
        kind: entry.data.kind,
        status: entry.data.status ?? null,
        startedAt: new Date(entry.data.startedAt).toISOString(),
      },
    ];
  });
}

export async function readLiveSessions(
  exe: string,
  approvedFolders: readonly string[],
  run: Run = runFile,
  now = () => new Date(),
): Promise<BridgeStatus["live"]> {
  try {
    const sessions = parseLiveSessions(await run(exe, ARGS), approvedFolders);
    return { ok: true, checkedAt: now().toISOString(), sessions: sessions.slice(0, 200) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      checkedAt: now().toISOString(),
      error: redact(`claude agents --json failed: ${message}`, 300),
    };
  }
}
