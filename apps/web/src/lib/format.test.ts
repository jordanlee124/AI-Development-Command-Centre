import { describe, expect, it } from "vitest";
import { formatDateOnly, formatRelative } from "./format";

const now = new Date("2026-10-21T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

describe("formatRelative", () => {
  it("uses the largest whole unit", () => {
    expect(formatRelative(ago(3 * 3_600_000), now)).toBe(rtf.format(-3, "hour"));
    expect(formatRelative(ago(2 * 86_400_000), now)).toBe(rtf.format(-2, "day"));
  });

  it("says now for under a minute", () => {
    expect(formatRelative(ago(20_000), now)).toBe(rtf.format(0, "second"));
  });

  it("handles future dates", () => {
    expect(formatRelative(new Date(now.getTime() + 5 * 60_000), now)).toBe(rtf.format(5, "minute"));
  });
});

describe("formatDateOnly", () => {
  it("shows the stored calendar day regardless of the local time zone", () => {
    // Prisma returns @db.Date 2026-10-21 as UTC midnight.
    const due = new Date("2026-10-21T00:00:00Z");
    const expected = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(due);
    expect(formatDateOnly(due)).toBe(expected);
    expect(formatDateOnly(due)).toContain("21");
  });
});
