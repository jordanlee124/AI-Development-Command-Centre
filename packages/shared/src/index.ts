// Contracts between the Agent Bridge (apps/bridge) and the web app's bridge API. Pure: Zod only.
// What crosses the bridge is redacted metadata: never prompt, response, tool input or tool output
// text. The only free text is a tool name, a session title, a redacted, clipped error line, and
// short provider metadata (client name, version, subagent role).
import { z } from "zod";

/** Requests above this are refused by the web app; the bridge chunks below it. */
export const MAX_EVENTS_PER_BATCH = 500;

const isoDate = z.iso.datetime({ offset: true });
const tokenCount = z.number().int().min(0).max(2_147_483_647);

/** Disjoint token counts for one model response (see TokenTotals in apps/web/src/domain/agent.ts). */
export const tokenUsageSchema = z.object({
  model: z.string().min(1).max(200),
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  cacheReadTokens: tokenCount,
  cacheWriteTokens: tokenCount,
  reasoningTokens: tokenCount,
});

/** The agent tools ADCC reads (Prisma enum AgentSource). */
export const AGENT_SOURCES = ["CLAUDE_CODE", "CODEX"] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

export const SESSION_EVENT_TYPES = [
  "message.user",
  "message.assistant",
  "tool.use",
  "operation.completed",
  "tool.error",
  "api.error",
  "session.compacted",
  "turn.completed",
  "turn.aborted",
] as const;
export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number];
export const ERROR_EVENT_TYPES = ["tool.error", "api.error"] as const satisfies SessionEventType[];

export const sessionEventSchema = z.object({
  /** Stable per session (record uuid, message id or tool-use id): re-sending is idempotent. */
  externalId: z.string().min(1).max(200),
  type: z.enum(SESSION_EVENT_TYPES),
  occurredAt: isoDate,
  /** 1-based line in the transcript file (ADR-004). */
  sourceLine: z.number().int().min(1),
  /** Tool name for tool.use and operation.completed; redacted, clipped error text for errors. */
  summary: z.string().max(500).nullable(),
  /** Error or abort code the tool recorded, e.g. "rate_limit", "interrupted". */
  code: z.string().max(100).nullable(),
  usage: tokenUsageSchema.nullable(),
});

export const sessionBatchSchema = z.object({
  source: z.enum(AGENT_SOURCES),
  /** The tool's own session id (Claude Code: the file name; Codex: session_meta id). */
  sessionId: z.string().regex(/^[\w-]{1,200}$/),
  sourcePath: z.string().min(1).max(1000),
  cwd: z.string().max(1000).nullable(),
  gitBranch: z.string().max(255).nullable(),
  title: z.string().max(300).nullable(),
  /** Provider-specific metadata to show as-is ("Client": "Codex Desktop"). Empty = none known. */
  details: z
    .array(z.object({ label: z.string().min(1).max(50), value: z.string().min(1).max(300) }))
    .max(10),
  /** Records in the file so far that the parser didn't recognise (cumulative, not per batch). */
  skippedRecords: tokenCount,
  events: z.array(sessionEventSchema).max(MAX_EVENTS_PER_BATCH),
});

/** One entry of `claude agents --json`, the documented live-session listing. */
export const liveSessionSchema = z.object({
  sessionId: z.string().max(200).nullable(),
  cwd: z.string().max(1000),
  kind: z.string().max(50),
  /** busy | waiting | idle per the docs; kept as text so a new value can't break ingest. */
  status: z.string().max(50).nullable(),
  startedAt: isoDate,
});

/** Also enforced by the bridge's config, so a config the web app would refuse can't start. */
export const approvedFoldersSchema = z.array(z.string().min(1).max(1000)).min(1).max(50);

/** What one provider's session folder looked like this cycle (connection diagnostics). */
export const providerStatusSchema = z.object({
  source: z.enum(AGENT_SOURCES),
  dataDir: z.string().max(1000),
  /** Candidate session files found; files outside approved folders are among them, unread. */
  files: tokenCount,
  /** Why the folder (or part of it) couldn't be listed; null when it could. */
  error: z.string().max(500).nullable(),
});

export const bridgeStatusSchema = z.object({
  version: z.string().max(50),
  pollSeconds: z.number().int().min(1).max(3600),
  approvedFolders: approvedFoldersSchema,
  live: z.discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      checkedAt: isoDate,
      sessions: z.array(liveSessionSchema).max(200),
    }),
    z.object({ ok: z.literal(false), checkedAt: isoDate, error: z.string().max(500) }),
  ]),
  // Defaulted so a report stored before Phase 6 still parses.
  providers: z.array(providerStatusSchema).max(10).default([]),
  /** Problems the bridge hit this cycle (unreadable folder, …). Never secrets or file content. */
  errors: z.array(z.string().max(500)).max(20),
});

/** POST /api/bridge/ingest. Sent every poll, with no sessions when nothing changed (a heartbeat). */
export const ingestRequestSchema = z.object({
  bridge: bridgeStatusSchema,
  sessions: z.array(sessionBatchSchema).max(20),
});

export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type SessionEvent = z.infer<typeof sessionEventSchema>;
export type SessionBatch = z.infer<typeof sessionBatchSchema>;
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
export type LiveSession = z.infer<typeof liveSessionSchema>;
export type BridgeStatus = z.infer<typeof bridgeStatusSchema>;
export type IngestRequest = z.infer<typeof ingestRequestSchema>;

function normalizeFolder(path: string): string {
  return path.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

/**
 * Windows paths, case-insensitive: is `path` the folder itself or somewhere inside it?
 * String comparison only, so a path that could climb out ("." / ".." segments) or uses the
 * "\\?\" form is refused rather than resolved. Junctions are not followed.
 */
export function isInsideFolder(path: string, folder: string): boolean {
  const p = normalizeFolder(path);
  const f = normalizeFolder(folder);
  if (p.startsWith("\\\\?\\") || p.split("\\").some((s) => s === "." || s === "..")) return false;
  return f !== "" && (p === f || p.startsWith(`${f}\\`));
}
