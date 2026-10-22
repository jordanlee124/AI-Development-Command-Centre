import { recordActivity, type NewActivity } from "./activity";
import { getPrisma } from "./client";

export function findRepository(where: { id: string } | { owner: string; name: string }) {
  return getPrisma().repository.findUnique({
    where: "id" in where ? { id: where.id } : { owner_name: where },
    select: {
      id: true,
      owner: true,
      name: true,
      projectId: true,
      project: { select: { name: true, archivedAt: true } },
    },
  });
}

/** Links owner/name to a project, creating the (not yet synced) repository row if needed. */
export function linkRepositoryRow(
  projectId: string,
  repo: { owner: string; name: string },
  activity: (repositoryId: string) => NewActivity,
) {
  return getPrisma().$transaction(async (tx) => {
    const row = await tx.repository.upsert({
      where: { owner_name: repo },
      create: { ...repo, projectId },
      update: { projectId },
      select: { id: true },
    });
    await recordActivity(tx, activity(row.id));
  });
}

export function unlinkRepositoryRow(id: string, activity: NewActivity) {
  return getPrisma().$transaction(async (tx) => {
    await tx.repository.update({ where: { id }, data: { projectId: null }, select: { id: true } });
    await recordActivity(tx, activity);
  });
}

export async function repositorySummary() {
  const prisma = getPrisma();
  const [total, linked, sync] = await Promise.all([
    prisma.repository.count(),
    prisma.repository.count({ where: { projectId: { not: null } } }),
    prisma.repository.aggregate({ _max: { lastSyncedAt: true } }),
  ]);
  return { total, linked, lastSyncedAt: sync._max.lastSyncedAt };
}

export function listRepositories() {
  return getPrisma().repository.findMany({
    orderBy: [{ owner: "asc" }, { name: "asc" }],
    select: {
      id: true,
      owner: true,
      name: true,
      defaultBranch: true,
      lastSyncedAt: true,
      lastSyncError: true,
      project: { select: { id: true, name: true } },
      _count: { select: { pullRequests: { where: { state: "open" } } } },
      workflowRuns: {
        orderBy: { githubCreatedAt: "desc" },
        take: 1,
        select: { name: true, title: true, status: true, conclusion: true, url: true },
      },
    },
  });
}
