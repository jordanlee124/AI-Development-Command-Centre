import { DomainError } from "@/domain/errors";
import {
  assertStatusAllowed,
  commentSchema,
  createsCycle,
  describeTaskChanges,
  isBlocked,
  nextCompletedAt,
  TASK_STATUS_LABELS,
  taskCreateSchema,
  taskMoveSchema,
  taskUpdateSchema,
  type TaskSnapshot,
} from "@/domain/task";
import { idSchema, PAGE_SIZE, pageCount } from "@/domain/validation";
import { findMilestone, listProjectMilestones } from "@/server/db/milestones";
import { getProject, listProjectOptions } from "@/server/db/projects";
import {
  findTasks,
  findTasksByIds,
  getTaskDetail,
  getTaskForChange,
  insertComment,
  insertTask,
  listDependencyEdges,
  listTaskHistory,
  listTaskOptions,
  taskCountsByStatus,
  updateTaskRow,
  type TaskFilter,
  type TaskForChange,
} from "@/server/db/tasks";

const archived = () =>
  new DomainError("FORBIDDEN", "This project is archived. Unarchive it to make changes.");

export async function listTasksPage(filter: TaskFilter, page: number) {
  const [{ rows, total }, counts, projects] = await Promise.all([
    findTasks(filter, (page - 1) * PAGE_SIZE, PAGE_SIZE),
    taskCountsByStatus(filter),
    listProjectOptions(),
  ]);
  return {
    tasks: rows.map(({ dependencies, ...task }) => ({
      ...task,
      blocked: isBlocked(
        task.status,
        dependencies.map((d) => d.dependsOn),
      ),
    })),
    counts,
    total,
    pageCount: pageCount(total),
    projects,
  };
}

/** Everything the task page shows, or null when there is no such task. */
export async function getTaskPage(id: string) {
  if (!idSchema.safeParse(id).success) return null;
  const task = await getTaskDetail(id);
  if (!task) return null;
  const [history, milestones, taskOptions] = await Promise.all([
    listTaskHistory(id),
    listProjectMilestones(task.project.id),
    listTaskOptions(task.project.id),
  ]);
  const dependencies = task.dependencies.map((d) => d.dependsOn);
  return {
    task: { ...task, blocked: isBlocked(task.status, dependencies) },
    history,
    milestones,
    taskOptions: taskOptions.filter((option) => option.id !== id),
  };
}

export type TaskPage = NonNullable<Awaited<ReturnType<typeof getTaskPage>>>;

async function requireEditableTask(id: string): Promise<TaskForChange> {
  const task = await getTaskForChange(id);
  if (!task) throw new DomainError("NOT_FOUND", "That task no longer exists.");
  if (task.project.archivedAt) throw archived();
  return task;
}

/** The milestone's title, after checking it is in the task's project (ADR-008). */
async function resolveMilestone(projectId: string, milestoneId: string | null) {
  if (!milestoneId) return null;
  const milestone = await findMilestone(milestoneId);
  if (!milestone)
    throw new DomainError("NOT_FOUND", "That milestone no longer exists.", "milestoneId");
  if (milestone.projectId !== projectId) {
    throw new DomainError(
      "FORBIDDEN",
      "The milestone must be in the task's project.",
      "milestoneId",
    );
  }
  return milestone.title;
}

/** Same project, not itself, no cycle (ADR-012). Returns the dependencies' titles and statuses. */
// shortcut: checked before the write transaction, so two tabs saving A→B and B→A at the same
// instant could both pass; single local user, so acceptable. Move into the transaction (or lock
// the project row) if ADCC ever gets concurrent writers.
async function resolveDependencies(projectId: string, taskId: string | null, ids: string[]) {
  if (ids.length === 0) return [];
  if (taskId && ids.includes(taskId)) {
    throw new DomainError("FORBIDDEN", "A task can't depend on itself.", "dependsOnIds");
  }
  const found = await findTasksByIds(ids);
  if (found.length !== ids.length || found.some((task) => task.projectId !== projectId)) {
    throw new DomainError(
      "FORBIDDEN",
      "Dependencies must be existing tasks in the same project.",
      "dependsOnIds",
    );
  }
  if (taskId && createsCycle(taskId, ids, await listDependencyEdges(projectId))) {
    throw new DomainError(
      "FORBIDDEN",
      "That would make a circular dependency: a task would end up waiting on itself.",
      "dependsOnIds",
    );
  }
  return found;
}

export async function createTask(input: unknown, now = new Date()) {
  const { projectId, dependsOnIds, ...fields } = taskCreateSchema.parse(input);
  const project = await getProject(projectId);
  if (!project) throw new DomainError("NOT_FOUND", "That project no longer exists.", "projectId");
  if (project.archivedAt) throw archived();
  await resolveMilestone(projectId, fields.milestoneId);
  assertStatusAllowed(fields.status, await resolveDependencies(projectId, null, dependsOnIds));
  return insertTask(
    {
      ...fields,
      projectId,
      completedAt: nextCompletedAt(false, fields.status === "DONE", null, now),
    },
    dependsOnIds,
    (taskId) => ({
      type: "task.created",
      title: `Created task ${fields.title}`,
      projectId,
      taskId,
    }),
  );
}

function snapshotOf(task: TaskForChange): TaskSnapshot {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    milestone: task.milestone?.title ?? null,
    assignedAgent: task.assignedAgent,
    dependsOn: task.dependencies.map((d) => d.dependsOn),
  };
}

export async function updateTask(input: unknown, now = new Date()) {
  const { id, dependsOnIds, ...fields } = taskUpdateSchema.parse(input);
  const task = await requireEditableTask(id);
  const milestone = await resolveMilestone(task.projectId, fields.milestoneId);
  const dependencies = await resolveDependencies(task.projectId, id, dependsOnIds);
  const currentIds = task.dependencies.map((d) => d.dependsOn.id);
  const sameDependencies =
    currentIds.length === dependsOnIds.length && dependsOnIds.every((d) => currentIds.includes(d));
  // Only a status or dependency change is checked: if a dependency was reopened later, the task
  // stays editable (it shows as blocked) rather than locking every other field.
  if (fields.status !== task.status || !sameDependencies) {
    assertStatusAllowed(fields.status, dependencies);
  }

  const changes = describeTaskChanges(snapshotOf(task), {
    ...fields,
    milestone,
    dependsOn: dependencies,
  });
  if (changes.length === 0) return;

  const statusOnly = changes.length === 1 && task.status !== fields.status;
  await updateTaskRow(
    id,
    {
      ...fields,
      completedAt: nextCompletedAt(
        task.status === "DONE",
        fields.status === "DONE",
        task.completedAt,
        now,
      ),
    },
    sameDependencies ? undefined : dependsOnIds,
    {
      type: statusOnly ? "task.status_changed" : "task.updated",
      title: statusOnly
        ? `Moved ${fields.title} to ${TASK_STATUS_LABELS[fields.status]}`
        : `Updated task ${fields.title}`,
      description: changes.join("; "),
      metadata: { changes },
      projectId: task.projectId,
      taskId: id,
    },
  );
}

/** Status-only change, used by the board. */
export async function moveTask(input: unknown, now = new Date()) {
  const { id, status } = taskMoveSchema.parse(input);
  const task = await requireEditableTask(id);
  if (task.status === status) return;
  assertStatusAllowed(
    status,
    task.dependencies.map((d) => d.dependsOn),
  );
  const change = `Status: ${TASK_STATUS_LABELS[task.status]} → ${TASK_STATUS_LABELS[status]}`;
  await updateTaskRow(
    id,
    {
      status,
      completedAt: nextCompletedAt(
        task.status === "DONE",
        status === "DONE",
        task.completedAt,
        now,
      ),
    },
    undefined,
    {
      type: "task.status_changed",
      title: `Moved ${task.title} to ${TASK_STATUS_LABELS[status]}`,
      description: change,
      metadata: { changes: [change] },
      projectId: task.projectId,
      taskId: id,
    },
  );
}

export async function addComment(input: unknown) {
  const { taskId, body } = commentSchema.parse(input);
  const task = await requireEditableTask(taskId);
  await insertComment(taskId, body, {
    type: "task.commented",
    title: `Commented on ${task.title}`,
    projectId: task.projectId,
    taskId,
  });
}
