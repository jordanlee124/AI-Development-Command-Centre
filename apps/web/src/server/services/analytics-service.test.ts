import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ANALYTICS_SETTINGS, type UsageRow } from "@/domain/analytics";
import type { PriceVersion } from "@/domain/pricing";
import {
  deletePriceRow,
  findPriceVersion,
  getPrice,
  insertPrice,
  listPrices,
  updatePrice,
} from "@/server/db/pricing";
import { getSetting, setSetting } from "@/server/db/settings";
import { firstUsageAt, usageModels, usageRowsBetween } from "@/server/db/usage";
import {
  deletePrice,
  exportUsageCsv,
  getAnalytics,
  getAnalyticsSettings,
  getAnalyticsSettingsPage,
  saveAnalyticsSettings,
  savePrice,
} from "./analytics-service";

vi.mock("@/server/db/pricing", () => ({
  deletePriceRow: vi.fn(),
  findPriceVersion: vi.fn(),
  getPrice: vi.fn(),
  insertPrice: vi.fn(),
  listPrices: vi.fn(),
  updatePrice: vi.fn(),
}));
vi.mock("@/server/db/settings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
vi.mock("@/server/db/usage", () => ({
  firstUsageAt: vi.fn(),
  usageModels: vi.fn(),
  usageRowsBetween: vi.fn(),
}));

// Fixture ids and values; the prices are invented, not real provider rates.
const PRICE = "0199f3a0-0000-7000-8000-0000000000e1";
const OTHER = "0199f3a0-0000-7000-8000-0000000000e2";
const now = new Date("2026-10-22T03:00:00Z"); // 12:00 in Seoul

const version: PriceVersion = {
  id: PRICE,
  model: "model-a",
  effectiveFrom: "2026-01-01",
  inputPerMTok: 2,
  outputPerMTok: 10,
  cacheReadPerMTok: null,
  cacheWritePerMTok: null,
  reasoningPerMTok: null,
  source: "fixture",
  notes: null,
};

const usage = (overrides: Partial<UsageRow> = {}): UsageRow => ({
  day: "2026-10-21",
  source: "CLAUDE_CODE",
  sessionId: "s1",
  sessionExternalId: "ext-1",
  sessionTitle: null,
  sessionSkippedRecords: 0,
  projectId: null,
  projectName: null,
  model: "model-a",
  records: 1,
  inputTokens: 1_000_000,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  ...overrides,
});

const priceForm = {
  model: "model-a",
  effectiveFrom: "2026-06-01",
  inputPerMTok: "3",
  outputPerMTok: "15",
  source: "fixture",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listPrices).mockResolvedValue([version]);
  vi.mocked(getSetting).mockResolvedValue(null);
  vi.mocked(usageRowsBetween).mockResolvedValue([]);
  vi.mocked(firstUsageAt).mockResolvedValue(null);
  vi.mocked(findPriceVersion).mockResolvedValue(null);
});

describe("getAnalytics", () => {
  it("reads the range and this month as calendar days in the server's zone", async () => {
    vi.mocked(firstUsageAt).mockResolvedValue(new Date("2026-10-01T16:00:00Z"));
    const result = await getAnalytics({ from: "2026-10-05" }, now, "Asia/Seoul");
    expect(usageRowsBetween).toHaveBeenCalledWith("2026-10-05", "2026-10-22", "Asia/Seoul");
    // Month to date, for the budget.
    expect(usageRowsBetween).toHaveBeenCalledWith("2026-10-01", "2026-10-22", "Asia/Seoul");
    expect(result).toMatchObject({ today: "2026-10-22", firstDay: "2026-10-02" });
  });

  it("estimates this month's cost against the cost budget", async () => {
    vi.mocked(getSetting).mockResolvedValue({
      ...DEFAULT_ANALYTICS_SETTINGS,
      budget: { monthlyTokens: null, monthlyCostUsd: 4, warnPercent: 80 },
    });
    vi.mocked(usageRowsBetween).mockResolvedValue([usage()]);
    const { budget, usage: analysis } = await getAnalytics({}, now, "UTC");
    expect(budget.cost).toMatchObject({ used: 2, percent: 50, level: "ok", lowerBound: false });
    expect(analysis.totals.estimatedUsd).toBe(2);
  });

  it("fails loudly on a stored setting that doesn't validate", async () => {
    vi.mocked(getSetting).mockResolvedValue({ budget: "lots" });
    await expect(getAnalyticsSettings()).rejects.toThrow();
  });
});

describe("exportUsageCsv", () => {
  it("names the file after the resolved range", async () => {
    vi.mocked(usageRowsBetween).mockResolvedValue([usage()]);
    const { csv, filename } = await exportUsageCsv(
      { from: "2026-10-10", to: "2026-10-01" },
      now,
      "UTC",
    );
    expect(filename).toBe("adcc-usage-2026-10-01-to-2026-10-10.csv");
    expect(csv).toContain(",2.000000,");
  });
});

describe("getAnalyticsSettingsPage", () => {
  it("lists recorded models that have no price at all, largest first", async () => {
    const totals = { outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
    vi.mocked(usageModels).mockResolvedValue([
      { model: "model-a", records: 1, inputTokens: 5, ...totals },
      { model: "model-b", records: 1, inputTokens: 10, ...totals },
      { model: "model-c", records: 1, inputTokens: 20, ...totals },
    ]);
    const page = await getAnalyticsSettingsPage();
    expect(page.unpricedModels).toEqual([
      { model: "model-c", tokens: 20 },
      { model: "model-b", tokens: 10 },
    ]);
  });
});

describe("saveAnalyticsSettings", () => {
  it("stores validated settings", async () => {
    await saveAnalyticsSettings({
      billing_CLAUDE_CODE: "API",
      billing_CODEX: "SUBSCRIPTION",
      monthlyTokens: "",
      monthlyCostUsd: "25.50",
      warnPercent: "90",
    });
    expect(setSetting).toHaveBeenCalledWith("analytics.settings", {
      billing: { CLAUDE_CODE: "API", CODEX: "SUBSCRIPTION" },
      budget: { monthlyTokens: null, monthlyCostUsd: 25.5, warnPercent: 90 },
    });
  });
});

describe("savePrice", () => {
  it("adds a version and logs it", async () => {
    await savePrice(priceForm);
    expect(insertPrice).toHaveBeenCalledWith(
      expect.objectContaining({ model: "model-a", inputPerMTok: "3", cacheReadPerMTok: null }),
      { type: "pricing.created", title: "Added price for model-a from 2026-06-01" },
    );
  });

  it("refuses a second version starting the same day", async () => {
    vi.mocked(findPriceVersion).mockResolvedValue({ id: OTHER });
    await expect(savePrice(priceForm)).rejects.toMatchObject({
      code: "CONFLICT",
      field: "effectiveFrom",
    });
    await expect(savePrice({ ...priceForm, id: PRICE })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(insertPrice).not.toHaveBeenCalled();
    expect(updatePrice).not.toHaveBeenCalled();
  });

  it("edits a version in place, even keeping its own day", async () => {
    vi.mocked(findPriceVersion).mockResolvedValue({ id: PRICE });
    vi.mocked(getPrice).mockResolvedValue(version);
    await savePrice({ ...priceForm, id: PRICE });
    expect(updatePrice).toHaveBeenCalledWith(
      PRICE,
      expect.objectContaining({ outputPerMTok: "15" }),
      {
        type: "pricing.updated",
        title: "Edited price for model-a from 2026-06-01",
      },
    );
  });

  it("says so when the edited version is gone", async () => {
    vi.mocked(getPrice).mockResolvedValue(null);
    await expect(savePrice({ ...priceForm, id: PRICE })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("deletePrice", () => {
  it("deletes one version by id and logs it", async () => {
    vi.mocked(getPrice).mockResolvedValue(version);
    await deletePrice(PRICE);
    expect(deletePriceRow).toHaveBeenCalledWith(PRICE, {
      type: "pricing.deleted",
      title: "Deleted price for model-a from 2026-01-01",
    });
  });

  it("refuses an id that isn't a uuid", async () => {
    await expect(deletePrice("1 OR 1=1")).rejects.toThrow();
    expect(deletePriceRow).not.toHaveBeenCalled();
  });
});
