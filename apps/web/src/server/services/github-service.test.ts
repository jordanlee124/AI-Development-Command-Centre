import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/domain/errors";
import {
  findLinkedRepositories,
  findSyncRepository,
  listSyncTargets,
  recordSyncFailure,
  saveSnapshot,
} from "@/server/db/github";
import { listProjectOptions } from "@/server/db/projects";
import { mockGitHubFetch } from "@/server/github/__fixtures__/mock-fetch";
import { retry } from "@/server/github/client";
import {
  getAccessibleRepositories,
  syncAllRepositories,
  syncDueRepositories,
  syncRepository,
} from "./github-service";

// Integration of service + real GitHub adapter over mocked HTTP (recorded fixtures); only the
// database layer is mocked.

vi.mock("@/server/env", () => ({
  getEnv: () => ({
    GITHUB_TOKEN: `github_pat_${"x".repeat(30)}`,
    GITHUB_API_URL: "https://api.github.test",
    GITHUB_SYNC_INTERVAL_MINUTES: 15,
  }),
}));
vi.mock("@/server/db/activity", () => ({ listActivity: vi.fn() }));
vi.mock("@/server/db/projects", () => ({ listProjectOptions: vi.fn() }));
vi.mock("@/server/db/github", () => ({
  findLinkedRepositories: vi.fn(),
  findSyncRepository: vi.fn(),
  getRepositoryWithSnapshot: vi.fn(),
  listSyncTargets: vi.fn(),
  recordSyncFailure: vi.fn(),
  saveSnapshot: vi.fn(),
}));

// Fixture ids (UUIDv7-shaped).
const R1 = "0199f3a0-0000-7000-8000-0000000000d1";
const R2 = "0199f3a0-0000-7000-8000-0000000000d2";
const P1 = "0199f3a0-0000-7000-8000-0000000000a1";
const REPO = "/repos/octocat/hello-world";

function target(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    owner: "octocat",
    name: "hello-world",
    lastSyncAttemptAt: null,
    syncFailures: 0,
    ...overrides,
  };
}

// A rate-limit reset an hour from now.
const RESET = Math.floor(Date.now() / 1000) + 3600;

beforeEach(() => {
  vi.clearAllMocks();
  // The lock and rate-limit pause live on globalThis; start each test without them.
  Reflect.deleteProperty(globalThis, "adccGitHub");
  retry.baseDelayMs = 0;
  vi.mocked(findSyncRepository).mockResolvedValue({
    id: R1,
    owner: "octocat",
    name: "hello-world",
    projectId: P1,
    project: { archivedAt: null },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("syncRepository", () => {
  it("saves the normalised snapshot and its timeline entries", async () => {
    mockGitHubFetch();
    await expect(syncRepository(R1)).resolves.toEqual({ ok: true });

    expect(saveSnapshot).toHaveBeenCalledOnce();
    const [id, projectId, snapshot, activity, at] = vi.mocked(saveSnapshot).mock.calls[0]!;
    expect([id, projectId]).toEqual([R1, P1]);
    expect(at).toBeInstanceOf(Date);
    expect(snapshot.repository.githubId).toBe(1296269);
    expect(snapshot.pullRequests).toHaveLength(3);
    expect(activity.map((event) => event.dedupeKey)).toContain(
      "github:1296269:commit:7fd1a60b01f91b314f59955a4e4d4e80d8edf11d",
    );
    expect(recordSyncFailure).not.toHaveBeenCalled();
  });

  it("records a GitHub failure and keeps the last snapshot", async () => {
    mockGitHubFetch({
      [REPO]: () => Response.json({ message: "Bad credentials" }, { status: 401 }),
    });
    const result = await syncRepository(R1);

    expect(result).toMatchObject({ ok: false, kind: "unauthorized" });
    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(recordSyncFailure).toHaveBeenCalledWith(
      R1,
      expect.stringMatching(/401/),
      expect.any(Date),
      // A rejected token isn't this repository's fault: no backoff penalty.
      false,
    );
  });

  it("records a save failure without leaking the database error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGitHubFetch();
    vi.mocked(saveSnapshot).mockRejectedValueOnce(new Error("unique constraint on githubId"));
    const result = await syncRepository(R1);

    expect(result).toMatchObject({ ok: false, kind: "internal" });
    expect(recordSyncFailure).toHaveBeenCalledWith(
      R1,
      expect.stringMatching(/unexpectedly; see the server log/),
      expect.any(Date),
      true,
    );
  });

  it("joins a sync already running for the same repository", async () => {
    const { requests } = mockGitHubFetch();
    await Promise.all([syncRepository(R1), syncRepository(R1)]);
    expect(requests.filter((r) => r.url.pathname === REPO)).toHaveLength(1);
    expect(saveSnapshot).toHaveBeenCalledOnce();
  });

  it("rejects an unknown repository and a malformed id", async () => {
    vi.mocked(findSyncRepository).mockResolvedValueOnce(null);
    await expect(syncRepository(R1)).rejects.toBeInstanceOf(DomainError);
    await expect(syncRepository("not-an-id")).rejects.toThrow();
  });
});

describe("batch sync", () => {
  it("syncs only repositories whose next sync time has come", async () => {
    const now = new Date("2026-10-22T12:00:00Z");
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
    vi.mocked(listSyncTargets).mockResolvedValue([
      target(R1, { lastSyncAttemptAt: minutesAgo(20) }),
      // Failed twice: waits 4 intervals (60 min), so 20 minutes isn't enough.
      target(R2, { lastSyncAttemptAt: minutesAgo(20), syncFailures: 2 }),
    ]);
    mockGitHubFetch();

    await expect(syncDueRepositories(15 * 60_000, now)).resolves.toMatchObject({
      synced: 1,
      failed: 0,
      stoppedBy: null,
    });
    expect(vi.mocked(saveSnapshot).mock.calls.map((call) => call[0])).toEqual([R1]);
  });

  it("stops at a rate limit instead of failing every repository", async () => {
    vi.mocked(listSyncTargets).mockResolvedValue([target(R1), target(R2)]);
    mockGitHubFetch({
      [REPO]: () =>
        new Response("{}", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(RESET) },
        }),
    });

    const { synced, failed, stoppedBy } = await syncAllRepositories();
    expect({ synced, failed }).toEqual({ synced: 0, failed: 1 });
    expect(stoppedBy).toMatchObject({ kind: "rate_limited", retryAt: new Date(RESET * 1000) });
    expect(recordSyncFailure).toHaveBeenCalledTimes(1);
  });

  it("doesn't call GitHub again until a known rate limit resets", async () => {
    const { fetch } = mockGitHubFetch({
      [REPO]: () => new Response("{}", { status: 429, headers: { "retry-after": "120" } }),
    });
    const first = await syncRepository(R1);
    const calls = fetch.mock.calls.length;
    const second = await syncRepository(R2);

    expect(first).toMatchObject({ ok: false, kind: "rate_limited" });
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(calls);
  });
});

describe("getAccessibleRepositories", () => {
  it("marks repositories already linked to a project", async () => {
    mockGitHubFetch();
    vi.mocked(listProjectOptions).mockResolvedValue([{ id: P1, name: "ADCC" }]);
    vi.mocked(findLinkedRepositories).mockResolvedValue([
      { githubId: null, owner: "octocat", name: "hello-world", project: { id: P1, name: "ADCC" } },
      // Linked under an old name; matched by GitHub id (octocat/Spoon-Knife).
      {
        githubId: BigInt(1300192),
        owner: "octocat",
        name: "old-name",
        project: { id: P1, name: "ADCC" },
      },
    ]);

    const { repositories, projects } = await getAccessibleRepositories();
    expect(projects).toEqual([{ id: P1, name: "ADCC" }]);
    expect(repositories.map((r) => [r.fullName, r.linkedProject?.name ?? null])).toEqual([
      ["octocat/Spoon-Knife", "ADCC"],
      ["octocat/Hello-World", "ADCC"],
      ["octocat/linguist", null],
    ]);
  });
});
