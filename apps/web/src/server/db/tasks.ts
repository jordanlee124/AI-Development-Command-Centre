import type { Prisma } from "@/generated/prisma/client";
import type { AgentSource } from "@/domain/agent";
import {
  BOARD_STATUSES,
  type StatusCounts,
  type TaskPriority,
  type TaskStatus,
} from "@/domain/task";
import { recordActivity, type NewActivity } from "./activity";
import { getPrisma } from "./client";

export interface TaskFilter {
  status?: TaskStatus;
  priority?: TaskPriority;
  projectId?: string;
  assignedAgent?: AgentSource;
  q?: string;
}

function taskWhere(filter: TaskFilter): Prisma.TaskWhereInput {
  return {
    project: { archivedAt: null },
    status: filter.status,
    priority: filter.priority,
    projectId: filter.projectId,
    assignedAgent: filter.assignedAgent,
    ...(filter.q && { title: { contains: filter.q, mode: "insensitive" } }),
  };
}

/** Status counts for tasks matching every filter except status (for the status tabs). */
export async function taskCountsByStatus(filter: TaskFilter = {}) {
  const rows = await getPrisma().task.groupBy({
    by: ["status"],
    where: taskWhere({ ...filter, status: undefined }),
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all])) as StatusCounts;
}

const dependencyStatuses = {
  select: { dependsOn: { select: { status: true } } },
} satisfies Prisma.Task$dependenciesArgs;

export async function findTasks(filter: TaskFilter, skip: number, take: number) {
  const where = taskWhere(filter);
  const [rows, total] = await Promise.all([
    getPrisma().task.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip,
      take,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        assignedAgent: true,
        updatedAt: true,
        project: { select: { id: true, name: true } },
        milestone: { select: { title: true } },
        dependencies: dependencyStatuses,
      },
    }),
    getPrisma().task.count({ where }),
  ]);
  return { rows, total };
}

// shortcut: loads every board task of one project; page per column if a project passes ~1000.
export function listBoardTasks(projectId: string) {
  return getPrisma().task.findMany({
    where: { projectId, status: { in: [...BOARD_STATUSES] } },
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      assignedAgent: true,
      milestone: { select: { title: true } },
      dependencies: dependencyStatuses,
    },
  });
}

/** Id and title of every task in a project, for the dependency picker. */
export function listTaskOptions(projectId: string) {
  return getPrisma().task.findMany({
    where: { projectId },
    orderBy: { title: "asc" },
    select: { id: true, title: true, status: true },
  });
}

export function getTaskDetail(id: string) {
  return getPrisma().task.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      dueDate: true,
      assignedAgent: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
      project: { select: { id: true, name: true, archivedAt: true } },
      milestone: { select: { id: true, title: true } },
      dependencies: {
        orderBy: { createdAt: "asc" },
        select: { dependsOn: { select: { id: true, title: true, status: true } } },
      },
      dependents: {
        orderBy: { createdAt: "asc" },
        select: { task: { select: { id: true, title: true, status: true } } },
      },
      comments: {
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, createdAt: true },
      },
    },
  });
}

/** Everything a change needs to validate against and to describe in the history. */
export function getTaskForChange(id: string) {
  return getPrisma().task.findUnique({
    where: { id },
    select: {
      id: true,
      projectId: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      dueDate: true,
      milestoneId: true,
      assignedAgent: true,
      completedAt: true,
      project: { select: { archivedAt: true } },
      milestone: { select: { title: true } },
      dependencies: { select: { dependsOn: { select: { id: true, title: true, status: true } } } },
    },
  });
}

export type TaskForChange = NonNullable<Awaited<ReturnType<typeof getTaskForChange>>>;

export function findTasksByIds(ids: string[]) {
  return getPrisma().task.findMany({
    where: { id: { in: ids } },
    select: { id: true, projectId: true, title: true, status: true },
  });
}

export function listDependencyEdges(projectId: string) {
  return getPrisma().taskDependency.findMany({
    where: { task: { projectId } },
    select: { taskId: true, dependsOnId: true },
  });
}

export function listTaskHistory(taskId: string, take = 100) {
  return getPrisma().activityEvent.findMany({
    where: { taskId },
    orderBy: { occurredAt: "desc" },
    take,
    select: { id: true, type: true, title: true, description: true, occurredAt: true },
  });
}

export interface TaskData {
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  milestoneId: string | null;
  assignedAgent: AgentSource | null;
  completedAt: Date | null;
}

export function insertTask(
  data: TaskData & { projectId: string },
  dependsOnIds: string[],
  activity: (id: string) => NewActivity,
) {
  return getPrisma().$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        ...data,
        dependencies: { create: dependsOnIds.map((dependsOnId) => ({ dependsOnId })) },
      },
      select: { id: true },
    });
    await recordActivity(tx, activity(task.id));
    return task;
  });
}

/** Updates a task; when dependsOnIds is given it replaces the task's dependencies. */
export function updateTaskRow(
  id: string,
  data: Partial<TaskData>,
  dependsOnIds: string[] | undefined,
  activity: NewActivity,
) {
  return getPrisma().$transaction(async (tx) => {
    if (dependsOnIds) {
      await tx.taskDependency.deleteMany({ where: { taskId: id } });
      await tx.taskDependency.createMany({
        data: dependsOnIds.map((dependsOnId) => ({ taskId: id, dependsOnId })),
      });
    }
    await tx.task.update({ where: { id }, data, select: { id: true } });
    await recordActivity(tx, activity);
  });
}

export function insertComment(taskId: string, body: string, activity: NewActivity) {
  return getPrisma().$transaction(async (tx) => {
    await tx.taskComment.create({ data: { taskId, body }, select: { id: true } });
    await recordActivity(tx, activity);
  });
}

export function searchTasks(query: string, take: number) {
  return getPrisma().task.findMany({
    where: { project: { archivedAt: null }, title: { contains: query, mode: "insensitive" } },
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, title: true, status: true, project: { select: { name: true } } },
  });
}
