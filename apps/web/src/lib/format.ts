const numberFormat = new Intl.NumberFormat(undefined);
const compactFormat = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const usdFormat = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
// @db.Date values arrive as UTC midnight; formatting them in local time can show the day before.
const dateOnlyFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

/** 1234567 → "1.2M". Use where space is tight; show the exact value in a title. */
export function formatCompact(n: number): string {
  return compactFormat.format(n);
}

/** US dollars to the cent; a positive amount under a cent says so instead of showing $0.00. */
export function formatUsd(n: number): string {
  return n > 0 && n < 0.005 ? `< ${usdFormat.format(0.01)}` : usdFormat.format(n);
}

/** "YYYY-MM-DD" calendar day → "Oct 22, 2026". */
export function formatDay(day: string): string {
  return dateOnlyFormat.format(new Date(`${day}T00:00:00Z`));
}

export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

/** For calendar dates with no time (Prisma `@db.Date`, e.g. due dates). */
export function formatDateOnly(date: Date): string {
  return dateOnlyFormat.format(date);
}

export function formatDateTime(date: Date): string {
  return dateTimeFormat.format(date);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["week", 7 * 86_400_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "3 hours ago", "yesterday", "now". */
export function formatRelative(date: Date, now: Date = new Date()): string {
  const diff = date.getTime() - now.getTime();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return relativeFormat.format(Math.round(diff / ms), unit);
  }
  return relativeFormat.format(0, "second");
}
