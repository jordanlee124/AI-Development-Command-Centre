import { beforeEach, describe, expect, it, vi } from "vitest";
import { listActivity } from "@/server/db/activity";
import { activeSourcesSince, countSessions } from "@/server/db/agents";
import { countProjects, listProjects, taskCountsByProject } from "@/server/db/projects";
import { repositorySummary } from "@/server/db/repositories";
import { taskCountsByStatus } from "@/server/db/tasks";
import { usageByModelSince } from "@/server/db/usage";
import { getOverview } from "./dashboard-service";

vi.mock("@/server/db/activity", () => ({ listActivity: vi.fn() }));
vi.mock("@/server/db/agents", () => ({
  activeSourcesSince: vi.fn(),
  countSessions: vi.fn(),
}));
vi.mock("@/server/db/projects", () => ({
  countProjects: vi.fn(),
  listProjects: vi.fn(),
  taskCountsByProject: vi.fn(),
}));
vi.mock("@/server/db/repositories", () => ({
  repositorySummary: vi.fn(),
  listRepositories: vi.fn(),
}));
vi.mock("@/server/db/tasks", () => ({ taskCountsByStatus: vi.fn() }));
vi.mock("@/server/db/usage", () => ({ usageByModelSince: vi.fn() }));

const now = new Date("2026-10-21T12:00:00Z");
const zeroTokens = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
};

function emptyDatabase() {
  vi.mocked(countProjects).mockResolvedValue(0);
  vi.mocked(taskCountsByStatus).mockResolvedValue({});
  vi.mocked(countSessions).mockResolvedValue(0);
  vi.mocked(activeSourcesSince).mockResolvedValue([]);
  vi.mocked(listActivity).mockResolvedValue([]);
  vi.mocked(listProjects).mockResolvedValue([]);
  vi.mocked(taskCountsByProject).mockResolvedValue(new Map());
  vi.mocked(usageByModelSince).mockResolvedValue([]);
  vi.mocked(repositorySummary).mockResolvedValue({ total: 0, linked: 0, lastSyncedAt: null });
}

describe("getOverview", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    emptyDatabase();
  });

  it("reports zeros and no usage for an empty database", async () => {
    const overview = await getOverview(now);
    expect(overview).toMatchObject({
      projectCount: 0,
      activeTasks: 0,
      totalTasks: 0,
      agents: { sessionCount: 0, activeSources: [] },
      projectCompletion: [],
      usage: null,
    });
  });

  it("combines task counts into active totals and per-project completion", async () => {
    vi.mocked(taskCountsByStatus).mockResolvedValue({
      TODO: 2,
      IN_PROGRESS: 1,
      DONE: 3,
      BACKLOG: 4,
    });
    vi.mocked(listProjects).mockResolvedValue([
      {
        id: "p1",
        name: "ADCC",
        slug: "adcc",
        description: null,
        updatedAt: now,
        _count: { repositories: 1 },
      },
      {
        id: "p2",
        name: "Empty",
        slug: "empty",
        description: null,
        updatedAt: now,
        _count: { repositories: 0 },
      },
    ]);
    vi.mocked(taskCountsByProject).mockResolvedValue(
      new Map([["p1", { DONE: 3, TODO: 1, CANCELLED: 2 }]]),
    );

    const overview = await getOverview(now);

    expect(overview.activeTasks).toBe(3);
    expect(overview.totalTasks).toBe(10);
    // Cancelled tasks are left out of both the count and the percent, so "3/4" matches 75%.
    expect(overview.projectCompletion).toEqual([
      { id: "p1", name: "ADCC", total: 4, done: 3, percent: 75 },
      { id: "p2", name: "Empty", total: 0, done: 0, percent: null },
    ]);
  });

  it("sums usage across models, most tokens first, over a 30-day window", async () => {
    vi.mocked(usageByModelSince).mockResolvedValue([
      // More calls but fewer tokens: must rank below "big".
      { model: "small", records: 9, ...zeroTokens, inputTokens: 10 },
      { model: "big", records: 1, ...zeroTokens, inputTokens: 100, outputTokens: 50 },
    ]);

    const overview = await getOverview(now);

    expect(usageByModelSince).toHaveBeenCalledWith(new Date("2026-09-21T12:00:00Z"));
    expect(overview.usage?.records).toBe(10);
    expect(overview.usage?.totals).toMatchObject({ inputTokens: 110, outputTokens: 50 });
    expect(overview.usage?.byModel.map((row) => row.model)).toEqual(["big", "small"]);
  });

  it("looks for active agents in the last 24 hours", async () => {
    await getOverview(now);
    expect(activeSourcesSince).toHaveBeenCalledWith(new Date("2026-10-20T12:00:00Z"));
  });
});
