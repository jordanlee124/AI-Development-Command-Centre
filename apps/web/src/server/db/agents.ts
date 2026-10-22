import { ERROR_EVENT_TYPES, type SessionBatch } from "@adcc/shared";
import type { AgentSource, TokenTotals } from "@/domain/agent";
import { getPrisma } from "./client";

export function countSessions() {
  return getPrisma().agentSession.count();
}

export async function countSessionsBySource(): Promise<Map<AgentSource, number>> {
  const rows = await getPrisma().agentSession.groupBy({ by: ["source"], _count: { _all: true } });
  return new Map(rows.map((row) => [row.source, row._count._all]));
}

/** Sources (Claude Code, Codex) with at least one session event since the given time. */
export async function activeSourcesSince(since: Date) {
  const rows = await getPrisma().agentSession.groupBy({
    by: ["source"],
    where: { lastEventAt: { gte: since } },
  });
  return rows.map((row) => row.source);
}

export function listProjectPaths() {
  return getPrisma().project.findMany({
    where: { localPath: { not: null } },
    select: { id: true, localPath: true },
  });
}

const ROLES: Partial<Record<string, string>> = {
  "message.user": "user",
  "message.assistant": "assistant",
};

function earliest(a: Date | null, b: Date | null) {
  return a && b ? (a < b ? a : b) : (a ?? b);
}

function latest(a: Date | null, b: Date | null) {
  return a && b ? (a > b ? a : b) : (a ?? b);
}

/**
 * Upserts one batch from the bridge in one transaction. Idempotent: events are unique per
 * (session, externalId) and usage per event, so a re-sent batch adds nothing (ADR-008).
 * shortcut: find-then-create; two bridges creating one session at once would get a unique
 * violation (retried next poll). Use an upsert if more than one bridge ever runs.
 * A null cwd, branch, title or project (or empty details) never overwrites a known one.
 */
export async function saveSessionBatch(batch: SessionBatch, projectId: string | null) {
  const times = batch.events.map((e) => new Date(e.occurredAt));
  const first = times.reduce<Date | null>(earliest, null);
  const last = times.reduce<Date | null>(latest, null);
  const fields = {
    sourcePath: batch.sourcePath,
    cwd: batch.cwd ?? undefined,
    gitBranch: batch.gitBranch ?? undefined,
    title: batch.title ?? undefined,
    details: batch.details.length > 0 ? batch.details : undefined,
  };
  const key = { source: batch.source, externalId: batch.sessionId };

  return getPrisma().$transaction(async (tx) => {
    const existing = await tx.agentSession.findUnique({
      where: { source_externalId: key },
      select: { id: true, startedAt: true, lastEventAt: true, skippedRecordCount: true },
    });
    const { id: sessionId } = existing
      ? await tx.agentSession.update({
          where: { id: existing.id },
          data: {
            ...fields,
            projectId: projectId ?? undefined,
            startedAt: earliest(existing.startedAt, first),
            lastEventAt: latest(existing.lastEventAt, last),
            // The bridge's running total for the file so far. Taken as sent, so a parser fix
            // (after a bridge restart re-reads the file) can bring it back down.
            skippedRecordCount: batch.skippedRecords,
          },
          select: { id: true },
        })
      : await tx.agentSession.create({
          data: {
            ...key,
            ...fields,
            projectId,
            startedAt: first,
            lastEventAt: last,
            skippedRecordCount: batch.skippedRecords,
          },
          select: { id: true },
        });

    const inserted = await tx.agentEvent.createMany({
      data: batch.events.map((e) => ({
        sessionId,
        externalId: e.externalId,
        type: e.type,
        role: ROLES[e.type] ?? null,
        occurredAt: new Date(e.occurredAt),
        summary: e.summary,
        payload: e.code ? { code: e.code } : {},
        sourceLine: e.sourceLine,
      })),
      skipDuplicates: true,
    });

    const withUsage = batch.events.filter((e) => e.usage);
    if (withUsage.length > 0) {
      const rows = await tx.agentEvent.findMany({
        where: { sessionId, externalId: { in: withUsage.map((e) => e.externalId) } },
        select: { id: true, externalId: true },
      });
      const eventIds = new Map(rows.map((row) => [row.externalId, row.id]));
      // A resumed or forked session's transcript repeats earlier responses under the same
      // message id. One response is billed once, so its usage stays with the first session
      // that recorded it.
      const elsewhere = await tx.usageRecord.findMany({
        where: {
          sessionId: { not: sessionId },
          event: { externalId: { in: withUsage.map((e) => e.externalId) } },
        },
        select: { event: { select: { externalId: true } } },
      });
      const counted = new Set(elsewhere.map((row) => row.event.externalId));
      await tx.usageRecord.createMany({
        data: withUsage.flatMap((e) => {
          const eventId = eventIds.get(e.externalId);
          return eventId && e.usage && !counted.has(e.externalId)
            ? [{ sessionId, eventId, occurredAt: new Date(e.occurredAt), ...e.usage }]
            : [];
        }),
        skipDuplicates: true,
      });
    }
    return { sessionId, insertedEvents: inserted.count };
  });
}

const sessionSelect = {
  id: true,
  source: true,
  externalId: true,
  title: true,
  details: true,
  cwd: true,
  gitBranch: true,
  sourcePath: true,
  startedAt: true,
  lastEventAt: true,
  skippedRecordCount: true,
  project: { select: { id: true, name: true } },
} as const;

export function listSessions(take: number, source?: AgentSource) {
  return getPrisma().agentSession.findMany({
    where: { source },
    orderBy: [{ lastEventAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take,
    select: sessionSelect,
  });
}

export function getSession(id: string) {
  return getPrisma().agentSession.findUnique({ where: { id }, select: sessionSelect });
}

const tokenSums = {
  inputTokens: true,
  outputTokens: true,
  cacheReadTokens: true,
  cacheWriteTokens: true,
  reasoningTokens: true,
} as const;

function totals(sum: { [K in keyof TokenTotals]: number | null }): TokenTotals {
  return {
    inputTokens: sum.inputTokens ?? 0,
    outputTokens: sum.outputTokens ?? 0,
    cacheReadTokens: sum.cacheReadTokens ?? 0,
    cacheWriteTokens: sum.cacheWriteTokens ?? 0,
    reasoningTokens: sum.reasoningTokens ?? 0,
  };
}

export interface SessionModelUsage extends TokenTotals {
  sessionId: string;
  model: string;
  responses: number;
  lastUsedAt: Date | null;
}

/** Token use per session and model, for the given sessions. */
export async function usageBySessionAndModel(sessionIds: string[]): Promise<SessionModelUsage[]> {
  const rows = await getPrisma().usageRecord.groupBy({
    by: ["sessionId", "model"],
    where: { sessionId: { in: sessionIds } },
    _sum: tokenSums,
    _count: { _all: true },
    _max: { occurredAt: true },
  });
  return rows.map((row) => ({
    sessionId: row.sessionId,
    model: row.model,
    responses: row._count._all,
    lastUsedAt: row._max.occurredAt,
    ...totals(row._sum),
  }));
}

export async function errorCountsBySession(sessionIds: string[]): Promise<Map<string, number>> {
  const rows = await getPrisma().agentEvent.groupBy({
    by: ["sessionId"],
    where: { sessionId: { in: sessionIds }, type: { in: [...ERROR_EVENT_TYPES] } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.sessionId, row._count._all]));
}

const eventSelect = {
  id: true,
  type: true,
  occurredAt: true,
  summary: true,
  payload: true,
  sourceLine: true,
} as const;

export function listSessionEvents(sessionId: string, take: number) {
  return getPrisma().agentEvent.findMany({
    where: { sessionId },
    orderBy: [{ occurredAt: "desc" }, { sourceLine: "desc" }],
    take,
    select: eventSelect,
  });
}

export function listSessionErrors(sessionId: string, take: number) {
  return getPrisma().agentEvent.findMany({
    where: { sessionId, type: { in: [...ERROR_EVENT_TYPES] } },
    orderBy: [{ occurredAt: "desc" }, { sourceLine: "desc" }],
    take,
    select: eventSelect,
  });
}

export async function countEventsByType(sessionId: string): Promise<Map<string, number>> {
  const rows = await getPrisma().agentEvent.groupBy({
    by: ["type"],
    where: { sessionId },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.type, row._count._all]));
}

/** Counts per name of the session's tool calls (or, with Codex, operations that ran). */
export async function toolUseCounts(
  sessionId: string,
  type: "tool.use" | "operation.completed" = "tool.use",
) {
  const rows = await getPrisma().agentEvent.groupBy({
    by: ["summary"],
    where: { sessionId, type },
    _count: { _all: true },
  });
  return rows
    .map((row) => ({ tool: row.summary ?? "Unknown", count: row._count._all }))
    .sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool));
}
