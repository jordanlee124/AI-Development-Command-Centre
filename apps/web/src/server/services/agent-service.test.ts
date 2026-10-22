import type { IngestRequest, SessionBatch } from "@adcc/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import {
  countSessionsBySource,
  errorCountsBySession,
  listProjectPaths,
  listSessions,
  saveSessionBatch,
  usageBySessionAndModel,
} from "@/server/db/agents";
import { getSetting, setSetting } from "@/server/db/settings";
import { getAgentsOverview, ingestBridgeReport } from "./agent-service";

vi.mock("@/server/env", () => ({ getEnv: () => ({ ADCC_BRIDGE_TOKEN: "t".repeat(32) }) }));
vi.mock("@/server/db/settings", () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
vi.mock("@/server/db/agents", () => ({
  countEventsByType: vi.fn(),
  countSessionsBySource: vi.fn(),
  errorCountsBySession: vi.fn(),
  getSession: vi.fn(),
  listProjectPaths: vi.fn(),
  listSessionErrors: vi.fn(),
  listSessionEvents: vi.fn(),
  listSessions: vi.fn(),
  saveSessionBatch: vi.fn(),
  toolUseCounts: vi.fn(),
  usageBySessionAndModel: vi.fn(),
}));

const NOW = new Date("2026-10-22T00:01:00.000Z");
const P1 = "0199f3a0-0000-7000-8000-0000000000a1";
const S1 = "0199f3a0-0000-7000-8000-0000000000e1";

const bridge: IngestRequest["bridge"] = {
  version: "0.1.0",
  pollSeconds: 10,
  approvedFolders: ["D:\\Projects"],
  live: {
    ok: true,
    checkedAt: "2026-10-22T00:00:59.000Z",
    sessions: [
      {
        sessionId: "live-session",
        cwd: "D:\\Projects\\app",
        kind: "interactive",
        status: "busy",
        startedAt: "2026-10-21T23:00:00.000Z",
      },
    ],
  },
  providers: [{ source: "CLAUDE_CODE", dataDir: "C:\\claude", files: 1, error: null }],
  errors: [],
};

function batch(sessionId: string, cwd: string | null): SessionBatch {
  return {
    source: "CLAUDE_CODE",
    sessionId,
    sourcePath: `C:\\Users\\me\\.claude\\projects\\x\\${sessionId}.jsonl`,
    cwd,
    gitBranch: "main",
    title: null,
    details: [],
    skippedRecords: 0,
    events: [],
  };
}

beforeEach(() => {
  vi.mocked(saveSessionBatch).mockResolvedValue({ sessionId: S1, insertedEvents: 2 });
  vi.mocked(listProjectPaths).mockResolvedValue([
    { id: P1, localPath: "D:\\Projects\\app" },
    { id: "no-path", localPath: null },
  ]);
});

describe("ingestBridgeReport", () => {
  it("stores the bridge report with the time it arrived", async () => {
    await ingestBridgeReport({ bridge, sessions: [] }, NOW);
    expect(setSetting).toHaveBeenCalledWith("bridge.status", {
      ...bridge,
      lastSeenAt: NOW.toISOString(),
    });
    expect(listProjectPaths).not.toHaveBeenCalled(); // a heartbeat touches nothing else
  });

  it("maps each session to the project whose folder holds its working folder", async () => {
    const result = await ingestBridgeReport(
      {
        bridge,
        sessions: [
          batch("a", "d:\\projects\\app\\src"),
          batch("b", "D:\\Elsewhere"),
          batch("c", null),
        ],
      },
      NOW,
    );
    expect(
      vi.mocked(saveSessionBatch).mock.calls.map(([b, project]) => [b.sessionId, project]),
    ).toEqual([
      ["a", P1],
      ["b", null],
      ["c", null],
    ]);
    expect(result).toEqual({ sessions: 3, insertedEvents: 6 });
  });
});

describe("getAgentsOverview", () => {
  const row = (externalId: string, source: "CLAUDE_CODE" | "CODEX" = "CLAUDE_CODE") => ({
    id: externalId === "live-session" ? S1 : `${S1.slice(0, -1)}2`,
    source,
    externalId,
    title: null,
    details: null as Prisma.JsonValue,
    cwd: "D:\\Projects\\app",
    gitBranch: "main",
    sourcePath: "x",
    startedAt: NOW,
    lastEventAt: NOW,
    skippedRecordCount: 0,
    project: null,
  });

  beforeEach(() => {
    vi.mocked(listSessions).mockResolvedValue([row("live-session"), row("old-session")]);
    vi.mocked(countSessionsBySource).mockResolvedValue(new Map([["CLAUDE_CODE", 2]]));
    vi.mocked(errorCountsBySession).mockResolvedValue(new Map([[S1, 3]]));
    const usage = {
      sessionId: S1,
      responses: 1,
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      reasoningTokens: 5,
    };
    vi.mocked(usageBySessionAndModel).mockResolvedValue([
      { ...usage, model: "claude-sonnet-5-5", lastUsedAt: new Date("2026-10-21T00:00:00Z") },
      { ...usage, model: "claude-opus-5-5", lastUsedAt: new Date("2026-10-22T00:00:00Z") },
    ]);
  });

  it("combines live state, models, tokens and errors per session", async () => {
    vi.mocked(getSetting).mockResolvedValue({ ...bridge, lastSeenAt: "2026-10-22T00:00:59.000Z" });
    const { bridge: summary, sessions } = await getAgentsOverview(undefined, NOW);
    expect(summary.connection.kind).toBe("connected");
    expect(sessions[0]).toMatchObject({
      state: { kind: "running", status: "busy" },
      models: ["claude-opus-5-5", "claude-sonnet-5-5"],
      tokens: { inputTokens: 2, reasoningTokens: 10 },
      errors: 3,
    });
    // Usage unknown is null, not zero; a session the live check doesn't list isn't running.
    expect(sessions[1]).toMatchObject({ state: { kind: "not-running" }, tokens: null, errors: 0 });
  });

  it("never reports a session as running from a stale report", async () => {
    vi.mocked(getSetting).mockResolvedValue({ ...bridge, lastSeenAt: "2026-10-21T00:00:00.000Z" });
    const { bridge: summary, sessions } = await getAgentsOverview(undefined, NOW);
    expect(summary.connection.kind).toBe("stale");
    expect(sessions.map((s) => s.state.kind)).toEqual(["unverified", "unverified"]);
  });

  it("never reports a Codex session as running, and shows its details", async () => {
    vi.mocked(getSetting).mockResolvedValue({ ...bridge, lastSeenAt: "2026-10-22T00:00:59.000Z" });
    const codex = { ...row("live-session", "CODEX"), details: [{ label: "Client", value: "x" }] };
    vi.mocked(listSessions).mockResolvedValue([codex]);
    const { sessions } = await getAgentsOverview("CODEX", NOW);
    expect(listSessions).toHaveBeenLastCalledWith(200, "CODEX");
    // The Claude live check lists this id, but it says nothing about Codex.
    expect(sessions[0]).toMatchObject({
      state: { kind: "unverified", reason: "Codex has no supported live session check." },
      details: [{ label: "Client", value: "x" }],
    });
  });

  it("reads stored details it can't parse as none", async () => {
    vi.mocked(getSetting).mockResolvedValue(null);
    vi.mocked(listSessions).mockResolvedValue([{ ...row("old-session"), details: { bad: 1 } }]);
    const { sessions } = await getAgentsOverview(undefined, NOW);
    expect(sessions[0]?.details).toEqual([]);
  });

  it("treats a stored report it can't read as no report", async () => {
    vi.mocked(getSetting).mockResolvedValue({ version: 1 });
    const { bridge: summary } = await getAgentsOverview(undefined, NOW);
    expect(summary).toMatchObject({
      configured: true,
      status: null,
      connection: { kind: "never" },
    });
  });
});
