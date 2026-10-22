import type { TokenTotals } from "@/domain/agent";
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
