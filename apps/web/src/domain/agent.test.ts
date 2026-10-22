import { describe, expect, it } from "vitest";
import {
  bridgeConnection,
  liveCheck,
  matchProjectByCwd,
  sessionState,
  type StoredBridgeStatus,
} from "./agent";

const NOW = new Date("2026-10-22T00:01:00.000Z");
const SESSION = "0b1e2c3d-4f50-4a6b-8c7d-9e0f1a2b3c4d";

function bridge(overrides: Partial<StoredBridgeStatus> = {}): StoredBridgeStatus {
  return {
    version: "0.1.0",
    pollSeconds: 10,
    approvedFolders: ["D:\\Projects"],
    providers: [],
    errors: [],
    lastSeenAt: "2026-10-22T00:00:50.000Z",
    live: {
      ok: true,
      checkedAt: "2026-10-22T00:00:49.000Z",
      sessions: [
        {
          sessionId: SESSION,
          cwd: "D:\\Projects\\app",
          kind: "interactive",
          status: "busy",
          startedAt: "2026-10-21T23:00:00.000Z",
        },
      ],
    },
    ...overrides,
  };
}

describe("bridgeConnection", () => {
  it("is never connected without a report", () => {
    expect(bridgeConnection(null, NOW)).toEqual({ kind: "never" });
  });

  it("is connected within three poll intervals, stale after", () => {
    expect(bridgeConnection(bridge(), NOW).kind).toBe("connected");
    expect(bridgeConnection(bridge({ lastSeenAt: "2026-10-22T00:00:30.000Z" }), NOW).kind).toBe(
      "connected",
    ); // 30 s floor
    expect(bridgeConnection(bridge({ lastSeenAt: "2026-10-22T00:00:29.000Z" }), NOW).kind).toBe(
      "stale",
    );
    expect(
      bridgeConnection(bridge({ pollSeconds: 60, lastSeenAt: "2026-10-21T23:58:01.000Z" }), NOW)
        .kind,
    ).toBe("connected");
  });
});

const claude = (externalId: string) => ({ source: "CLAUDE_CODE" as const, externalId });

describe("sessionState", () => {
  it("is unverified when the report is new but the live check it carries is old", () => {
    const old = bridge();
    const stale = bridge({ live: { ...old.live, checkedAt: "2026-10-22T00:00:00.000Z" } });
    expect(sessionState(claude(SESSION), stale, NOW)).toEqual({
      kind: "unverified",
      reason: "The live session check is out of date.",
    });
    expect(liveCheck(stale, NOW).ok).toBe(false);
  });

  it("never applies Claude Code's live check to another tool's session", () => {
    expect(sessionState({ source: "CODEX", externalId: SESSION }, bridge(), NOW).kind).toBe(
      "unverified",
    );
  });

  it("is running only when a fresh live check lists the session", () => {
    expect(sessionState(claude(SESSION), bridge(), NOW)).toEqual({
      kind: "running",
      status: "busy",
      checkedAt: new Date("2026-10-22T00:00:49.000Z"),
    });
  });

  it("is not running when a fresh live check doesn't list it", () => {
    expect(sessionState(claude("another-session"), bridge(), NOW).kind).toBe("not-running");
  });

  it("is unverified when the bridge is silent, never reported, or the check failed", () => {
    expect(sessionState(claude(SESSION), null, NOW).kind).toBe("unverified");
    // A stale "busy" must not read as running.
    expect(
      sessionState(claude(SESSION), bridge({ lastSeenAt: "2026-10-21T23:00:00.000Z" }), NOW),
    ).toEqual({
      kind: "unverified",
      reason: "The Agent Bridge stopped reporting.",
    });
    expect(
      sessionState(
        claude(SESSION),
        bridge({ live: { ok: false, checkedAt: "2026-10-22T00:00:49.000Z", error: "ENOENT" } }),
        NOW,
      ),
    ).toEqual({ kind: "unverified", reason: "The live session check failed." });
  });
});

describe("matchProjectByCwd", () => {
  const projects = [
    { id: "outer", localPath: "D:\\Projects\\app" },
    { id: "inner", localPath: "D:\\Projects\\app\\packages\\api" },
    { id: "other", localPath: "D:\\Projects\\app-old" },
  ];

  it.each([
    ["d:\\Projects\\app", "outer"], // drive letter case differs
    ["D:\\Projects\\app\\src", "outer"],
    ["D:\\Projects\\app\\packages\\api\\src", "inner"], // deepest folder wins
    ["D:\\Projects\\app-old", "other"], // not a prefix match on "app"
    ["D:/Projects/app/", "outer"],
    ["C:\\Elsewhere", null],
    ["D:\\Projects\\app\\..\\..\\Secret", null], // could climb out: refused, not resolved
    ["\\\\?\\D:\\Projects\\app", null],
    [null, null],
  ])("%s → %s", (cwd, expected) => {
    expect(matchProjectByCwd(cwd, projects)).toBe(expected);
  });
});
