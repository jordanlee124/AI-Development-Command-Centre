import { z } from "zod";

// GitHub REST responses, validated at the boundary (CLAUDE.md rule 8) and normalised into the
// shapes ADCC stores. Only the fields ADCC uses are declared; Zod drops the rest.

const date = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
// Links ADCC renders; https only, so a bad API response can't inject another scheme.
const url = z.url({ protocol: /^https$/ });
/** Clipped to its varchar column: git puts no limit on e.g. author names. */
const text = (max: number) => z.string().transform((value) => value.slice(0, max));
const user = z.object({ login: text(100) }).nullable();

/** Most open PRs a sync reads; a count at this cap is shown as "N+". */
export const OPEN_PULLS_LIMIT = 100;

export const viewerSchema = z
  .object({ login: z.string(), name: z.string().nullable(), html_url: url })
  .transform((u) => ({ login: u.login, name: u.name, url: u.html_url }));

export const rateLimitSchema = z
  .object({
    resources: z.object({
      core: z.object({ limit: z.number(), remaining: z.number(), reset: z.number() }),
    }),
  })
  .transform(({ resources: { core } }) => ({
    limit: core.limit,
    remaining: core.remaining,
    resetAt: new Date(core.reset * 1000),
  }));

export const repositorySchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    owner: z.object({ login: z.string() }),
    private: z.boolean(),
    html_url: url,
    description: z.string().nullable(),
    default_branch: z.string(),
    archived: z.boolean(),
    pushed_at: date.nullable(),
    has_issues: z.boolean(),
  })
  .transform((r) => ({
    githubId: r.id,
    // Stored lowercase like Repository.owner/name; GitHub names are case-insensitive.
    owner: r.owner.login.toLowerCase(),
    name: r.name.toLowerCase(),
    fullName: `${r.owner.login}/${r.name}`,
    isPrivate: r.private,
    htmlUrl: r.html_url,
    description: r.description,
    defaultBranch: r.default_branch,
    archived: r.archived,
    pushedAt: r.pushed_at,
    hasIssues: r.has_issues,
  }));

export const branchSchema = z
  .object({ name: text(255), commit: z.object({ sha: z.string() }), protected: z.boolean() })
  .transform((b) => ({ name: b.name, headSha: b.commit.sha, protected: b.protected }));

export const commitSchema = z
  .object({
    sha: z.string(),
    html_url: url,
    commit: z.object({
      message: z.string(),
      author: z.object({ name: text(255), date }),
    }),
    author: user,
  })
  .transform((c) => ({
    sha: c.sha,
    message: c.commit.message.split("\n", 1)[0] ?? "",
    authorName: c.commit.author.name,
    authorLogin: c.author?.login ?? null,
    committedAt: c.commit.author.date,
    url: c.html_url,
  }));

export const pullRequestSchema = z
  .object({
    number: z.number().int(),
    title: z.string(),
    state: z.enum(["open", "closed"]),
    draft: z.boolean(),
    user,
    html_url: url,
    created_at: date,
    updated_at: date,
    closed_at: date.nullable(),
    merged_at: date.nullable(),
    head: z.object({ ref: text(255) }),
    base: z.object({ ref: text(255) }),
    requested_reviewers: z.array(z.object({ login: z.string() })),
    requested_teams: z.array(z.object({ slug: z.string() })),
  })
  .transform((p) => ({
    number: p.number,
    title: p.title,
    state: p.merged_at ? ("merged" as const) : p.state,
    draft: p.draft,
    authorLogin: p.user?.login ?? null,
    headRef: p.head.ref,
    baseRef: p.base.ref,
    url: p.html_url,
    openedAt: p.created_at,
    githubUpdatedAt: p.updated_at,
    closedAt: p.closed_at,
    mergedAt: p.merged_at,
    requestedReviewers: p.requested_reviewers.length + p.requested_teams.length,
  }));

export const reviewSchema = z
  // state is a string, not an enum: an unknown future state is ignored, not a sync failure.
  .object({ user, state: z.string(), submitted_at: date.nullable().optional() })
  .transform((r) => ({ login: r.user?.login ?? null, state: r.state }));

export const issueSchema = z
  .object({
    number: z.number().int(),
    title: z.string(),
    state: z.enum(["open", "closed"]),
    user,
    html_url: url,
    comments: z.number().int().nonnegative(),
    labels: z.array(z.union([z.object({ name: z.string() }), z.string()])),
    created_at: date,
    updated_at: date,
    closed_at: date.nullable(),
    // Present when the "issue" is really a pull request.
    pull_request: z.unknown().optional(),
  })
  .transform((i) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    authorLogin: i.user?.login ?? null,
    comments: i.comments,
    labels: i.labels.map((label) => (typeof label === "string" ? label : label.name)),
    url: i.html_url,
    openedAt: i.created_at,
    githubUpdatedAt: i.updated_at,
    closedAt: i.closed_at,
    isPullRequest: i.pull_request !== undefined,
  }));

export const workflowRunsSchema = z
  .object({
    workflow_runs: z.array(
      z.object({
        id: z.number().int(),
        name: text(255).nullable(),
        display_title: z.string(),
        head_branch: text(255).nullable(),
        head_sha: z.string(),
        event: text(100),
        status: text(30).nullable(),
        conclusion: text(30).nullable(),
        run_number: z.number().int(),
        html_url: url,
        created_at: date,
        updated_at: date,
      }),
    ),
  })
  .transform(({ workflow_runs }) =>
    workflow_runs.map((r) => ({
      githubId: r.id,
      name: r.name,
      title: r.display_title,
      branch: r.head_branch,
      headSha: r.head_sha,
      event: r.event,
      status: r.status ?? "unknown",
      conclusion: r.conclusion,
      runNumber: r.run_number,
      url: r.html_url,
      githubCreatedAt: r.created_at,
      githubUpdatedAt: r.updated_at,
    })),
  );

export type GitHubViewer = z.output<typeof viewerSchema>;
export type GitHubRateLimit = z.output<typeof rateLimitSchema>;
export type GitHubRepository = z.output<typeof repositorySchema>;
export type GitHubBranch = z.output<typeof branchSchema>;
export type GitHubCommit = z.output<typeof commitSchema>;
export type GitHubReview = z.output<typeof reviewSchema>;
export type GitHubIssue = Omit<z.output<typeof issueSchema>, "isPullRequest">;
export type GitHubWorkflowRun = z.output<typeof workflowRunsSchema>[number];
export type GitHubPullRequest = Omit<z.output<typeof pullRequestSchema>, "requestedReviewers"> &
  ReviewSummary;

/** Everything one sync reads for a repository. */
export interface RepositorySnapshot {
  repository: GitHubRepository;
  branches: GitHubBranch[];
  commits: GitHubCommit[];
  pullRequests: GitHubPullRequest[];
  issues: GitHubIssue[];
  workflowRuns: GitHubWorkflowRun[];
}

export type ReviewStatus = "changes_requested" | "approved" | "review_requested" | "no_reviews";

export interface ReviewSummary {
  reviewStatus: ReviewStatus | null;
  approvals: number | null;
  changesRequested: number | null;
  reviewsRequested: number | null;
}

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  changes_requested: "Changes requested",
  approved: "Approved",
  review_requested: "Review requested",
  no_reviews: "No reviews",
};

/**
 * Review state from the reviews GitHub returned (oldest first): each reviewer's latest
 * approval or change request counts; a dismissal cancels it, comments don't change it.
 * Branch-protection rules (required approvals, code owners) are not known here, so this is a
 * count of what reviewers said, not GitHub's merge verdict.
 */
export function summarizeReviews(reviews: GitHubReview[], requested: number): ReviewSummary {
  const latest = new Map<string, string>();
  for (const { login, state } of reviews) {
    if (!login) continue;
    if (state === "APPROVED" || state === "CHANGES_REQUESTED") latest.set(login, state);
    else if (state === "DISMISSED") latest.delete(login);
  }
  const verdicts = [...latest.values()];
  const approvals = verdicts.filter((state) => state === "APPROVED").length;
  const changesRequested = verdicts.length - approvals;
  const reviewStatus: ReviewStatus =
    changesRequested > 0
      ? "changes_requested"
      : approvals > 0
        ? "approved"
        : requested > 0
          ? "review_requested"
          : "no_reviews";
  return { reviewStatus, approvals, changesRequested, reviewsRequested: requested };
}

/** Closed PRs aren't asked for reviews, so their review state is unknown, not "none". */
export const UNKNOWN_REVIEWS: ReviewSummary = {
  reviewStatus: null,
  approvals: null,
  changesRequested: null,
  reviewsRequested: null,
};

const MAX_BACKOFF_STEPS = 5;

/**
 * When background sync should next try a repository: one interval after the last attempt,
 * doubled per consecutive failure (up to 32×), so a broken repo isn't hammered.
 */
export function nextSyncAt(
  repo: { lastSyncAttemptAt: Date | null; syncFailures: number },
  intervalMs: number,
): Date {
  if (!repo.lastSyncAttemptAt) return new Date(0);
  const factor = 2 ** Math.min(repo.syncFailures, MAX_BACKOFF_STEPS);
  return new Date(repo.lastSyncAttemptAt.getTime() + intervalMs * factor);
}

export interface GitHubActivity {
  type: string;
  occurredAt: Date;
  title: string;
  dedupeKey: string;
  metadata: { url: string };
}

// ActivityEvent.title is varchar(500); a commit headline has no length limit.
const clip = (text: string) => (text.length > 500 ? `${text.slice(0, 499)}…` : text);

/**
 * Timeline entries for what a snapshot shows happened, each with the real time it happened.
 * dedupeKeys make re-syncing the same data add nothing.
 */
export function snapshotActivity(snapshot: RepositorySnapshot): GitHubActivity[] {
  const { repository, commits, pullRequests, issues, workflowRuns } = snapshot;
  // Keyed by GitHub's repo id, not its name, so a rename or transfer doesn't repeat events.
  const key = (...parts: (string | number)[]) => `github:${repository.githubId}:${parts.join(":")}`;
  const events: GitHubActivity[] = [];
  const add = (type: string, occurredAt: Date, title: string, dedupeKey: string, url: string) =>
    events.push({ type, occurredAt, title: clip(title), dedupeKey, metadata: { url } });

  for (const c of commits) {
    add(
      "github.commit",
      c.committedAt,
      `Commit ${c.sha.slice(0, 7)}: ${c.message}`,
      key("commit", c.sha),
      c.url,
    );
  }
  for (const pr of pullRequests) {
    add(
      "github.pr.opened",
      pr.openedAt,
      `PR #${pr.number} opened: ${pr.title}`,
      key("pr", pr.number, "opened"),
      pr.url,
    );
    if (pr.mergedAt) {
      add(
        "github.pr.merged",
        pr.mergedAt,
        `PR #${pr.number} merged: ${pr.title}`,
        key("pr", pr.number, "merged"),
        pr.url,
      );
    } else if (pr.closedAt) {
      // Keyed by time: a PR can be closed, reopened and closed again.
      add(
        "github.pr.closed",
        pr.closedAt,
        `PR #${pr.number} closed: ${pr.title}`,
        key("pr", pr.number, "closed", pr.closedAt.toISOString()),
        pr.url,
      );
    }
  }
  for (const issue of issues) {
    add(
      "github.issue.opened",
      issue.openedAt,
      `Issue #${issue.number} opened: ${issue.title}`,
      key("issue", issue.number, "opened"),
      issue.url,
    );
    if (issue.closedAt) {
      add(
        "github.issue.closed",
        issue.closedAt,
        `Issue #${issue.number} closed: ${issue.title}`,
        key("issue", issue.number, "closed", issue.closedAt.toISOString()),
        issue.url,
      );
    }
  }
  for (const run of workflowRuns) {
    if (run.status !== "completed") continue;
    const name = run.name ?? run.title;
    const on = run.branch ? ` on ${run.branch}` : "";
    add(
      "github.run.completed",
      run.githubUpdatedAt,
      `${name} #${run.runNumber} ${run.conclusion ?? "completed"}${on}`,
      key("run", run.githubId),
      run.url,
    );
  }
  return events;
}
