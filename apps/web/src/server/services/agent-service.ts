import type { IngestRequest } from "@adcc/shared";
import {
  BRIDGE_STATUS_KEY,
  bridgeConnection,
  liveCheck,
  matchProjectByCwd,
  parseSessionDetails,
  sessionState,
  storedBridgeStatusSchema,
  sumTokenTotals,
  type AgentSource,
  type StoredBridgeStatus,
} from "@/domain/agent";
import {
  countEventsByType,
  countSessionsBySource,
  errorCountsBySession,
  getSession,
  listProjectPaths,
  listSessionErrors,
  listSessionEvents,
  listSessions,
  saveSessionBatch,
  toolUseCounts,
  usageBySessionAndModel,
  type SessionModelUsage,
} from "@/server/db/agents";
import { idSchema } from "@/domain/validation";
import { getSetting, setSetting } from "@/server/db/settings";
import { getEnv } from "@/server/env";

// shortcut: fixed list sizes, no pagination; add paging when real data outgrows them.
const SESSION_LIMIT = 200;
const TIMELINE_LIMIT = 200;
const ERROR_LIMIT = 50;

/** Stores the bridge's report (connection, live sessions) and upserts its session batches. */
export async function ingestBridgeReport(request: IngestRequest, now = new Date()) {
  const status: StoredBridgeStatus = { ...request.bridge, lastSeenAt: now.toISOString() };
  await setSetting(BRIDGE_STATUS_KEY, storedBridgeStatusSchema.parse(status));

  const projects =
    request.sessions.length > 0
      ? (await listProjectPaths()).flatMap((p) =>
          p.localPath ? [{ id: p.id, localPath: p.localPath }] : [],
        )
      : [];
  let insertedEvents = 0;
  for (const batch of request.sessions) {
    const saved = await saveSessionBatch(batch, matchProjectByCwd(batch.cwd, projects));
    insertedEvents += saved.insertedEvents;
  }
  return { sessions: request.sessions.length, insertedEvents };
}

async function readBridgeStatus(): Promise<StoredBridgeStatus | null> {
  const value = await getSetting(BRIDGE_STATUS_KEY);
  if (value === null) return null;
  // A report stored by an older ADCC that no longer fits is "no report", until the next one.
  const parsed = storedBridgeStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function bridgeSummary(bridge: StoredBridgeStatus | null, now: Date) {
  return {
    configured: getEnv().ADCC_BRIDGE_TOKEN !== undefined,
    status: bridge,
    connection: bridgeConnection(bridge, now),
    live: liveCheck(bridge, now),
  };
}

/** Latest-used model first. */
function byRecency(usage: SessionModelUsage[]) {
  return [...usage].sort((a, b) => (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0));
}

/** Sessions of every tool, or of one (`source`), most recently active first. */
export async function getAgentsOverview(source?: AgentSource, now = new Date()) {
  const [bridge, sessions, counts] = await Promise.all([
    readBridgeStatus(),
    listSessions(SESSION_LIMIT, source),
    countSessionsBySource(),
  ]);
  const ids = sessions.map((s) => s.id);
  const [usage, errors] =
    ids.length > 0
      ? await Promise.all([usageBySessionAndModel(ids), errorCountsBySession(ids)])
      : [[], new Map<string, number>()];

  return {
    bridge: bridgeSummary(bridge, now),
    counts,
    sessions: sessions.map((session) => {
      const models = byRecency(usage.filter((u) => u.sessionId === session.id));
      return {
        ...session,
        details: parseSessionDetails(session.details),
        state: sessionState(session, bridge, now),
        models: models.map((m) => m.model),
        // null: no usage was recorded, which isn't the same as zero tokens (ADR-011).
        tokens: models.length > 0 ? sumTokenTotals(models) : null,
        errors: errors.get(session.id) ?? 0,
      };
    }),
  };
}

export type AgentsOverview = Awaited<ReturnType<typeof getAgentsOverview>>;

export async function getAgentSession(id: string, now = new Date()) {
  if (!idSchema.safeParse(id).success) return null;
  const session = await getSession(id);
  if (!session) return null;
  const [bridge, usage, timeline, errors, tools, operations, eventCounts] = await Promise.all([
    readBridgeStatus(),
    usageBySessionAndModel([id]),
    listSessionEvents(id, TIMELINE_LIMIT),
    listSessionErrors(id, ERROR_LIMIT),
    toolUseCounts(id),
    toolUseCounts(id, "operation.completed"),
    countEventsByType(id),
  ]);
  const models = byRecency(usage);
  return {
    session: { ...session, details: parseSessionDetails(session.details) },
    bridge: bridgeSummary(bridge, now),
    state: sessionState(session, bridge, now),
    models,
    tokens: models.length > 0 ? sumTokenTotals(models) : null,
    timeline,
    timelineLimit: TIMELINE_LIMIT,
    errors,
    errorCount: (eventCounts.get("tool.error") ?? 0) + (eventCounts.get("api.error") ?? 0),
    tools,
    operations,
    turns: {
      completed: eventCounts.get("turn.completed") ?? 0,
      aborted: eventCounts.get("turn.aborted") ?? 0,
      // Only Codex records turns; there, every API error is a turn that failed.
      failed: eventCounts.get("api.error") ?? 0,
    },
    eventCount: [...eventCounts.values()].reduce((sum, n) => sum + n, 0),
  };
}

export type AgentSessionDetail = NonNullable<Awaited<ReturnType<typeof getAgentSession>>>;
