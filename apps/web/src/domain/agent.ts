import {
  bridgeStatusSchema,
  isInsideFolder,
  sessionBatchSchema,
  SESSION_EVENT_TYPES,
  type AgentSource,
  type LiveSession,
  type SessionEventType,
} from "@adcc/shared";
import { z } from "zod";

export { AGENT_SOURCES, type AgentSource } from "@adcc/shared";

export const AGENT_SOURCE_LABELS: Record<AgentSource, string> = {
  CLAUDE_CODE: "Claude Code",
  CODEX: "Codex",
};

/**
 * What ADCC can read for each tool (ADR-017, ADR-018). Shown on the agent pages so a missing
 * value reads as "this tool doesn't report it", not as a fault.
 */
export const PROVIDER_CAPABILITIES: Record<
  AgentSource,
  {
    liveStatus: string | null;
    titles: string;
    /** Records turns and the operations (commands, edits, MCP calls) that ran in them. */
    operations: boolean;
  }
> = {
  CLAUDE_CODE: {
    liveStatus: "claude agents --json",
    titles: "AI-generated title in the transcript",
    operations: false,
  },
  CODEX: {
    liveStatus: null,
    titles: "Thread name from ~/.codex/session_index.jsonl",
    operations: true,
  },
};

/** Stored AgentSession.details; anything else (an older row, bad JSON) reads as none. */
export function parseSessionDetails(value: unknown) {
  const parsed = sessionBatchSchema.shape.details.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/**
 * Disjoint token counts: no field includes another, so they sum to the true total.
 * Parsers must normalise to this (e.g. OpenAI reports cached input inside input and
 * reasoning inside output; subtract those before storing).
 */
export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

export function totalTokens(t: TokenTotals): number {
  return (
    t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens + t.reasoningTokens
  );
}

export function sumTokenTotals(rows: readonly TokenTotals[]): TokenTotals {
  const sum: TokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  };
  for (const row of rows) {
    sum.inputTokens += row.inputTokens;
    sum.outputTokens += row.outputTokens;
    sum.cacheReadTokens += row.cacheReadTokens;
    sum.cacheWriteTokens += row.cacheWriteTokens;
    sum.reasoningTokens += row.reasoningTokens;
  }
  return sum;
}

// --- Claude Code monitoring (Phase 5, ADR-017) ---

/** The bridge's last report, as stored by the web app (application setting "bridge.status"). */
export const storedBridgeStatusSchema = bridgeStatusSchema.extend({
  lastSeenAt: z.iso.datetime({ offset: true }),
});
export type StoredBridgeStatus = z.infer<typeof storedBridgeStatusSchema>;
export const BRIDGE_STATUS_KEY = "bridge.status";

export type BridgeConnection =
  { kind: "never" } | { kind: "connected"; lastSeenAt: Date } | { kind: "stale"; lastSeenAt: Date };

/** Connected while reports keep arriving: within three poll intervals (at least 30 s). */
/** How long a report, or the live check inside it, counts as current. */
function freshFor(status: StoredBridgeStatus) {
  return Math.max(3 * status.pollSeconds, 30) * 1000;
}

export function bridgeConnection(status: StoredBridgeStatus | null, now: Date): BridgeConnection {
  if (!status) return { kind: "never" };
  const lastSeenAt = new Date(status.lastSeenAt);
  const fresh = now.getTime() - lastSeenAt.getTime() <= freshFor(status);
  return { kind: fresh ? "connected" : "stale", lastSeenAt };
}

/** The current live-session list, or why there isn't one. */
export function liveCheck(
  bridge: StoredBridgeStatus | null,
  now: Date,
): { ok: true; sessions: LiveSession[]; checkedAt: Date } | { ok: false; reason: string } {
  if (!bridge) return { ok: false, reason: "The Agent Bridge has never reported." };
  if (bridgeConnection(bridge, now).kind !== "connected") {
    return { ok: false, reason: "The Agent Bridge stopped reporting." };
  }
  if (!bridge.live.ok) return { ok: false, reason: "The live session check failed." };
  // A report can be new while the check it carries is old (a long catch-up after a restart).
  const checkedAt = new Date(bridge.live.checkedAt);
  if (now.getTime() - checkedAt.getTime() > freshFor(bridge)) {
    return { ok: false, reason: "The live session check is out of date." };
  }
  return { ok: true, sessions: bridge.live.sessions, checkedAt };
}

/**
 * What ADCC can honestly say about a session right now. "running" and "not-running" come only
 * from a current `claude agents --json` check; otherwise the page shows last-observed activity.
 */
export type SessionState =
  | { kind: "running"; status: string | null; checkedAt: Date }
  | { kind: "not-running"; checkedAt: Date }
  | { kind: "unverified"; reason: string };

export function sessionState(
  session: { source: AgentSource; externalId: string },
  bridge: StoredBridgeStatus | null,
  now: Date,
): SessionState {
  // The live check lists Claude Code sessions only. Codex has no supported way to ask which
  // sessions are running (ADR-018), and recent activity isn't proof, so it stays unverified.
  if (session.source !== "CLAUDE_CODE") {
    return {
      kind: "unverified",
      reason: `${AGENT_SOURCE_LABELS[session.source]} has no supported live session check.`,
    };
  }
  const check = liveCheck(bridge, now);
  if (!check.ok) return { kind: "unverified", reason: check.reason };
  const live = check.sessions.find((s) => s.sessionId === session.externalId);
  return live
    ? { kind: "running", status: live.status, checkedAt: check.checkedAt }
    : { kind: "not-running", checkedAt: check.checkedAt };
}

/** The project whose folder holds `cwd`; the deepest folder wins when projects nest. */
export function matchProjectByCwd(
  cwd: string | null,
  projects: readonly { id: string; localPath: string }[],
): string | null {
  if (!cwd) return null;
  let best: { id: string; length: number } | null = null;
  for (const project of projects) {
    if (isInsideFolder(cwd, project.localPath) && project.localPath.length > (best?.length ?? -1)) {
      best = { id: project.id, length: project.localPath.length };
    }
  }
  return best?.id ?? null;
}

export const SESSION_EVENT_LABELS: Record<SessionEventType, string> = {
  "message.user": "User prompt",
  "message.assistant": "Model response",
  "tool.use": "Tool use",
  "operation.completed": "Operation completed",
  "tool.error": "Tool error",
  "api.error": "API error",
  "session.compacted": "Context compacted",
  "turn.completed": "Turn completed",
  "turn.aborted": "Turn aborted",
};

export function isSessionEventType(type: string): type is SessionEventType {
  return (SESSION_EVENT_TYPES as readonly string[]).includes(type);
}
