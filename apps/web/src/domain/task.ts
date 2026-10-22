import { z } from "zod";
import { AGENT_SOURCES, AGENT_SOURCE_LABELS, type AgentSource } from "./agent";
import { DomainError } from "./errors";
import { idSchema, optionalDate, optionalEnum, optionalId, optionalText } from "./validation";

// Mirrors the Prisma enums; the db layer passes these straight through, so any drift fails typecheck.
export const TASK_STATUSES = [
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "DONE",
  "CANCELLED",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  BACKLOG: "Backlog",
  TODO: "To do",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  DONE: "Completed",
  CANCELLED: "Cancelled",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

/** Kanban columns, in order. Cancelled tasks stay off the board. */
export const BOARD_STATUSES = [
  "BACKLOG",
  "TODO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "DONE",
] as const satisfies readonly TaskStatus[];

/** Work that is committed to and not finished. Backlog is not active. */
export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = ["TODO", "IN_PROGRESS", "IN_REVIEW"];

/** Work has started; a task can't be here while a dependency is unfinished. */
const STARTED_STATUSES: readonly TaskStatus[] = ["IN_PROGRESS", "IN_REVIEW", "DONE"];

export function isFinished(status: TaskStatus): boolean {
  return status === "DONE" || status === "CANCELLED";
}

export type StatusCounts = Partial<Record<TaskStatus, number>>;

export function countActive(counts: StatusCounts): number {
  return ACTIVE_TASK_STATUSES.reduce((sum, status) => sum + (counts[status] ?? 0), 0);
}

export function countTotal(counts: StatusCounts): number {
  return Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
}

/** Percent of non-cancelled tasks that are done, or null when there is nothing to complete. */
export function completionPercent(counts: StatusCounts): number | null {
  const relevant = countTotal(counts) - (counts.CANCELLED ?? 0);
  if (relevant <= 0) return null;
  return Math.round(((counts.DONE ?? 0) / relevant) * 100);
}

// total excludes cancelled tasks, matching completionPercent, so "done/total" agrees with the %.
export function taskProgress(counts: StatusCounts) {
  return {
    total: countTotal(counts) - (counts.CANCELLED ?? 0),
    done: counts.DONE ?? 0,
    percent: completionPercent(counts),
  };
}

interface Dependency {
  title: string;
  status: TaskStatus;
}

/** Waiting on at least one unfinished dependency. Finished tasks are never blocked. */
export function isBlocked(status: TaskStatus, dependencies: readonly { status: TaskStatus }[]) {
  return !isFinished(status) && dependencies.some((dep) => !isFinished(dep.status));
}

/** Throws unless a task with these dependencies may be in `status` (ADR-012). */
export function assertStatusAllowed(status: TaskStatus, dependencies: readonly Dependency[]) {
  if (!STARTED_STATUSES.includes(status)) return;
  const waiting = dependencies.filter((dep) => !isFinished(dep.status));
  if (waiting.length === 0) return;
  const names = waiting.map((dep) => `"${dep.title}"`).join(", ");
  throw new DomainError(
    "FORBIDDEN",
    `Can't move to ${TASK_STATUS_LABELS[status]} while waiting on ${names}. Finish or cancel ${waiting.length === 1 ? "it" : "them"} first.`,
    "status",
  );
}

/** Keeps the first completion time while something stays finished; clears it when reopened. */
export function nextCompletedAt(
  wasDone: boolean,
  isDone: boolean,
  previous: Date | null,
  now: Date,
): Date | null {
  if (!isDone) return null;
  return wasDone && previous ? previous : now;
}

interface Edge {
  taskId: string;
  dependsOnId: string;
}

/**
 * Would giving `taskId` exactly these dependencies create a cycle? `edges` are the project's
 * current dependencies; taskId's own are ignored, since they are being replaced.
 */
export function createsCycle(taskId: string, dependsOnIds: readonly string[], edges: Edge[]) {
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.taskId === taskId) continue;
    next.set(edge.taskId, [...(next.get(edge.taskId) ?? []), edge.dependsOnId]);
  }
  const seen = new Set<string>();
  const stack = [...dependsOnIds];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

const taskFields = {
  title: z.string().trim().min(1, "Title is required").max(300),
  description: optionalText(20_000),
  status: z.enum(TASK_STATUSES).default("TODO"),
  priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
  dueDate: optionalDate,
  milestoneId: optionalId,
  assignedAgent: optionalEnum(AGENT_SOURCES),
  dependsOnIds: z
    .array(idSchema)
    .max(50, "A task can depend on at most 50 others")
    .default([])
    .transform((ids) => [...new Set(ids)]),
};

export const taskCreateSchema = z.object({ projectId: idSchema, ...taskFields });
export const taskUpdateSchema = z.object({ id: idSchema, ...taskFields });
export const taskMoveSchema = z.object({ id: idSchema, status: z.enum(TASK_STATUSES) });
export const commentSchema = z.object({
  taskId: idSchema,
  body: z.string().trim().min(1, "Write a comment first").max(10_000),
});

/** What the history shows for a task, with ids already resolved to names. */
export interface TaskSnapshot {
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  milestone: string | null;
  assignedAgent: AgentSource | null;
  /** Compared by id (titles can repeat), shown by title. */
  dependsOn: { id: string; title: string }[];
}

const show = (value: string | null) => value ?? "none";
const showDate = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : "none");
const showAgent = (agent: AgentSource | null) => (agent ? AGENT_SOURCE_LABELS[agent] : "none");

/** Human-readable lines for each changed field, e.g. "Status: To do → Completed". */
export function describeTaskChanges(before: TaskSnapshot, after: TaskSnapshot): string[] {
  const lines: string[] = [];
  const diff = (label: string, from: string, to: string) => {
    if (from !== to) lines.push(`${label}: ${from} → ${to}`);
  };
  diff("Title", before.title, after.title);
  diff("Status", TASK_STATUS_LABELS[before.status], TASK_STATUS_LABELS[after.status]);
  diff("Priority", TASK_PRIORITY_LABELS[before.priority], TASK_PRIORITY_LABELS[after.priority]);
  diff("Due", showDate(before.dueDate), showDate(after.dueDate));
  diff("Milestone", show(before.milestone), show(after.milestone));
  diff("AI provider", showAgent(before.assignedAgent), showAgent(after.assignedAgent));
  if (before.description !== after.description) lines.push("Description edited");
  const ids = (deps: TaskSnapshot["dependsOn"]) => new Set(deps.map((d) => d.id));
  const [beforeIds, afterIds] = [ids(before.dependsOn), ids(after.dependsOn)];
  const added = after.dependsOn.filter((d) => !beforeIds.has(d.id)).map((d) => d.title);
  const removed = before.dependsOn.filter((d) => !afterIds.has(d.id)).map((d) => d.title);
  if (added.length) lines.push(`Depends on: added ${added.join(", ")}`);
  if (removed.length) lines.push(`Depends on: removed ${removed.join(", ")}`);
  return lines;
}
