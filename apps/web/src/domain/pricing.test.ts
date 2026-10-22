import { describe, expect, it } from "vitest";
import { estimateCost, priceFormSchema, priceOn, type PriceVersion } from "./pricing";

// Fixture prices: made-up round numbers, not real provider rates.
const price = (overrides: Partial<PriceVersion> = {}): PriceVersion => ({
  id: "0199f3a0-0000-7000-8000-0000000000e1",
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

const tokens = (overrides = {}) => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  ...overrides,
});

describe("priceOn", () => {
  const jan = price({ id: "jan", effectiveFrom: "2026-01-01" });
  const jun = price({ id: "jun", effectiveFrom: "2026-06-01", inputPerMTok: 1 });
  const other = price({ id: "other", model: "model-b", effectiveFrom: "2025-01-01" });
  const prices = [jun, other, jan]; // order doesn't matter

  it("uses the latest version that started on or before the day", () => {
    expect(priceOn(prices, "model-a", "2026-05-31")?.id).toBe("jan");
    expect(priceOn(prices, "model-a", "2026-06-01")?.id).toBe("jun");
    expect(priceOn(prices, "model-a", "2027-01-01")?.id).toBe("jun");
  });

  it("has no price before the first version or for another model", () => {
    expect(priceOn(prices, "model-a", "2025-12-31")).toBeNull();
    expect(priceOn(prices, "model-c", "2026-06-01")).toBeNull();
  });

  it("matches model ids exactly", () => {
    expect(priceOn(prices, "Model-A", "2026-06-01")).toBeNull();
    expect(priceOn(prices, "model-a-20260101", "2026-06-01")).toBeNull();
  });
});

describe("estimateCost", () => {
  it("multiplies each kind of token by its rate per million", () => {
    const cost = estimateCost(
      tokens({
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheReadTokens: 2_000_000,
        cacheWriteTokens: 100_000,
        reasoningTokens: 200_000,
      }),
      price(),
    );
    // 2 + 5 + 1 + 0.25 + 2
    expect(cost.usd).toBeCloseTo(10.25, 10);
  });

  it("is unknown with no price, never 0", () => {
    expect(estimateCost(tokens({ inputTokens: 5 }), null)).toEqual({
      usd: null,
      reason: "No price for this model on this date",
      price: null,
    });
  });

  it("is unknown when a kind of token was used whose rate isn't known", () => {
    const cost = estimateCost(
      tokens({ inputTokens: 10, reasoningTokens: 1 }),
      price({ reasoningPerMTok: null }),
    );
    expect(cost).toMatchObject({ usd: null, reason: "No reasoning rate in the price" });
  });

  it("doesn't need a rate for a kind of token that wasn't used", () => {
    const cost = estimateCost(
      tokens({ inputTokens: 1_000_000 }),
      price({ cacheReadPerMTok: null, cacheWritePerMTok: null, reasoningPerMTok: null }),
    );
    expect(cost.usd).toBe(2);
  });

  it("keeps exact large counts", () => {
    const cost = estimateCost(tokens({ cacheReadTokens: 3_000_000_000 }), price());
    expect(cost.usd).toBe(1500);
  });
});

describe("priceFormSchema", () => {
  const form = {
    model: " model-a ",
    effectiveFrom: "2026-06-01",
    inputPerMTok: "3",
    outputPerMTok: "15.000001",
    cacheReadPerMTok: "",
    cacheWritePerMTok: "0.3",
    reasoningPerMTok: "",
    source: "https://example.test/pricing, read 2026-10-22",
    notes: "",
  };

  it("keeps rates as typed and turns blanks into unknown", () => {
    expect(priceFormSchema.parse(form)).toEqual({
      id: null,
      model: "model-a",
      effectiveFrom: new Date("2026-06-01T00:00:00Z"),
      inputPerMTok: "3",
      outputPerMTok: "15.000001",
      cacheReadPerMTok: null,
      cacheWritePerMTok: "0.3",
      reasoningPerMTok: null,
      source: "https://example.test/pricing, read 2026-10-22",
      notes: null,
    });
  });

  it.each([
    ["a negative rate", { inputPerMTok: "-1" }],
    ["a rate that isn't a number", { outputPerMTok: "abc" }],
    ["too many decimals", { cacheWritePerMTok: "0.1234567" }],
    ["a missing input rate", { inputPerMTok: "" }],
    ["no effective date", { effectiveFrom: "" }],
    ["an impossible date", { effectiveFrom: "2026-02-30" }],
    ["no source", { source: "  " }],
    ["no model", { model: "" }],
  ])("refuses %s", (_, change) => {
    expect(priceFormSchema.safeParse({ ...form, ...change }).success).toBe(false);
  });
});
