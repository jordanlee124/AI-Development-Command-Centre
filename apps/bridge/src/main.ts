// ADCC Agent Bridge: reads Claude Code and Codex session metadata on this machine and sends it
// to the ADCC web app on loopback. Read-only: it opens no port (ADR-003), runs no command except
// the fixed `claude agents --json` (claude-live.ts), and changes no file.
import type { BridgeStatus, IngestRequest, ProviderStatus } from "@adcc/shared";
import { readLiveSessions } from "./claude-live.ts";
import { claudeProvider } from "./claude-transcript.ts";
import { codexProvider } from "./codex-rollout.ts";
import { parseConfig } from "./config.ts";
import { TranscriptScanner } from "./scanner.ts";

const VERSION = "0.2.0";

const config = parseConfig(process.env);
const scanners = [
  claudeProvider(config.CLAUDE_PROJECTS_DIR, config.BRIDGE_APPROVED_FOLDERS),
  codexProvider(config.CODEX_HOME),
].map((provider) => new TranscriptScanner(provider, config.BRIDGE_APPROVED_FOLDERS));
const endpoint = new URL("/api/bridge/ingest", config.ADCC_WEB_URL);

/** The web app answered and refused this request (as opposed to being unreachable). */
class Rejected extends Error {}

async function send(body: IngestRequest): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.ADCC_BRIDGE_TOKEN}`,
    },
    body: JSON.stringify(body),
    // Never follow a redirect: the body would go wherever it points.
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // The web app's messages never echo the token; clip in case of an unexpected HTML page.
    throw new Rejected(
      `ADCC answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
}

async function status(problems: string[], providers: ProviderStatus[]): Promise<BridgeStatus> {
  return {
    version: VERSION,
    pollSeconds: config.BRIDGE_POLL_SECONDS,
    approvedFolders: config.BRIDGE_APPROVED_FOLDERS,
    live: await readLiveSessions(config.CLAUDE_EXE, config.BRIDGE_APPROVED_FOLDERS),
    providers,
    errors: problems.slice(0, 20).map((p) => p.slice(0, 500)),
  };
}

/** Each provider listed on its own, so one that fails can't stop the other. */
async function listAll() {
  return Promise.all(
    scanners.map(async (scanner) => {
      const { source, dataDir } = scanner.provider;
      let listed: { files: string[]; errors: string[] };
      try {
        listed = await scanner.listFiles();
      } catch (error) {
        listed = { files: [], errors: [error instanceof Error ? error.message : String(error)] };
      }
      const status: ProviderStatus = {
        source,
        dataDir,
        files: listed.files.length,
        error: listed.errors.length > 0 ? listed.errors.join("; ").slice(0, 500) : null,
      };
      return { scanner, files: listed.files, status };
    }),
  );
}

/** Problems from the last cycle's sends, reported with the next heartbeat. */
let carried: string[] = [];

async function cycle(): Promise<void> {
  const listed = await listAll();
  const providers = listed.map((l) => l.status);
  const problems = [...carried];
  let bridge = await status(problems, providers);
  if (!bridge.live.ok) console.warn(`[bridge] ${bridge.live.error}`);
  for (const p of providers) if (p.error) console.warn(`[bridge] ${p.source}: ${p.error}`);
  for (const message of problems) console.warn(`[bridge] ${message}`);
  // Heartbeat first, so connection and live status stay current even if a file can't be sent.
  await send({ bridge, sessions: [] });
  carried = [];

  for (const { scanner, path } of listed.flatMap((l) =>
    l.files.map((path) => ({ scanner: l.scanner, path })),
  )) {
    // One file at a time, a bounded read each, until it's caught up.
    for (;;) {
      let file;
      try {
        file = await scanner.read(path);
      } catch (error) {
        carried.push(`Can't read ${path}: ${error instanceof Error ? error.message : error}`);
        break;
      }
      if (!file) break;
      try {
        for (const batch of file.batches) {
          // A long catch-up mustn't present an old live check as current.
          if (Date.now() - Date.parse(bridge.live.checkedAt) > config.BRIDGE_POLL_SECONDS * 1000) {
            bridge = await status(problems, providers);
          }
          await send({ bridge, sessions: [batch] });
        }
      } catch (error) {
        if (!(error instanceof Rejected)) throw error; // unreachable: stop, retry next poll
        carried.push(`${path}: ${error.message}`); // skip this file, keep the others flowing
        break;
      }
      file.commit();
      const events = file.batches.reduce((n, b) => n + b.events.length, 0);
      if (events > 0) console.log(`[bridge] ${path}: ${events} events`);
    }
  }
}

async function loop(): Promise<void> {
  try {
    await cycle();
  } catch (error) {
    // Unsent lines stay uncommitted and are read again next time.
    console.error(
      `[bridge] send failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  setTimeout(loop, config.BRIDGE_POLL_SECONDS * 1000);
}

console.log(
  `[bridge] ADCC Agent Bridge ${VERSION} → ${endpoint.origin}, every ${config.BRIDGE_POLL_SECONDS}s, ` +
    `approved folders: ${config.BRIDGE_APPROVED_FOLDERS.join("; ")}, ` +
    `reading: ${scanners.map((s) => s.provider.dataDir).join("; ")}`,
);
void loop();
