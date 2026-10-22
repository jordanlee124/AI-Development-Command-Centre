import type { GitHubActivity, RepositorySnapshot } from "@/domain/github";
import { getPrisma } from "./client";

/** Linked repositories of non-archived projects: what background sync keeps fresh. */
export function listSyncTargets() {
  return getPrisma().repository.findMany({
    where: { project: { archivedAt: null } },
    orderBy: [{ owner: "asc" }, { name: "asc" }],
    select: { id: true, owner: true, name: true, lastSyncAttemptAt: true, syncFailures: true },
  });
}

export function findSyncRepository(id: string) {
  return getPrisma().repository.findUnique({
    where: { id },
    select: {
      id: true,
      owner: true,
      name: true,
      projectId: true,
      project: { select: { archivedAt: true } },
    },
  });
}

/**
 * Replaces the repository's cached GitHub data with one sync's snapshot and adds its timeline
 * entries, in one transaction, so the pages never show half of one sync and half of another.
 */
export function saveSnapshot(
  repositoryId: string,
  projectId: string | null,
  snapshot: RepositorySnapshot,
  activity: GitHubActivity[],
  at: Date,
) {
  const { repository: repo } = snapshot;
  const own = <T>(rows: T[]) => rows.map((row) => ({ ...row, repositoryId }));
  const where = { repositoryId };
  return getPrisma().$transaction(async (tx) => {
    await tx.repository.update({
      where: { id: repositoryId },
      data: {
        // Follows a rename or transfer (GitHub redirects the old name to the new one).
        owner: repo.owner,
        name: repo.name,
        githubId: repo.githubId,
        defaultBranch: repo.defaultBranch,
        description: repo.description,
        htmlUrl: repo.htmlUrl,
        isPrivate: repo.isPrivate,
        lastSyncedAt: at,
        lastSyncAttemptAt: at,
        lastSyncError: null,
        syncFailures: 0,
      },
      select: { id: true },
    });
    await tx.gitHubBranch.deleteMany({ where });
    await tx.gitHubBranch.createMany({ data: own(snapshot.branches) });
    await tx.gitHubCommit.deleteMany({ where });
    await tx.gitHubCommit.createMany({ data: own(snapshot.commits) });
    await tx.gitHubPullRequest.deleteMany({ where });
    await tx.gitHubPullRequest.createMany({ data: own(snapshot.pullRequests) });
    await tx.gitHubIssue.deleteMany({ where });
    await tx.gitHubIssue.createMany({ data: own(snapshot.issues) });
    await tx.gitHubWorkflowRun.deleteMany({ where });
    await tx.gitHubWorkflowRun.createMany({
      data: own(snapshot.workflowRuns.map((run) => ({ ...run, githubId: BigInt(run.githubId) }))),
    });
    // Already-seen events keep their row (unique dedupeKey), so re-syncing adds nothing.
    await tx.activityEvent.createMany({
      data: activity.map((event) => ({ ...event, projectId, repositoryId })),
      skipDuplicates: true,
    });
  });
}

/**
 * Keeps the last good snapshot and records why this attempt failed. `countsAsFailure` is
 * false for failures that aren't this repository's (rate limit, rejected token).
 */
export function recordSyncFailure(
  repositoryId: string,
  error: string,
  at: Date,
  countsAsFailure: boolean,
) {
  return getPrisma().repository.update({
    where: { id: repositoryId },
    data: {
      lastSyncAttemptAt: at,
      lastSyncError: error,
      syncFailures: countsAsFailure ? { increment: 1 } : undefined,
    },
    select: { id: true },
  });
}

/**
 * Linked repositories matching these GitHub repos, by GitHub id once synced (survives a
 * rename) or by owner/name before that; for marking accessible repositories already linked.
 */
export function findLinkedRepositories(repos: { githubId: number; owner: string; name: string }[]) {
  return getPrisma().repository.findMany({
    where: {
      OR: [
        { githubId: { in: repos.map((repo) => BigInt(repo.githubId)) } },
        ...repos.map(({ owner, name }) => ({ owner, name })),
      ],
      projectId: { not: null },
    },
    select: {
      githubId: true,
      owner: true,
      name: true,
      project: { select: { id: true, name: true } },
    },
  });
}

export function getRepositoryWithSnapshot(id: string) {
  return getPrisma().repository.findUnique({
    where: { id },
    select: {
      id: true,
      owner: true,
      name: true,
      description: true,
      htmlUrl: true,
      isPrivate: true,
      defaultBranch: true,
      lastSyncedAt: true,
      lastSyncAttemptAt: true,
      lastSyncError: true,
      syncFailures: true,
      project: { select: { id: true, name: true, archivedAt: true } },
      branches: { orderBy: { name: "asc" } },
      commits: { orderBy: { committedAt: "desc" } },
      pullRequests: { orderBy: { githubUpdatedAt: "desc" } },
      issues: { orderBy: { githubUpdatedAt: "desc" } },
      workflowRuns: { orderBy: { githubCreatedAt: "desc" } },
    },
  });
}
