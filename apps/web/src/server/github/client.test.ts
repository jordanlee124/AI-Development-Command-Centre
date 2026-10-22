import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockGitHubFetch } from "./__fixtures__/mock-fetch";
import { fixtureFor } from "./__fixtures__/routes";
import {
  fetchAccessibleRepositories,
  fetchConnection,
  fetchRepositorySnapshot,
  GitHubError,
  retry,
} from "./client";

// Fixture token: never a real credential.
const TOKEN = `github_pat_${"x".repeat(30)}`;
const env = vi.hoisted(() => ({
  GITHUB_TOKEN: undefined as string | undefined,
  GITHUB_API_URL: "https://api.github.test",
}));
vi.mock("@/server/env", () => ({ getEnv: () => env }));

const REPO = "/repos/octocat/hello-world";
// Copies: the recorded fixtures are shared between tests.
const fixture = <T>(path: string) => structuredClone(fixtureFor(path)) as T;

async function caught(promise: Promise<unknown>): Promise<GitHubError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GitHubError);
  return error as GitHubError;
}

beforeEach(() => {
  env.GITHUB_TOKEN = TOKEN;
  retry.baseDelayMs = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchRepositorySnapshot", () => {
  it("normalises the recorded responses", async () => {
    mockGitHubFetch();
    const snapshot = await fetchRepositorySnapshot("octocat", "hello-world");

    expect(snapshot.repository).toMatchObject({
      githubId: 1296269,
      owner: "octocat",
      name: "hello-world",
      fullName: "octocat/Hello-World",
      defaultBranch: "master",
      isPrivate: false,
    });
    expect(snapshot.branches.map((b) => b.name)).toEqual(["master", "octocat-patch-1", "test"]);
    expect(snapshot.commits[0]).toMatchObject({
      sha: "7fd1a60b01f91b314f59955a4e4d4e80d8edf11d",
      // First line only.
      message: "Merge pull request #6 from Spaceghost/patch-1",
      authorLogin: "octocat",
      committedAt: new Date("2012-03-06T23:06:50Z"),
    });
    const pr = (n: number) => snapshot.pullRequests.find((p) => p.number === n);
    expect(pr(11593)).toMatchObject({ state: "open", reviewStatus: "approved", approvals: 1 });
    // Only COMMENTED reviews: no verdict.
    expect(pr(11592)).toMatchObject({ reviewStatus: "no_reviews", approvals: 0 });
    // Closed PRs aren't asked for reviews.
    expect(pr(11594)).toMatchObject({ state: "closed", reviewStatus: null, approvals: null });
    // The issues endpoint also returns PRs; they're dropped.
    expect(snapshot.issues.map((i) => i.number)).toEqual([11585, 11583]);
    expect(snapshot.workflowRuns[0]).toMatchObject({
      githubId: 35184313404,
      status: "completed",
      conclusion: "success",
      branch: "master",
    });
  });

  it("handles an empty repository, whose commits GitHub answers with 409", async () => {
    mockGitHubFetch({
      [`${REPO}/branches`]: () => Response.json([]),
      [`${REPO}/commits`]: () =>
        Response.json({ message: "Git Repository is empty." }, { status: 409 }),
    });
    const snapshot = await fetchRepositorySnapshot("octocat", "hello-world");
    expect(snapshot.branches).toEqual([]);
    expect(snapshot.commits).toEqual([]);
  });

  it("skips issues when they're turned off (GitHub would answer 410)", async () => {
    const { requests } = mockGitHubFetch({
      [REPO]: () => Response.json({ ...fixture<object>(REPO), has_issues: false }),
      [`${REPO}/issues`]: () => Response.json({ message: "Issues are disabled" }, { status: 410 }),
    });
    const snapshot = await fetchRepositorySnapshot("octocat", "hello-world");
    expect(snapshot.issues).toEqual([]);
    expect(requests.some((r) => r.url.pathname.endsWith("/issues"))).toBe(false);
  });

  it("clips values to their column sizes and refuses non-https links", async () => {
    mockGitHubFetch({
      [`${REPO}/commits`]: () => {
        const list = fixture<{ commit: { author: { name: string } } }[]>(`${REPO}/commits`);
        list[0]!.commit.author.name = "n".repeat(400);
        return Response.json(list);
      },
    });
    const snapshot = await fetchRepositorySnapshot("octocat", "hello-world");
    expect(snapshot.commits[0]!.authorName).toHaveLength(255);

    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGitHubFetch({
      [REPO]: () => Response.json({ ...fixture<object>(REPO), html_url: "javascript:alert(1)" }),
    });
    expect((await caught(fetchRepositorySnapshot("octocat", "hello-world"))).kind).toBe(
      "invalid_response",
    );
  });

  it("only sends authenticated GET requests to the configured API", async () => {
    const { requests } = mockGitHubFetch();
    await fetchRepositorySnapshot("octocat", "hello-world");

    expect(requests.length).toBeGreaterThan(0);
    for (const { url, init } of requests) {
      expect(url.origin).toBe("https://api.github.test");
      expect(init.method).toBe("GET");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    }
    // Reviews are fetched for the two open PRs only.
    expect(requests.filter((r) => r.url.pathname.endsWith("/reviews"))).toHaveLength(2);
  });
});

describe("errors", () => {
  it("refuses to call GitHub without a token", async () => {
    env.GITHUB_TOKEN = undefined;
    const { fetch } = mockGitHubFetch();
    expect((await caught(fetchConnection())).kind).toBe("not_configured");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a revoked token without echoing it", async () => {
    mockGitHubFetch({
      "/user": () => Response.json({ message: "Bad credentials" }, { status: 401 }),
    });
    const error = await caught(fetchConnection());
    expect(error.kind).toBe("unauthorized");
    expect(error.message).toMatch(/revoked or expired/);
    expect(error.message).not.toContain(TOKEN);
  });

  it("reads the primary rate limit reset time", async () => {
    const reset = Math.floor(Date.now() / 1000) + 3600;
    mockGitHubFetch({
      [REPO]: () =>
        Response.json(
          { message: "API rate limit exceeded" },
          {
            status: 403,
            headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
          },
        ),
    });
    const error = await caught(fetchRepositorySnapshot("octocat", "hello-world"));
    expect(error.kind).toBe("rate_limited");
    expect(error.retryAt).toEqual(new Date(reset * 1000));
  });

  it("honours retry-after on a secondary rate limit", async () => {
    mockGitHubFetch({
      [REPO]: () => new Response("{}", { status: 429, headers: { "retry-after": "60" } }),
    });
    const before = Date.now();
    const error = await caught(fetchRepositorySnapshot("octocat", "hello-world"));
    expect(error.kind).toBe("rate_limited");
    expect(error.retryAt!.getTime()).toBeGreaterThanOrEqual(before + 60_000);
  });

  it("treats a bare 429 as a rate limit and waits at least a minute", async () => {
    mockGitHubFetch({ [REPO]: () => new Response("{}", { status: 429 }) });
    const before = Date.now();
    const error = await caught(fetchRepositorySnapshot("octocat", "hello-world"));
    expect(error.kind).toBe("rate_limited");
    expect(error.retryAt!.getTime()).toBeGreaterThanOrEqual(before + 60_000);
  });

  it("handles remaining=0 without a reset header instead of throwing", async () => {
    mockGitHubFetch({
      [REPO]: () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
    });
    const error = await caught(fetchRepositorySnapshot("octocat", "hello-world"));
    expect(error.kind).toBe("rate_limited");
    expect(Number.isNaN(error.retryAt!.getTime())).toBe(false);
  });

  it("recognises a secondary rate limit sent as a plain 403", async () => {
    mockGitHubFetch({
      [REPO]: () =>
        Response.json(
          { message: "You have exceeded a secondary rate limit." },
          { status: 403, headers: { "x-ratelimit-remaining": "4000" } },
        ),
    });
    expect((await caught(fetchRepositorySnapshot("octocat", "hello-world"))).kind).toBe(
      "rate_limited",
    );
  });

  it("names the endpoint when a permission is missing", async () => {
    mockGitHubFetch({
      [`${REPO}/actions/runs`]: () =>
        Response.json(
          { message: "Resource not accessible by personal access token" },
          { status: 403, headers: { "x-ratelimit-remaining": "4000" } },
        ),
    });
    const error = await caught(fetchRepositorySnapshot("octocat", "hello-world"));
    expect(error.kind).toBe("forbidden");
    expect(error.message).toContain("/actions/runs");
    expect(error.message).toContain("Resource not accessible by personal access token");
  });

  it("reports a missing or invisible repository", async () => {
    mockGitHubFetch();
    const error = await caught(fetchRepositorySnapshot("octocat", "does-not-exist"));
    expect(error.kind).toBe("not_found");
  });

  it("retries server errors, then succeeds", async () => {
    const { fetch } = mockGitHubFetch({
      "/user/repos": (call) => (call < 3 ? new Response("", { status: 502 }) : Response.json([])),
    });
    await expect(fetchAccessibleRepositories()).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("gives up after three server errors", async () => {
    const { fetch } = mockGitHubFetch({
      "/user/repos": () => new Response("", { status: 503 }),
    });
    expect((await caught(fetchAccessibleRepositories())).kind).toBe("unavailable");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retries network failures", async () => {
    mockGitHubFetch({
      "/user/repos": () => Promise.reject(new TypeError("fetch failed")),
    });
    const error = await caught(fetchAccessibleRepositories());
    expect(error.kind).toBe("unavailable");
    expect(error.message).toMatch(/could not be reached/);
  });

  it("rejects a response that doesn't match the schema", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGitHubFetch({ "/user/repos": () => Response.json([{ id: "not-a-number" }]) });
    expect((await caught(fetchAccessibleRepositories())).kind).toBe("invalid_response");
  });
});

describe("fetchConnection", () => {
  it("returns the account, rate limit and token expiry", async () => {
    mockGitHubFetch({
      "/user": () =>
        Response.json(
          { login: "octocat", name: "The Octocat", html_url: "https://github.com/octocat" },
          { headers: { "github-authentication-token-expiration": "2026-12-31 00:00:00 UTC" } },
        ),
    });
    const connection = await fetchConnection();
    expect(connection.viewer.login).toBe("octocat");
    expect(connection.rateLimit).toMatchObject({ limit: 5000, remaining: 4932 });
    expect(connection.tokenExpiresAt).toEqual(new Date("2026-12-31T00:00:00Z"));
  });
});
