import { describe, expect, it } from "vitest";
import { totalTokens } from "./agent";
import {
  addDays,
  analyticsSettingsFormSchema,
  analyzeUsage,
  budgetStatus,
  dayIn,
  periodsIn,
  periodStart,
  priceRows,
  rangeLength,
  resolveAnalyticsQuery,
  summarize,
  usageCsv,
  type UsageRow,
} from "./analytics";
import type { PriceVersion } from "./pricing";

// Fixture rows and prices: invented numbers for the maths, not real usage or provider rates.
const row = (overrides: Partial<UsageRow> = {}): UsageRow => ({
  day: "2026-10-20",
  source: "CLAUDE_CODE",
  sessionId: "s1",
  sessionExternalId: "ext-1",
  sessionTitle: "Session one",
  sessionSkippedRecords: 0,
  projectId: "p1",
  projectName: "Project one",
  model: "model-a",
  records: 1,
  inputTokens: 1_000_000,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  ...overrides,
});

const price = (overrides: Partial<PriceVersion> = {}): PriceVersion => ({
  id: "v1",
  model: "model-a",
  effectiveFrom: "2026-01-01",
  inputPerMTok: 2,
  outputPerMTok: 10,
  cacheReadPerMTok: 0.5,
  cacheWritePerMTok: 2.5,
  reasoningPerMTok: 10,
  source: "fixture",
  notes: null,
  ...overrides,
});

describe("calendar days", () => {
  it("reads the day in the given time zone, not UTC", () => {
    const instant = new Date("2026-10-21T20:30:00Z");
    expect(dayIn(instant, "UTC")).toBe("2026-10-21");
    expect(dayIn(instant, "Asia/Seoul")).toBe("2026-10-22"); // UTC+9
    expect(dayIn(instant, "America/Los_Angeles")).toBe("2026-10-21");
  });

  it("adds days across month, year and leap-day boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts both ends of a range", () => {
    expect(rangeLength({ from: "2026-10-01", to: "2026-10-01" })).toBe(1);
    expect(rangeLength({ from: "2026-10-01", to: "2026-10-30" })).toBe(30);
  });
});

describe("periods", () => {
  it("starts weeks on Monday", () => {
    expect(periodStart("2026-10-19", "week")).toBe("2026-10-19"); // Monday
    expect(periodStart("2026-10-25", "week")).toBe("2026-10-19"); // Sunday
    expect(periodStart("2027-01-01", "week")).toBe("2026-12-28"); // week spans the new year
  });

  it("starts months on the 1st", () => {
    expect(periodStart("2026-10-31", "month")).toBe("2026-10-01");
  });

  it("lists every period that overlaps the range, including partial ones", () => {
    expect(periodsIn({ from: "2026-10-30", to: "2026-11-02" }, "day")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(periodsIn({ from: "2026-10-21", to: "2026-11-03" }, "week")).toEqual([
      "2026-10-19",
      "2026-10-26",
      "2026-11-02",
    ]);
    expect(periodsIn({ from: "2026-11-15", to: "2027-01-10" }, "month")).toEqual([
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ]);
  });
});

describe("resolveAnalyticsQuery", () => {
  const today = "2026-10-22";

  it("defaults to the last 30 days, daily", () => {
    expect(resolveAnalyticsQuery({}, today)).toEqual({
      range: { from: "2026-09-23", to: today },
      period: "day",
      notice: null,
    });
  });

  it("keeps a valid range and period", () => {
    expect(
      resolveAnalyticsQuery({ from: "2026-01-01", to: "2026-03-31", period: "month" }, today),
    ).toEqual({ range: { from: "2026-01-01", to: "2026-03-31" }, period: "month", notice: null });
  });

  it("fills a missing end with today and a missing start with 30 days before the end", () => {
    expect(resolveAnalyticsQuery({ from: "2026-10-01" }, today).range).toEqual({
      from: "2026-10-01",
      to: today,
    });
    expect(resolveAnalyticsQuery({ to: "2026-06-30" }, today).range).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    });
  });

  it("falls back to the default and says so for invalid dates", () => {
    for (const query of [{ from: "2026-02-30" }, { to: "yesterday" }]) {
      const result = resolveAnalyticsQuery(query, today);
      expect(result.range).toEqual({ from: "2026-09-23", to: today });
      expect(result.notice).toMatch(/isn't valid/);
    }
  });

  it("ignores repeated params", () => {
    expect(resolveAnalyticsQuery({ from: ["2026-10-01", "2026-10-02"] }, today).range).toEqual({
      from: "2026-09-23",
      to: today,
    });
  });

  it("swaps a reversed range", () => {
    const result = resolveAnalyticsQuery({ from: "2026-10-10", to: "2026-10-01" }, today);
    expect(result.range).toEqual({ from: "2026-10-01", to: "2026-10-10" });
    expect(result.notice).toMatch(/swapped/);
  });

  it("ends at today, since later days can have no usage", () => {
    expect(resolveAnalyticsQuery({ from: "2026-10-01", to: "2026-12-31" }, today).range.to).toBe(
      today,
    );
    expect(resolveAnalyticsQuery({ from: "2027-01-01", to: "2027-02-01" }, today).range).toEqual({
      from: today,
      to: today,
    });
  });

  it("caps the range at three years", () => {
    const { range, notice } = resolveAnalyticsQuery({ from: "2000-01-01" }, today);
    expect(rangeLength(range)).toBe(3 * 366);
    expect(range.to).toBe(today);
    expect(notice).toMatch(/3 years/);
  });

  it("ignores an unknown period", () => {
    expect(resolveAnalyticsQuery({ period: "hour" }, today).period).toBe("day");
  });
});

describe("summarize", () => {
  it("adds tokens and records and counts distinct sessions", () => {
    const summary = summarize(
      priceRows(
        [row(), row({ day: "2026-10-21", outputTokens: 5 }), row({ sessionId: "s2" })],
        [price()],
      ),
    );
    expect(summary).toMatchObject({
      inputTokens: 3_000_000,
      outputTokens: 5,
      records: 3,
      sessions: 2,
    });
  });

  it("keeps unpriced tokens out of the estimate and reports why", () => {
    const summary = summarize(
      priceRows(
        [
          row(),
          row({ model: "model-x", inputTokens: 400 }),
          row({ model: "model-y", inputTokens: 600 }),
        ],
        [price()],
      ),
    );
    expect(summary.estimatedUsd).toBe(2);
    expect(summary.unpricedTokens).toBe(1000);
    expect(summary.unpricedReasons).toEqual(["No price for this model on this date"]);
  });

  it("is an honest zero for no rows", () => {
    expect(summarize([])).toMatchObject({
      records: 0,
      sessions: 0,
      estimatedUsd: 0,
      unpricedTokens: 0,
    });
  });
});

describe("analyzeUsage", () => {
  const range = { from: "2026-10-19", to: "2026-10-25" };
  const prices = [
    price({ id: "old", effectiveFrom: "2026-01-01", inputPerMTok: 2 }),
    price({ id: "new", effectiveFrom: "2026-10-22", inputPerMTok: 1 }),
  ];
  const rows = [
    row({ day: "2026-10-20" }),
    row({ day: "2026-10-22" }),
    row({
      day: "2026-10-22",
      source: "CODEX",
      sessionId: "s2",
      projectId: null,
      projectName: null,
      model: "model-x",
      inputTokens: 300,
    }),
    row({ day: "2026-10-23", sessionId: "s3", sessionSkippedRecords: 4, outputTokens: 100_000 }),
  ];
  const analysis = analyzeUsage(priceRows(rows, prices), range, "day", "2026-10-20");

  it("uses the price in force on each day, across a price change", () => {
    // 2026-10-20 at $2, 2026-10-22 and -23 at $1 (+ $1 output on the 23rd).
    expect(analysis.totals.estimatedUsd).toBeCloseTo(2 + 1 + 1 + 1, 10);
  });

  it("splits totals by tool, model, project and session without losing tokens", () => {
    const total = totalTokens(analysis.totals);
    for (const groups of [
      analysis.byProvider,
      analysis.byModel,
      analysis.byProject,
      analysis.bySession,
    ]) {
      expect(groups.reduce((sum, g) => sum + totalTokens(g), 0)).toBe(total);
      expect(groups.reduce((sum, g) => sum + g.records, 0)).toBe(analysis.totals.records);
    }
  });

  it("shows every tool, even one with no usage, and orders breakdowns by tokens", () => {
    expect(analysis.byProvider.map((p) => [p.source, p.sessions])).toEqual([
      ["CLAUDE_CODE", 2],
      ["CODEX", 1],
    ]);
    expect(analysis.byModel.map((m) => m.model)).toEqual(["model-a", "model-x"]);
    expect(analyzeUsage([], range, "day", "2026-10-20").byProvider.map((p) => p.records)).toEqual([
      0, 0,
    ]);
  });

  it("labels sessions without a project as unassigned", () => {
    const unassigned = analysis.byProject.find((p) => p.projectId === null);
    expect(unassigned).toMatchObject({ name: "Unassigned", sessions: 1, inputTokens: 300 });
  });

  it("flags unpriced usage and sessions with unread records", () => {
    const modelX = analysis.byModel.find((m) => m.model === "model-x");
    expect(modelX).toMatchObject({ unpricedTokens: 300, estimatedUsd: 0 });
    expect(analysis.totals.unpricedTokens).toBe(300);
    expect(analysis.sessionsWithSkippedRecords).toBe(1);
  });

  it("fills a trend point for every day, with zero after the first record and no data before it", () => {
    expect(analysis.trend.map((p) => p.start)).toEqual(periodsIn(range, "day"));
    const byDay = Object.fromEntries(analysis.trend.map((p) => [p.start, p]));
    expect(byDay["2026-10-19"]).toMatchObject({ noData: true });
    expect(byDay["2026-10-21"]).toMatchObject({
      noData: false,
      tokens: { CLAUDE_CODE: 0, CODEX: 0 },
    });
    expect(byDay["2026-10-22"]).toMatchObject({
      tokens: { CLAUDE_CODE: 1_000_000, CODEX: 300 },
      estimatedUsd: { CLAUDE_CODE: 1, CODEX: 0 },
      unpricedTokens: 300,
    });
  });

  it("groups weeks and months, and a period holding the first record has data", () => {
    const weekly = analyzeUsage(priceRows(rows, prices), range, "week", "2026-10-20");
    expect(weekly.trend).toHaveLength(1);
    expect(weekly.trend[0]).toMatchObject({ start: "2026-10-19", noData: false });
    expect(totalTokens({ ...weekly.totals })).toBe(totalTokens(analysis.totals));
    const monthly = analyzeUsage(
      [],
      { from: "2026-08-15", to: "2026-10-25" },
      "month",
      "2026-09-30",
    );
    expect(monthly.trend.map((p) => [p.start, p.noData])).toEqual([
      ["2026-08-01", true],
      ["2026-09-01", false],
      ["2026-10-01", false],
    ]);
  });

  it("has no data anywhere when nothing was ever recorded", () => {
    expect(analyzeUsage([], range, "day", null).trend.every((p) => p.noData)).toBe(true);
  });
});

describe("budgetStatus", () => {
  const month = summarize(priceRows([row({ inputTokens: 800_000 })], [price()])); // $1.60
  const budget = { monthlyTokens: null, monthlyCostUsd: null, warnPercent: 80 };

  it("has no meters without budgets", () => {
    expect(budgetStatus(month, budget)).toEqual({ tokens: null, cost: null });
  });

  it("warns at the threshold and is over at 100%", () => {
    const at = (monthlyTokens: number) =>
      budgetStatus(month, { ...budget, monthlyTokens }).tokens?.level;
    expect(at(1_100_000)).toBe("ok"); // 72.7%
    expect(at(1_000_000)).toBe("warning"); // exactly 80%
    expect(at(800_000)).toBe("over"); // 100%
    expect(at(400_000)).toBe("over");
  });

  it("marks a cost meter as a lower bound when some usage has no price", () => {
    const partial = summarize(
      priceRows([row({ inputTokens: 800_000 }), row({ model: "model-x" })], [price()]),
    );
    expect(budgetStatus(partial, { ...budget, monthlyCostUsd: 2 }).cost).toEqual({
      used: 1.6,
      limit: 2,
      percent: 80,
      level: "warning",
      lowerBound: true,
    });
    expect(budgetStatus(month, { ...budget, monthlyCostUsd: 2 }).cost?.lowerBound).toBe(false);
  });
});

describe("analyticsSettingsFormSchema", () => {
  const form = {
    billing_CLAUDE_CODE: "SUBSCRIPTION",
    billing_CODEX: "UNSET",
    monthlyTokens: "50,000,000",
    monthlyCostUsd: "",
    warnPercent: "75",
  };

  it("reads blanks as no budget", () => {
    expect(analyticsSettingsFormSchema.parse(form)).toEqual({
      billing: { CLAUDE_CODE: "SUBSCRIPTION", CODEX: "UNSET" },
      budget: { monthlyTokens: 50_000_000, monthlyCostUsd: null, warnPercent: 75 },
    });
  });

  it.each([
    ["a fractional token budget", { monthlyTokens: "1.5" }],
    ["a zero budget", { monthlyCostUsd: "0" }],
    ["text", { monthlyCostUsd: "lots" }],
    ["a warning over 100%", { warnPercent: "120" }],
    ["an unknown billing type", { billing_CODEX: "FREE" }],
  ])("refuses %s", (_, change) => {
    expect(analyticsSettingsFormSchema.safeParse({ ...form, ...change }).success).toBe(false);
  });
});

describe("usageCsv", () => {
  const lines = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n");

  it("writes a header, one line per row, and labels cost as an estimate", () => {
    const csv = usageCsv(priceRows([row(), row({ model: "model-x" })], [price()]));
    const [header, priced, unpriced] = lines(csv);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(header).toContain("estimated_api_equivalent_cost_usd");
    expect(priced).toBe(
      '2026-10-20,Claude Code,Project one,ext-1,Session one,model-a,1,1000000,0,0,0,0,1000000,2026-01-01,2.000000,"Estimate from your price table, not a charge"',
    );
    // Unpriced: blank price and cost, never 0, with the reason.
    expect(unpriced).toMatch(/,1000000,,,No price for this model on this date$/);
  });

  it("quotes commas, quotes and newlines", () => {
    const [, line] = lines(usageCsv(priceRows([row({ sessionTitle: 'Fix "a", b\nc' })], [])));
    expect(line).toContain('"Fix ""a"", b\nc"');
  });

  it("stops spreadsheet formulas in text cells", () => {
    for (const title of ["=HYPERLINK(1)", "+1", "-1", "@SUM(A1)"]) {
      const [, line] = lines(usageCsv(priceRows([row({ sessionTitle: title })], [])));
      expect(line).toContain(`,'${title},`);
    }
  });

  it("is just a header with no rows", () => {
    expect(lines(usageCsv([]))).toHaveLength(1);
  });
});
