import { z } from "zod";
import {
  AGENT_SOURCE_LABELS,
  AGENT_SOURCES,
  totalTokens,
  type AgentSource,
  type TokenTotals,
} from "./agent";
import { estimateCost, priceOn, type CostEstimate, type PriceVersion } from "./pricing";
import { isCalendarDate } from "./validation";

// Usage analytics (Phase 7, ADR-019). Days are "YYYY-MM-DD" calendar days in the server's time
// zone, which is the user's own machine. Tokens are verified counts from session files; cost is
// only ever an estimate from the user's price table, never a charge.

const DAY_MS = 86_400_000;

/** The calendar day an instant falls on in a time zone. */
export function dayIn(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Days in a range, counting both ends. */
export function rangeLength({ from, to }: DateRange): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
}

export const PERIODS = ["day", "week", "month"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABELS: Record<Period, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};

/** First day of the period holding `day`. Weeks start on Monday (ISO 8601). */
export function periodStart(day: string, period: Period): string {
  if (period === "day") return day;
  if (period === "month") return `${day.slice(0, 7)}-01`;
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 is Sunday
  return addDays(day, -((weekday + 6) % 7));
}

export function nextPeriod(start: string, period: Period): string {
  if (period === "day") return addDays(start, 1);
  if (period === "week") return addDays(start, 7);
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

/** Start of every period that overlaps the range, oldest first. */
export function periodsIn(range: DateRange, period: Period): string[] {
  const starts: string[] = [];
  for (let start = periodStart(range.from, period); start <= range.to;) {
    starts.push(start);
    start = nextPeriod(start, period);
  }
  return starts;
}

// --- Range from the URL ---

export interface DateRange {
  from: string;
  to: string;
}

export const RANGE_PRESETS = [7, 30, 90, 365] as const;
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 3 * 366;

export function lastDays(days: number, today: string): DateRange {
  return { from: addDays(today, -(days - 1)), to: today };
}

// Anything unusable in the URL falls back to a default and says so, rather than erroring.
const queryText = z.string().trim().optional().catch(undefined);
const analyticsQuerySchema = z.object({
  from: queryText,
  to: queryText,
  period: z.enum(PERIODS).catch("day"),
});

export function resolveAnalyticsQuery(
  query: unknown,
  today: string,
): { range: DateRange; period: Period; notice: string | null } {
  const parsed = analyticsQuerySchema.safeParse(query);
  const { from, to, period } = parsed.success ? parsed.data : { period: "day" as const };
  const fallback = lastDays(DEFAULT_RANGE_DAYS, today);
  if (!from && !to) return { range: fallback, period, notice: null };
  if ((from && !isCalendarDate(from)) || (to && !isCalendarDate(to))) {
    return {
      range: fallback,
      period,
      notice: `That date range isn't valid, so the last ${DEFAULT_RANGE_DAYS} days are shown.`,
    };
  }
  const notices: string[] = [];
  let end = to ?? today;
  let start = from ?? addDays(end, -(DEFAULT_RANGE_DAYS - 1));
  if (start > end) {
    [start, end] = [end, start];
    notices.push("The start was after the end, so they were swapped.");
  }
  if (end > today) {
    end = today;
    if (start > end) start = end;
    notices.push("Days after today have no usage yet, so the range ends today.");
  }
  if (rangeLength({ from: start, to: end }) > MAX_RANGE_DAYS) {
    start = addDays(end, -(MAX_RANGE_DAYS - 1));
    notices.push("Ranges are limited to 3 years.");
  }
  return { range: { from: start, to: end }, period, notice: notices.join(" ") || null };
}

// --- Aggregation ---

/** Recorded usage for one (day, session, model): what the database groups usage records into. */
export interface UsageRow extends TokenTotals {
  day: string;
  source: AgentSource;
  sessionId: string;
  sessionExternalId: string;
  sessionTitle: string | null;
  /** The session's records that the bridge couldn't read; its counts may be incomplete. */
  sessionSkippedRecords: number;
  projectId: string | null;
  projectName: string | null;
  model: string;
  records: number;
}

export interface PricedRow extends UsageRow {
  cost: CostEstimate;
}

export function priceRows(rows: readonly UsageRow[], prices: readonly PriceVersion[]): PricedRow[] {
  return rows.map((row) => ({
    ...row,
    cost: estimateCost(row, priceOn(prices, row.model, row.day)),
  }));
}

export interface UsageSummary extends TokenTotals {
  records: number;
  sessions: number;
  /** Sum of the estimates that could be made: a lower bound while `unpricedTokens` > 0. */
  estimatedUsd: number;
  unpricedTokens: number;
  /** Why some tokens have no estimate (distinct reasons). */
  unpricedReasons: string[];
}

export function summarize(rows: readonly PricedRow[]): UsageSummary {
  const summary: UsageSummary = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    records: 0,
    sessions: new Set(rows.map((row) => row.sessionId)).size,
    estimatedUsd: 0,
    unpricedTokens: 0,
    unpricedReasons: [],
  };
  const reasons = new Set<string>();
  for (const row of rows) {
    summary.inputTokens += row.inputTokens;
    summary.outputTokens += row.outputTokens;
    summary.cacheReadTokens += row.cacheReadTokens;
    summary.cacheWriteTokens += row.cacheWriteTokens;
    summary.reasoningTokens += row.reasoningTokens;
    summary.records += row.records;
    if (row.cost.usd === null) {
      summary.unpricedTokens += totalTokens(row);
      reasons.add(row.cost.reason);
    } else {
      summary.estimatedUsd += row.cost.usd;
    }
  }
  summary.unpricedReasons = [...reasons];
  return summary;
}

function groupBy<K>(rows: readonly PricedRow[], key: (row: PricedRow) => K) {
  const groups = new Map<K, PricedRow[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

/** Groups rows and summarises each, largest token total first. */
function breakdown<K, T>(
  rows: readonly PricedRow[],
  key: (row: PricedRow) => K,
  describe: (first: PricedRow, group: PricedRow[]) => T,
) {
  return [...groupBy(rows, key)]
    .map(([k, group]) => ({ key: k, ...describe(group[0]!, group), ...summarize(group) }))
    .sort((a, b) => totalTokens(b) - totalTokens(a));
}

export interface TrendPoint {
  start: string;
  /** The period ends before the first usage ever recorded: no data, not zero. */
  noData: boolean;
  tokens: Record<AgentSource, number>;
  estimatedUsd: Record<AgentSource, number>;
  unpricedTokens: number;
}

const perSource = (value: (source: AgentSource) => number) =>
  Object.fromEntries(AGENT_SOURCES.map((s) => [s, value(s)])) as Record<AgentSource, number>;

/**
 * Everything the Analytics page shows for a range. `firstDay` is the day of the first usage
 * ever recorded (any range), or null if there is none.
 */
export function analyzeUsage(
  rows: readonly PricedRow[],
  range: DateRange,
  period: Period,
  firstDay: string | null,
) {
  const byPeriod = groupBy(rows, (row) => periodStart(row.day, period));
  const trend: TrendPoint[] = periodsIn(range, period).map((start) => {
    const group = byPeriod.get(start) ?? [];
    const sources = Object.fromEntries(
      AGENT_SOURCES.map((s) => [s, summarize(group.filter((r) => r.source === s))]),
    ) as Record<AgentSource, UsageSummary>;
    return {
      start,
      noData: firstDay === null || nextPeriod(start, period) <= firstDay,
      tokens: perSource((s) => totalTokens(sources[s])),
      estimatedUsd: perSource((s) => sources[s].estimatedUsd),
      unpricedTokens: AGENT_SOURCES.reduce((sum, s) => sum + sources[s].unpricedTokens, 0),
    };
  });

  return {
    totals: summarize(rows),
    trend,
    byProvider: AGENT_SOURCES.map((source) => ({
      source,
      label: AGENT_SOURCE_LABELS[source],
      ...summarize(rows.filter((row) => row.source === source)),
    })),
    byModel: breakdown(
      rows,
      (row) => row.model,
      (first) => ({ model: first.model }),
    ),
    byProject: breakdown(
      rows,
      (row) => row.projectId,
      (first) => ({ projectId: first.projectId, name: first.projectName ?? "Unassigned" }),
    ),
    bySession: breakdown(
      rows,
      (row) => row.sessionId,
      (first, group) => ({
        sessionId: first.sessionId,
        label: first.sessionTitle ?? first.sessionExternalId,
        source: first.source,
        projectId: first.projectId,
        projectName: first.projectName,
        models: [...new Set(group.map((row) => row.model))],
      }),
    ),
    sessionsWithSkippedRecords: new Set(
      rows.filter((row) => row.sessionSkippedRecords > 0).map((row) => row.sessionId),
    ).size,
  };
}

export type UsageAnalysis = ReturnType<typeof analyzeUsage>;

// --- Billing type and budgets (application setting "analytics.settings") ---

/** How the user pays for a tool. ADCC can't read it, so the user says (ADR-019). */
export const BILLING_TYPES = ["UNSET", "API", "SUBSCRIPTION"] as const;
export type BillingType = (typeof BILLING_TYPES)[number];
export const BILLING_LABELS: Record<BillingType, string> = {
  UNSET: "Not set",
  API: "API key, billed per token",
  SUBSCRIPTION: "Subscription, no per-token charge",
};
export const BILLING_MEANING: Record<BillingType, string> = {
  UNSET:
    "Billing type not set. Estimates are what this usage would cost at your API prices; whether you pay that is unknown.",
  API: "Billed per token. Estimates approximate the API charge but aren't your bill: check the provider's console for that.",
  SUBSCRIPTION:
    "Covered by a subscription, with no per-token charge. Estimates are only what the same usage would cost at API prices.",
};

export const ANALYTICS_SETTINGS_KEY = "analytics.settings";

export const analyticsSettingsSchema = z.object({
  billing: z.record(z.enum(AGENT_SOURCES), z.enum(BILLING_TYPES)),
  budget: z.object({
    monthlyTokens: z.number().int().positive().nullable(),
    monthlyCostUsd: z.number().positive().nullable(),
    warnPercent: z.number().int().min(1).max(100),
  }),
});
export type AnalyticsSettings = z.infer<typeof analyticsSettingsSchema>;

export const DEFAULT_ANALYTICS_SETTINGS: AnalyticsSettings = {
  billing: { CLAUDE_CODE: "UNSET", CODEX: "UNSET" },
  budget: { monthlyTokens: null, monthlyCostUsd: null, warnPercent: 80 },
};

/** A blank budget field means no budget. */
function optionalAmount(max: number, integer: boolean) {
  const amount = z
    .number({ error: "Enter a number, or leave blank for no budget" })
    .positive("Must be more than 0")
    .max(max);
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? Number(value.replaceAll(",", "")) : null))
    .pipe((integer ? amount.int("Enter a whole number") : amount).nullable());
}

export const analyticsSettingsFormSchema = z
  .object({
    billing_CLAUDE_CODE: z.enum(BILLING_TYPES),
    billing_CODEX: z.enum(BILLING_TYPES),
    monthlyTokens: optionalAmount(1e15, true),
    monthlyCostUsd: optionalAmount(1e9, false),
    warnPercent: z.coerce
      .number({ error: "Enter a percentage" })
      .int("Enter a whole number")
      .min(1, "At least 1%")
      .max(100, "At most 100%"),
  })
  .transform((form): AnalyticsSettings => ({
    billing: { CLAUDE_CODE: form.billing_CLAUDE_CODE, CODEX: form.billing_CODEX },
    budget: {
      monthlyTokens: form.monthlyTokens,
      monthlyCostUsd: form.monthlyCostUsd,
      warnPercent: form.warnPercent,
    },
  }));

export interface BudgetMeter {
  used: number;
  limit: number;
  percent: number;
  level: "ok" | "warning" | "over";
  /** Some usage has no estimate, so the real figure is at least `used`. */
  lowerBound: boolean;
}

function meter(used: number, limit: number, warnPercent: number, lowerBound: boolean) {
  const percent = (used / limit) * 100;
  const level: BudgetMeter["level"] =
    percent >= 100 ? "over" : percent >= warnPercent ? "warning" : "ok";
  return { used, limit, percent, level, lowerBound };
}

/** Month-to-date usage against the budgets that are set (null where none is). */
export function budgetStatus(month: UsageSummary, budget: AnalyticsSettings["budget"]) {
  return {
    tokens:
      budget.monthlyTokens === null
        ? null
        : meter(totalTokens(month), budget.monthlyTokens, budget.warnPercent, false),
    cost:
      budget.monthlyCostUsd === null
        ? null
        : meter(
            month.estimatedUsd,
            budget.monthlyCostUsd,
            budget.warnPercent,
            month.unpricedTokens > 0,
          ),
  };
}

// --- CSV export ---

const CSV_HEADER = [
  "date",
  "provider",
  "project",
  "session_id",
  "session_title",
  "model",
  "usage_records",
  "input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "total_tokens",
  "price_effective_from",
  "estimated_api_equivalent_cost_usd",
  "cost_note",
];

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  // Spreadsheets run a cell starting with one of these as a formula; titles are outside text.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** One line per day, session and model. Cost is labelled an estimate; billed cost isn't known. */
export function usageCsv(rows: readonly PricedRow[]): string {
  const sorted = [...rows].sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.source.localeCompare(b.source) ||
      a.sessionExternalId.localeCompare(b.sessionExternalId) ||
      a.model.localeCompare(b.model),
  );
  const lines = sorted.map((row) =>
    [
      row.day,
      AGENT_SOURCE_LABELS[row.source],
      row.projectName,
      row.sessionExternalId,
      row.sessionTitle,
      row.model,
      row.records,
      row.inputTokens,
      row.outputTokens,
      row.reasoningTokens,
      row.cacheReadTokens,
      row.cacheWriteTokens,
      totalTokens(row),
      row.cost.price?.effectiveFrom ?? null,
      row.cost.usd === null ? null : row.cost.usd.toFixed(6),
      row.cost.usd === null ? row.cost.reason : "Estimate from your price table, not a charge",
    ]
      .map(csvCell)
      .join(","),
  );
  // The BOM makes Excel read the file as UTF-8.
  return `﻿${[CSV_HEADER.join(","), ...lines].join("\r\n")}\r\n`;
}
