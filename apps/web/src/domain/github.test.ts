import { describe, expect, it } from "vitest";
import {
  nextSyncAt,
  pullRequestSchema,
  snapshotActivity,
  summarizeReviews,
  UNKNOWN_REVIEWS,
  type RepositorySnapshot,
} from "./github";

const review = (login: string | null, state: string) => ({ login, state });

describe("summarizeReviews", () => {
  it("counts each reviewer's latest verdict", () => {
    expect(
      summarizeReviews(
        [review("a", "CHANGES_REQUESTED"), review("a", "APPROVED"), review("b", "APPROVED")],
        0,
      ),
    ).toEqual({ reviewStatus: "approved", approvals: 2, changesRequested: 0, reviewsRequested: 0 });
  });

  it("lets one change request outweigh approvals", () => {
    expect(
      summarizeReviews([review("a", "APPROVED"), review("b", "CHANGES_REQUESTED")], 0),
    ).toMatchObject({ reviewStatus: "changes_requested", approvals: 1, changesRequested: 1 });
  });

  it("ignores comments and drops dismissed verdicts", () => {
    expect(
      summarizeReviews(
        [
          review("a", "APPROVED"),
          review("a", "COMMENTED"),
          review("b", "CHANGES_REQUESTED"),
          review("b", "DISMISSED"),
        ],
        0,
      ),
    ).toMatchObject({ reviewStatus: "approved", approvals: 1, changesRequested: 0 });
  });

  it("says review requested when reviewers are waiting and nobody has decided", () => {
    expect(summarizeReviews([review("a", "COMMENTED")], 2)).toMatchObject({
      reviewStatus: "review_requested",
      reviewsRequested: 2,
    });
    expect(summarizeReviews([], 0).reviewStatus).toBe("no_reviews");
  });

  it("skips reviews from deleted accounts and unknown states", () => {
    expect(
      summarizeReviews([review(null, "APPROVED"), review("a", "FUTURE_STATE")], 0),
    ).toMatchObject({ reviewStatus: "no_reviews", approvals: 0 });
  });
});

describe("pullRequestSchema", () => {
  it("reports a merged PR as merged, not closed", () => {
    const pr = pullRequestSchema.parse({
      number: 1,
      title: "t",
      state: "closed",
      draft: false,
      user: null,
      html_url: "https://github.com/o/r/pull/1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      closed_at: "2026-01-02T00:00:00Z",
      merged_at: "2026-01-02T00:00:00Z",
      head: { ref: "feature" },
      base: { ref: "main" },
      requested_reviewers: [{ login: "a" }],
      requested_teams: [{ slug: "core" }],
    });
    expect(pr).toMatchObject({ state: "merged", authorLogin: null, requestedReviewers: 2 });
  });
});

describe("nextSyncAt", () => {
  const at = new Date("2026-10-22T00:00:00Z");
  const interval = 15 * 60_000;

  it("is due at once for a never-synced repository", () => {
    expect(nextSyncAt({ lastSyncAttemptAt: null, syncFailures: 0 }, interval)).toEqual(new Date(0));
  });

  it("waits one interval after a success and doubles per failure, up to 32×", () => {
    const after = (syncFailures: number) =>
      (nextSyncAt({ lastSyncAttemptAt: at, syncFailures }, interval).getTime() - at.getTime()) /
      interval;
    expect([0, 1, 2, 5, 9].map(after)).toEqual([1, 2, 4, 32, 32]);
  });
});

describe("snapshotActivity", () => {
  const url = "https://github.com/octocat/hello-world";
  const snapshot: RepositorySnapshot = {
    repository: {
      githubId: 1,
      owner: "octocat",
      name: "hello-world",
      fullName: "octocat/Hello-World",
      isPrivate: false,
      htmlUrl: url,
      description: null,
      defaultBranch: "main",
      archived: false,
      pushedAt: null,
      hasIssues: true,
    },
    branches: [],
    commits: [
      {
        sha: "a".repeat(40),
        message: "x".repeat(600),
        authorName: "A",
        authorLogin: null,
        committedAt: new Date("2026-10-01T00:00:00Z"),
        url,
      },
    ],
    pullRequests: [
      {
        number: 7,
        title: "Add feature",
        state: "merged",
        draft: false,
        authorLogin: "a",
        headRef: "f",
        baseRef: "main",
        url,
        openedAt: new Date("2026-10-02T00:00:00Z"),
        githubUpdatedAt: new Date("2026-10-03T00:00:00Z"),
        closedAt: new Date("2026-10-03T00:00:00Z"),
        mergedAt: new Date("2026-10-03T00:00:00Z"),
        ...UNKNOWN_REVIEWS,
      },
    ],
    issues: [],
    workflowRuns: [
      {
        githubId: 99,
        name: "CI",
        title: "Add feature",
        branch: "main",
        headSha: "a",
        event: "push",
        status: "in_progress",
        conclusion: null,
        runNumber: 4,
        url,
        githubCreatedAt: new Date("2026-10-03T00:00:00Z"),
        githubUpdatedAt: new Date("2026-10-03T00:00:00Z"),
      },
    ],
  };

  it("records when things happened on GitHub, keyed so a re-sync adds nothing", () => {
    const events = snapshotActivity(snapshot);
    expect(events.map((e) => [e.type, e.dedupeKey])).toEqual([
      ["github.commit", `github:1:commit:${"a".repeat(40)}`],
      ["github.pr.opened", "github:1:pr:7:opened"],
      // Merged, so no separate "closed"; the unfinished run has no event yet.
      ["github.pr.merged", "github:1:pr:7:merged"],
    ]);
    expect(events[1]!.occurredAt).toEqual(new Date("2026-10-02T00:00:00Z"));
    expect(snapshotActivity(snapshot)).toEqual(events);
  });

  it("clips titles to the column size", () => {
    expect(snapshotActivity(snapshot)[0]!.title).toHaveLength(500);
  });

  it("adds a completed run with its conclusion", () => {
    const run = { ...snapshot.workflowRuns[0]!, status: "completed", conclusion: "failure" };
    const events = snapshotActivity({ ...snapshot, workflowRuns: [run] });
    expect(events.at(-1)).toMatchObject({
      type: "github.run.completed",
      title: "CI #4 failure on main",
      dedupeKey: "github:1:run:99",
    });
  });
});
