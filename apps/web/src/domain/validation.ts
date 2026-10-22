import { z } from "zod";

// Form fields arrive as strings; a blank optional field means "none" and is stored as null.

export const idSchema = z.uuid();

export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null);
}

export const optionalId = z
  .string()
  .optional()
  .transform((value) => value || null)
  .pipe(z.uuid().nullable());

export function optionalEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .optional()
    .transform((value) => value || null)
    .pipe(z.enum(values).nullable());
}

/** "YYYY-MM-DD" from an <input type="date"> → UTC midnight, matching Prisma `@db.Date`. */
export const optionalDate = z
  .string()
  .trim()
  .optional()
  .refine((value) => !value || isCalendarDate(value), "Enter a valid date")
  .transform((value) => (value ? new Date(`${value}T00:00:00Z`) : null));

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  // Rejects dates that roll over, such as 2026-02-30.
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Inverse of optionalDate, for prefilling a date input. */
export function toDateInput(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export const PAGE_SIZE = 25;

/** ?page= from the URL; anything invalid is page 1. */
export const pageParam = z.coerce.number().int().min(1).max(10_000).catch(1);

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}
