import { z } from "zod";
import {
  branchSchema,
  commitSchema,
  issueSchema,
  OPEN_PULLS_LIMIT,
  pullRequestSchema,
  rateLimitSchema,
  repositorySchema,
  reviewSchema,
  summarizeReviews,
  UNKNOWN_REVIEWS,
  viewerSchema,
  workflowRunsSchema,
  type RepositorySnapshot,
} from "@/domain/github";
import { DomainError } from "@/domain/errors";
import { getEnv } from "@/server/env";

// GitHub adapter (ADR-015). Read-only by construction: the only request it can make is a GET.
// The token is sent in a header to GITHUB_API_URL and nowhere else, and never appears in an
// error message or log line.

export type GitHubErrorKind =
  | "not_configured"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "invalid_response";

/** A GitHub call failed. The message is written for the user and safe to show. */
export class GitHubError extends DomainError {
  constructor(
    readonly kind: GitHubErrorKind,
    message: string,
    /** For rate_limited: when GitHub will accept requests again. */
    readonly retryAt?: Date,
  ) {
    super("UNAVAILABLE", message);
    this.name = "GitHubError";
  }
}

const API_VERSION = "2022-11-28";
const TIMEOUT_MS = 10_000;
const ATTEMPTS = 3;
// shortcut: one page per list (GitHub's newest first), no Link-header paging; page through
// when a view needs more than these.
const PAGE = {
  repos: 100,
  branches: 100,
  commits: 30,
  openPulls: OPEN_PULLS_LIMIT,
  closedPulls: 20,
  issues: 30,
  runs: 20,
};
const MAX_REVIEWED_PRS = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Backoff between retries; tests set it to 0. */
export const retry = { baseDelayMs: 500 };

async function send(path: string): Promise<Response> {
  const { GITHUB_TOKEN, GITHUB_API_URL } = getEnv();
  if (!GITHUB_TOKEN) {
    throw new GitHubError("not_configured", "GitHub is not connected: GITHUB_TOKEN is not set.");
  }
  const url = `${GITHUB_API_URL.replace(/\/$/, "")}${path}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          "X-GitHub-Api-Version": API_VERSION,
          "User-Agent": "adcc-local",
        },
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status < 500 || attempt === ATTEMPTS) return response;
    } catch (error) {
      if (attempt === ATTEMPTS) {
        const reason = error instanceof Error ? error.name : "network error";
        throw new GitHubError(
          "unavailable",
          `GitHub could not be reached for GET ${path} (${reason}).`,
        );
      }
    }
    await sleep(retry.baseDelayMs * 2 ** (attempt - 1));
  }
}

async function failure(path: string, response: Response): Promise<GitHubError> {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  const detail = typeof body?.message === "string" ? `: ${body.message.replace(/\.$/, "")}` : "";
  const status = response.status;
  const remaining = response.headers.get("x-ratelimit-remaining");
  const retryAfter = Number(response.headers.get("retry-after"));

  // Primary limits say remaining=0; secondary ones may send retry-after, or only a 429 or a
  // 403 whose message mentions the rate limit.
  const limited =
    status === 429 ||
    (status === 403 && (remaining === "0" || retryAfter > 0 || /rate limit/i.test(detail)));
  if (limited) {
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
    const retryAt =
      retryAfter > 0
        ? new Date(Date.now() + retryAfter * 1000)
        : reset > Date.now()
          ? new Date(reset)
          : // GitHub: with no usable header, wait at least a minute.
            new Date(Date.now() + 60_000);
    return new GitHubError(
      "rate_limited",
      `GitHub rate limit reached; requests resume after ${retryAt.toISOString()}.`,
      retryAt,
    );
  }
  if (status === 401) {
    return new GitHubError(
      "unauthorized",
      "GitHub rejected the token (401). It may be revoked or expired: create a new fine-grained token and update GITHUB_TOKEN.",
    );
  }
  if (status === 403) {
    return new GitHubError(
      "forbidden",
      `GitHub refused GET ${path} (403)${detail}. The token may lack a read permission this needs.`,
    );
  }
  if (status === 404) {
    return new GitHubError(
      "not_found",
      `GET ${path} returned 404: it doesn't exist or the token can't see it.`,
    );
  }
  return new GitHubError("unavailable", `GitHub returned ${status} for GET ${path}${detail}.`);
}

async function get<S extends z.ZodType>(path: string, schema: S) {
  const response = await send(path);
  if (!response.ok) throw await failure(path, response);
  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    console.error(`[github] unexpected response for GET ${path}`, z.prettifyError(parsed.error));
    throw new GitHubError(
      "invalid_response",
      `GitHub sent an unexpected response for GET ${path}.`,
    );
  }
  return { data: parsed.data as z.output<S>, headers: response.headers };
}

/** Who the token belongs to, how much rate limit is left, and when the token expires. */
export async function fetchConnection() {
  const user = await get("/user", viewerSchema);
  // /rate_limit itself doesn't count against the limit.
  const rateLimit = await get("/rate_limit", rateLimitSchema);
  // e.g. "2026-12-31 00:00:00 UTC"; absent for tokens without an expiry.
  const expiry = new Date(user.headers.get("github-authentication-token-expiration") ?? NaN);
  return {
    viewer: user.data,
    rateLimit: rateLimit.data,
    tokenExpiresAt: Number.isNaN(expiry.getTime()) ? null : expiry,
  };
}

/** Repositories the token can read, most recently pushed first. */
export async function fetchAccessibleRepositories() {
  const { data } = await get(
    `/user/repos?per_page=${PAGE.repos}&sort=pushed`,
    z.array(repositorySchema),
  );
  return data;
}

/**
 * Reads everything ADCC shows for one repository. Requests run one after another, as GitHub
 * asks of integrations, to stay clear of its secondary rate limits.
 */
export async function fetchRepositorySnapshot(
  owner: string,
  name: string,
): Promise<RepositorySnapshot> {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const { data: repository } = await get(base, repositorySchema);
  const branches = await get(`${base}/branches?per_page=${PAGE.branches}`, z.array(branchSchema));
  // An empty repository has no branches, and GitHub answers its commits with 409.
  const commits =
    branches.data.length === 0
      ? { data: [] }
      : await get(
          `${base}/commits?sha=${encodeURIComponent(repository.defaultBranch)}&per_page=${PAGE.commits}`,
          z.array(commitSchema),
        );
  // Open PRs separately, so the open count isn't limited to the most recently updated page.
  // Filtering by state again keeps a mock that ignores the query honest.
  const open = await get(
    `${base}/pulls?state=open&sort=updated&direction=desc&per_page=${PAGE.openPulls}`,
    z.array(pullRequestSchema),
  );
  const closed = await get(
    `${base}/pulls?state=closed&sort=updated&direction=desc&per_page=${PAGE.closedPulls}`,
    z.array(pullRequestSchema),
  );
  const pulls = [
    ...open.data.filter((pr) => pr.state === "open"),
    ...closed.data.filter((pr) => pr.state !== "open"),
  ];
  // GitHub answers the issues of a repository with issues turned off with 410.
  const issues = repository.hasIssues
    ? await get(
        `${base}/issues?state=all&sort=updated&direction=desc&per_page=${PAGE.issues}`,
        z.array(issueSchema),
      )
    : { data: [] };
  const runs = await get(`${base}/actions/runs?per_page=${PAGE.runs}`, workflowRunsSchema);

  const pullRequests = [];
  let reviewed = 0;
  for (const { requestedReviewers, ...pr } of pulls) {
    if (pr.state !== "open" || reviewed >= MAX_REVIEWED_PRS) {
      pullRequests.push({ ...pr, ...UNKNOWN_REVIEWS });
      continue;
    }
    reviewed++;
    const reviews = await get(
      `${base}/pulls/${pr.number}/reviews?per_page=100`,
      z.array(reviewSchema),
    );
    pullRequests.push({ ...pr, ...summarizeReviews(reviews.data, requestedReviewers) });
  }

  return {
    repository,
    branches: branches.data,
    commits: commits.data,
    pullRequests,
    issues: issues.data.flatMap(({ isPullRequest, ...issue }) => (isPullRequest ? [] : [issue])),
    workflowRuns: runs.data,
  };
}
