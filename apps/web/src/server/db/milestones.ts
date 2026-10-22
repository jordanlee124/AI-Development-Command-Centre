import type { MilestoneStatus } from "@/domain/milestone";
import type { StatusCounts } from "@/domain/task";
import { recordActivity, type NewActivity } from "./activity";
import { getPrisma } from "./client";

export function listProjectMilestones(projectId: string) {
  return getPrisma().milestone.findMany({
    where: { projectId },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      dueDate: true,
      completedAt: true,
    },
  });
}

/** Task counts per status for each milestone of a project. */
export async function milestoneTaskCounts(projectId: string): Promise<Map<string, StatusCounts>> {
  const rows = await getPrisma().task.groupBy({
    by: ["milestoneId", "status"],
    where: { projectId, milestoneId: { not: null } },
    _count: { _all: true },
  });
  const byMilestone = new Map<string, StatusCounts>();
  for (const row of rows) {
    if (!row.milestoneId) continue;
    const counts = byMilestone.get(row.milestoneId) ?? {};
    counts[row.status] = row._count._all;
    byMilestone.set(row.milestoneId, counts);
  }
  return byMilestone;
}

export function getMilestoneForChange(id: string) {
  return getPrisma().milestone.findUnique({
    where: { id },
    select: {
      id: true,
      projectId: true,
      title: true,
      description: true,
      status: true,
      dueDate: true,
      completedAt: true,
      project: { select: { archivedAt: true } },
    },
  });
}

/** Milestones by id, for checking a task's milestone belongs to the task's project. */
export function findMilestone(id: string) {
  return getPrisma().milestone.findUnique({
    where: { id },
    select: { id: true, projectId: true, title: true },
  });
}

export function findMilestoneByTitle(projectId: string, title: string) {
  return getPrisma().milestone.findUnique({
    where: { projectId_title: { projectId, title } },
    select: { id: true },
  });
}

export interface MilestoneData {
  title: string;
  description: string | null;
  status: MilestoneStatus;
  dueDate: Date | null;
  completedAt: Date | null;
}

export function insertMilestone(
  data: MilestoneData & { projectId: string },
  activity: NewActivity,
) {
  return getPrisma().$transaction(async (tx) => {
    const milestone = await tx.milestone.create({ data, select: { id: true } });
    await recordActivity(tx, activity);
    return milestone;
  });
}

export function updateMilestoneRow(id: string, data: MilestoneData, activity: NewActivity) {
  return getPrisma().$transaction(async (tx) => {
    await tx.milestone.update({ where: { id }, data, select: { id: true } });
    await recordActivity(tx, activity);
  });
}
