import { z } from "zod";
import type { TokenTotals } from "./agent";
import { idSchema, optionalDate, optionalText } from "./validation";

/**
 * One version of a model's API price (ADR-019). USD per million tokens, entered by the user;
 * ADCC ships no prices. Applies from `effectiveFrom` until the model's next version.
 */
export interface PriceVersion {
  id: string;
  model: string;
  /** "YYYY-MM-DD", a calendar day in the server's time zone. */
  effectiveFrom: string;
  inputPerMTok: number;
  outputPerMTok: number;
  /** null: unknown. Usage with tokens of that kind gets no estimate rather than a guess. */
  cacheReadPerMTok: number | null;
  cacheWritePerMTok: number | null;
  reasoningPerMTok: number | null;
  source: string;
  notes: string | null;
}

/** The version in force for a model on a day, or null when none covers it. */
export function priceOn(
  prices: readonly PriceVersion[],
  model: string,
  day: string,
): PriceVersion | null {
  let found: PriceVersion | null = null;
  for (const price of prices) {
    if (price.model !== model || price.effectiveFrom > day) continue;
    if (!found || price.effectiveFrom > found.effectiveFrom) found = price;
  }
  return found;
}

export type CostEstimate =
  { usd: number; price: PriceVersion } | { usd: null; reason: string; price: PriceVersion | null };

const OPTIONAL_RATES = [
  ["cacheReadTokens", "cacheReadPerMTok", "cache read"],
  ["cacheWriteTokens", "cacheWritePerMTok", "cache write"],
  ["reasoningTokens", "reasoningPerMTok", "reasoning"],
] as const;

/**
 * Estimated API-equivalent cost of some tokens at one price version. Never a charge. Unknown
 * when there's no price, or a kind of token was used whose rate isn't known.
 */
export function estimateCost(tokens: TokenTotals, price: PriceVersion | null): CostEstimate {
  if (!price) return { usd: null, reason: "No price for this model on this date", price };
  let perMillion =
    tokens.inputTokens * price.inputPerMTok + tokens.outputTokens * price.outputPerMTok;
  for (const [tokenKey, rateKey, label] of OPTIONAL_RATES) {
    if (tokens[tokenKey] === 0) continue;
    const rate = price[rateKey];
    if (rate === null) return { usd: null, reason: `No ${label} rate in the price`, price };
    perMillion += tokens[tokenKey] * rate;
  }
  return { usd: perMillion / 1_000_000, price };
}

// Form fields arrive as strings. Rates stay strings so Postgres stores the exact decimal typed.
const RATE_PATTERN = /^\d{1,6}(\.\d{1,6})?$/;
const rate = z.string().trim().regex(RATE_PATTERN, "Enter USD per million tokens, like 3 or 0.30");
const optionalRate = z
  .string()
  .trim()
  .optional()
  .refine((value) => !value || RATE_PATTERN.test(value), "Enter a rate like 0.30, or leave blank")
  .transform((value) => value || null);

export const priceFormSchema = z.object({
  id: z
    .string()
    .optional()
    .transform((value) => value || null)
    .pipe(idSchema.nullable()),
  model: z.string().trim().min(1, "Model is required").max(200),
  effectiveFrom: optionalDate.pipe(z.date({ error: "Enter the first day this price applies" })),
  inputPerMTok: rate,
  outputPerMTok: rate,
  cacheReadPerMTok: optionalRate,
  cacheWritePerMTok: optionalRate,
  reasoningPerMTok: optionalRate,
  source: z
    .string()
    .trim()
    .min(1, "Say where this price came from, e.g. the pricing page and the date you read it")
    .max(500),
  notes: optionalText(2000),
});
export type PriceInput = z.infer<typeof priceFormSchema>;
