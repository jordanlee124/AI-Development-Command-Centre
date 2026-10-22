import {
  ANALYTICS_SETTINGS_KEY,
  analyticsSettingsFormSchema,
  analyticsSettingsSchema,
  analyzeUsage,
  budgetStatus,
  dayIn,
  DEFAULT_ANALYTICS_SETTINGS,
  priceRows,
  resolveAnalyticsQuery,
  summarize,
  usageCsv,
  type AnalyticsSettings,
} from "@/domain/analytics";
import { DomainError } from "@/domain/errors";
import { idSchema, toDateInput } from "@/domain/validation";
import { priceFormSchema } from "@/domain/pricing";
import { totalTokens } from "@/domain/agent";
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

/** The server runs on the user's machine, so its zone is the user's (ADR-019). */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export async function getAnalyticsSettings(): Promise<AnalyticsSettings> {
  const stored = await getSetting(ANALYTICS_SETTINGS_KEY);
  // A stored value that fails validation throws: silently dropping budgets would hide it.
  return stored === null ? DEFAULT_ANALYTICS_SETTINGS : analyticsSettingsSchema.parse(stored);
}

/** Everything /analytics shows. `query` is the page's raw search params. */
export async function getAnalytics(query: unknown, now = new Date(), timeZone = serverTimeZone()) {
  const today = dayIn(now, timeZone);
  const { range, period, notice } = resolveAnalyticsQuery(query, today);
  const month = { from: `${today.slice(0, 7)}-01`, to: today };
  const [rows, monthRows, prices, settings, first] = await Promise.all([
    usageRowsBetween(range.from, range.to, timeZone),
    usageRowsBetween(month.from, month.to, timeZone),
    listPrices(),
    getAnalyticsSettings(),
    firstUsageAt(),
  ]);
  const firstDay = first && dayIn(first, timeZone);
  const monthSummary = summarize(priceRows(monthRows, prices));
  return {
    range,
    period,
    notice,
    today,
    timeZone,
    firstDay,
    priceCount: prices.length,
    settings,
    usage: analyzeUsage(priceRows(rows, prices), range, period, firstDay),
    month: { ...month, summary: monthSummary },
    budget: budgetStatus(monthSummary, settings.budget),
  };
}

export type Analytics = Awaited<ReturnType<typeof getAnalytics>>;

/** The CSV for a range, and a file name that says which range it holds. */
export async function exportUsageCsv(
  query: unknown,
  now = new Date(),
  timeZone = serverTimeZone(),
) {
  const { range } = resolveAnalyticsQuery(query, dayIn(now, timeZone));
  const [rows, prices] = await Promise.all([
    usageRowsBetween(range.from, range.to, timeZone),
    listPrices(),
  ]);
  return {
    csv: usageCsv(priceRows(rows, prices)),
    filename: `adcc-usage-${range.from}-to-${range.to}.csv`,
  };
}

/** /analytics/settings: settings, every price version, and models that have no price at all. */
export async function getAnalyticsSettingsPage() {
  const [settings, prices, models] = await Promise.all([
    getAnalyticsSettings(),
    listPrices(),
    usageModels(),
  ]);
  const priced = new Set(prices.map((price) => price.model));
  return {
    settings,
    prices,
    unpricedModels: models
      .filter((row) => !priced.has(row.model))
      .map((row) => ({ model: row.model, tokens: totalTokens(row) }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}

export async function saveAnalyticsSettings(input: unknown) {
  await setSetting(ANALYTICS_SETTINGS_KEY, analyticsSettingsFormSchema.parse(input));
}

export async function savePrice(input: unknown) {
  const { id, ...data } = priceFormSchema.parse(input);
  const existing = await findPriceVersion(data.model, data.effectiveFrom);
  if (existing && existing.id !== id) {
    throw new DomainError(
      "CONFLICT",
      "This model already has a price starting that day. Edit that one instead.",
      "effectiveFrom",
    );
  }
  const label = `${data.model} from ${toDateInput(data.effectiveFrom)}`;
  if (!id) {
    await insertPrice(data, { type: "pricing.created", title: `Added price for ${label}` });
    return;
  }
  if (!(await getPrice(id))) throw new DomainError("NOT_FOUND", "That price no longer exists.");
  await updatePrice(id, data, { type: "pricing.updated", title: `Edited price for ${label}` });
}

export async function deletePrice(id: unknown) {
  const price = await getPrice(idSchema.parse(id));
  if (!price) throw new DomainError("NOT_FOUND", "That price no longer exists.");
  await deletePriceRow(price.id, {
    type: "pricing.deleted",
    title: `Deleted price for ${price.model} from ${price.effectiveFrom}`,
  });
}
