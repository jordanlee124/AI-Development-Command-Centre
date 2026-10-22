import type { Prisma } from "@/generated/prisma/client";
import type { ProjectStatus } from "@/domain/project";
import type { StatusCounts } from "@/domain/task";
import { recordActivity, type NewActivity } from "./activity";
import { getPrisma } from "./client";

export function countProjects() {
  return getPrisma().project.count({ where: { archivedAt: null } });
}

export function listProjects(take?: number) {
  return getPrisma().project.findMany({
    where: { archivedAt: null },
    orderBy: { updatedAt: "desc" },
    take,
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      updatedAt: true,
      _count: { select: { repositories: true } },
    },
  });
}

export interface ProjectFilter {
  q?: string;
  status?: ProjectStatus;
  archived: boolean;
}

export async function findProjects(filter: ProjectFilter, skip: number, take: number) {
  const where: Prisma.ProjectWhereInput = {
    archivedAt: filter.archived ? { not: null } : null,
    status: filter.status,
    ...(filter.q && {
      OR: [
        { name: { contains: filter.q, mode: "insensitive" } },
        { slug: { contains: filter.q, mode: "insensitive" } },
        { description: { contains: filter.q, mode: "insensitive" } },
      ],
    }),
  };
  const [rows, total] = await Promise.all([
    getPrisma().project.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        archivedAt: true,
        updatedAt: true,
        _count: { select: { repositories: true } },
      },
    }),
    getPrisma().project.count({ where }),
  ]);
  return { rows, total };
}

/** Non-archived projects, for pickers. */
export function listProjectOptions() {
  return getPrisma().project.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export function getProject(id: string) {
  return getPrisma().project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      status: true,
      localPath: true,
      archivedAt: true,
      createdAt: true,
      updatedAt: true,
      repositories: {
        orderBy: [{ owner: "asc" }, { name: "asc" }],
        select: { id: true, owner: true, name: true, lastSyncedAt: true },
      },
      _count: { select: { tasks: true, milestones: true } },
    },
  });
}

export async function slugsStartingWith(base: string): Promise<Set<string>> {
  const rows = await getPrisma().project.findMany({
    where: { slug: { startsWith: base } },
    select: { slug: true },
  });
  return new Set(rows.map((row) => row.slug));
}

/** Windows paths ignore case, so "D:\App" and "d:\app" are the same folder. */
export function findProjectByLocalPath(localPath: string) {
  return getPrisma().project.findFirst({
    where: { localPath: { equals: localPath, mode: "insensitive" } },
    select: { id: true, name: true },
  });
}

/** Task counts per status for each project id (all projects when ids is omitted). */
export async function taskCountsByProject(ids?: string[]): Promise<Map<string, StatusCounts>> {
  const rows = await getPrisma().task.groupBy({
    by: ["projectId", "status"],
    where: ids && { projectId: { in: ids } },
    _count: { _all: true },
  });
  const byProject = new Map<string, StatusCounts>();
  for (const row of rows) {
    const counts = byProject.get(row.projectId) ?? {};
    counts[row.status] = row._count._all;
    byProject.set(row.projectId, counts);
  }
  return byProject;
}

export function searchProjects(query: string, take: number) {
  return getPrisma().project.findMany({
    where: {
      archivedAt: null,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { slug: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, name: true, slug: true },
  });
}

export interface ProjectData {
  name: string;
  description: string | null;
  status: ProjectStatus;
  localPath: string | null;
}

export function insertProject(
  data: ProjectData & { slug: string },
  activity: (id: string) => NewActivity,
) {
  return getPrisma().$transaction(async (tx) => {
    const project = await tx.project.create({ data, select: { id: true } });
    await recordActivity(tx, activity(project.id));
    return project;
  });
}

export function updateProjectRow(
  id: string,
  data: Partial<ProjectData> & { archivedAt?: Date | null },
  activity: NewActivity,
) {
  return getPrisma().$transaction(async (tx) => {
    await tx.project.update({ where: { id }, data, select: { id: true } });
    await recordActivity(tx, activity);
  });
}

/**
 * Deletes a project and everything that belongs to it, in one transaction. Comments and
 * dependencies go with their tasks (cascade); repositories and timeline entries are kept
 * and unlinked (set null).
 */
export function deleteProjectWithContents(id: string, activity: NewActivity) {
  return getPrisma().$transaction(async (tx) => {
    await tx.task.deleteMany({ where: { projectId: id } });
    await tx.milestone.deleteMany({ where: { projectId: id } });
    await tx.project.delete({ where: { id }, select: { id: true } });
    await recordActivity(tx, activity);
  });
}
