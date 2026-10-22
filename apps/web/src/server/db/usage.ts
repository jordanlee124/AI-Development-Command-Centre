import type { AgentSource, TokenTotals } from "@/domain/agent";
import type { UsageRow } from "@/domain/analytics";
import { getPrisma } from "./client";

export interface ModelUsage extends TokenTotals {
  model: string;
  records: number;
}

export async function usageByModelSince(since: Date): Promise<ModelUsage[]> {
  const rows = await getPrisma().usageRecord.groupBy({
    by: ["model"],
    where: { occurredAt: { gte: since } },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheWriteTokens: true,
      reasoningTokens: true,
    },
    _count: { _all: true },
  });
  return rows.map((row) => ({
    model: row.model,
    records: row._count._all,
    inputTokens: row._sum.inputTokens ?? 0,
    outputTokens: row._sum.outputTokens ?? 0,
    cacheReadTokens: row._sum.cacheReadTokens ?? 0,
    cacheWriteTokens: row._sum.cacheWriteTokens ?? 0,
    reasoningTokens: row._sum.reasoningTokens ?? 0,
  }));
}

interface UsageRowRaw {
  day: string;
  source: AgentSource;
  sessionId: string;
  sessionExternalId: string;
  sessionTitle: string | null;
  sessionSkippedRecords: number;
  projectId: string | null;
  projectName: string | null;
  model: string;
  records: number;
  inputTokens: bigint;
  outputTokens: bigint;
  cacheReadTokens: bigint;
  cacheWriteTokens: bigint;
  reasoningTokens: bigint;
}

/**
 * Usage grouped by calendar day (in `timeZone`), session and model, for days from..to
 * inclusive. Sums come back as bigint; they are far below 2^53, so Number() is exact.
 */
export async function usageRowsBetween(
  from: string,
  to: string,
  timeZone: string,
): Promise<UsageRow[]> {
  // shortcut: the day filter can't use the occurredAt index; fine for tens of thousands of
  // records. Add an occurredAt bound (from − 1 day … to + 2 days) if this gets slow.
  const rows = await getPrisma().$queryRaw<UsageRowRaw[]>`
    SELECT to_char(u."occurredAt" AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
           s.source::text AS source,
           s.id::text AS "sessionId",
           s."externalId" AS "sessionExternalId",
           s.title AS "sessionTitle",
           s."skippedRecordCount" AS "sessionSkippedRecords",
           p.id::text AS "projectId",
           p.name AS "projectName",
           u.model,
           count(*)::int AS records,
           sum(u."inputTokens")::bigint AS "inputTokens",
           sum(u."outputTokens")::bigint AS "outputTokens",
           sum(u."cacheReadTokens")::bigint AS "cacheReadTokens",
           sum(u."cacheWriteTokens")::bigint AS "cacheWriteTokens",
           sum(u."reasoningTokens")::bigint AS "reasoningTokens"
    FROM usage_records u
    JOIN agent_sessions s ON s.id = u."sessionId"
    LEFT JOIN projects p ON p.id = s."projectId"
    WHERE (u."occurredAt" AT TIME ZONE ${timeZone})::date BETWEEN ${from}::date AND ${to}::date
    GROUP BY 1, s.id, p.id, u.model`;
  return rows.map((row) => ({
    ...row,
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    cacheReadTokens: Number(row.cacheReadTokens),
    cacheWriteTokens: Number(row.cacheWriteTokens),
    reasoningTokens: Number(row.reasoningTokens),
  }));
}

/** When the first usage was recorded, or null if none has been. */
export async function firstUsageAt(): Promise<Date | null> {
  const { _min } = await getPrisma().usageRecord.aggregate({ _min: { occurredAt: true } });
  return _min.occurredAt;
}

/** Every model with recorded usage, all time, with its token total. */
export async function usageModels(): Promise<ModelUsage[]> {
  return usageByModelSince(new Date(0));
}
