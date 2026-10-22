import { describe, expect, it, vi } from "vitest";
import { readLiveSessions, type Run } from "./claude-live.ts";

// Shape recorded from `claude agents --json` on Claude Code 2.1.296.
const OUTPUT = JSON.stringify([
  {
    pid: 32956,
    cwd: "d:\\Projects\\fixture-app",
    kind: "interactive",
    startedAt: 1792623705308,
    sessionId: "67040966-a899-44a7-bd94-0d73063d1825",
    name: "fixture-app-38",
    status: "idle",
  },
  {
    pid: 2900,
    cwd: "C:\\Users\\me\\elsewhere",
    kind: "interactive",
    startedAt: 1792627430535,
    sessionId: "4187e9ef-0803-48b1-9a1f-0ca1129844e3",
    status: "busy",
  },
  { cwd: "d:\\Projects\\fixture-app", kind: "background", startedAt: "not a number" },
]);

const now = () => new Date("2026-10-22T00:00:00.000Z");

describe("readLiveSessions", () => {
  it("runs exactly `claude agents --json` and keeps approved folders only", async () => {
    const run = vi.fn<Run>(async () => OUTPUT);
    const live = await readLiveSessions("C:\\claude.exe", ["D:\\Projects"], run, now);
    expect(run).toHaveBeenCalledWith("C:\\claude.exe", ["agents", "--json"]);
    expect(live).toEqual({
      ok: true,
      checkedAt: "2026-10-22T00:00:00.000Z",
      sessions: [
        {
          sessionId: "67040966-a899-44a7-bd94-0d73063d1825",
          cwd: "d:\\Projects\\fixture-app",
          kind: "interactive",
          status: "idle",
          startedAt: "2026-10-21T23:01:45.308Z",
        },
      ],
    });
  });

  it("reports a failed check instead of claiming nothing is running", async () => {
    const run: Run = async () => {
      throw new Error("spawn C:\\claude.exe ENOENT");
    };
    expect(await readLiveSessions("C:\\claude.exe", ["D:\\Projects"], run, now)).toEqual({
      ok: false,
      checkedAt: "2026-10-22T00:00:00.000Z",
      error: "claude agents --json failed: spawn C:\\claude.exe ENOENT",
    });
  });

  it("reports output that isn't a JSON array", async () => {
    const live = await readLiveSessions("C:\\claude.exe", ["D:\\Projects"], async () => "{}", now);
    expect(live.ok).toBe(false);
  });
});
