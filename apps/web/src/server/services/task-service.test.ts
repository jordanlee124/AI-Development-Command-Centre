import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { DomainError } from "@/domain/errors";
import { findMilestone } from "@/server/db/milestones";
import { getProject } from "@/server/db/projects";
import {
  findTasksByIds,
  getTaskForChange,
  insertComment,
  insertTask,
  listDependencyEdges,
  updateTaskRow,
  type TaskForChange,
} from "@/server/db/tasks";
import { addComment, createTask, getTaskPage, moveTask, updateTask } from "./task-service";

vi.mock("@/server/db/milestones", () => ({
  findMilestone: vi.fn(),
  listProjectMilestones: vi.fn(),
}));
vi.mock("@/server/db/projects", () => ({ getProject: vi.fn(), listProjectOptions: vi.fn() }));
vi.mock("@/server/db/tasks", () => ({
  findTasks: vi.fn(),
  findTasksByIds: vi.fn(),
  getTaskDetail: vi.fn(),
  getTaskForChange: vi.fn(),
  insertComment: vi.fn(),
  insertTask: vi.fn(),
  listDependencyEdges: vi.fn(),
  listTaskHistory: vi.fn(),
  listTaskOptions: vi.fn(),
  taskCountsByStatus: vi.fn(),
  updateTaskRow: vi.fn(),
}));

// Fixture ids (UUIDv7-shaped).
const P1 = "0199f3a0-0000-7000-8000-0000000000a1";
const P2 = "0199f3a0-0000-7000-8000-0000000000a2";
const T1 = "0199f3a0-0000-7000-8000-0000000000b1";
const T2 = "0199f3a0-0000-7000-8000-0000000000b2";
const T3 = "0199f3a0-0000-7000-8000-0000000000b3";
const M1 = "0199f3a0-0000-7000-8000-0000000000c1";
const now = new Date("2026-10-22T09:00:00Z");

function project(archivedAt: Date | null = null) {
  return { id: P1, name: "ADCC", archivedAt } as Awaited<ReturnType<typeof getProject>>;
}

function task(overrides: Partial<TaskForChange> = {}): TaskForChange {
  return {
    id: T1,
    projectId: P1,
    title: "Write parser",
    description: null,
    status: "TODO",
    priority: "MEDIUM",
    dueDate: null,
    milestoneId: null,
    assignedAgent: null,
    completedAt: null,
    project: { archivedAt: null },
    milestone: null,
    dependencies: [],
    ...overrides,
  };
}

const fields = { title: "Write parser", status: "TODO", priority: "MEDIUM" };

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getProject).mockResolvedValue(project());
  vi.mocked(findTasksByIds).mockResolvedValue([]);
  vi.mocked(listDependencyEdges).mockResolvedValue([]);
  vi.mocked(insertTask).mockResolvedValue({ id: T1 });
});

describe("createTask", () => {
  it("creates the task with its dependencies and logs it", async () => {
    vi.mocked(findTasksByIds).mockResolvedValue([
      { id: T2, projectId: P1, title: "Design", status: "DONE" },
    ]);
    await createTask(
      {
        projectId: P1,
        ...fields,
        status: "DONE",
        assignedAgent: "CLAUDE_CODE",
        dependsOnIds: [T2],
      },
      now,
    );

    const [data, dependsOnIds, activity] = vi.mocked(insertTask).mock.calls[0]!;
    expect(data).toMatchObject({
      projectId: P1,
      title: "Write parser",
      status: "DONE",
      assignedAgent: "CLAUDE_CODE",
      completedAt: now,
    });
    expect(dependsOnIds).toEqual([T2]);
    expect(activity(T1)).toEqual({
      type: "task.created",
      title: "Created task Write parser",
      projectId: P1,
      taskId: T1,
    });
  });

  it("rejects invalid input before touching the database", async () => {
    await expect(createTask({ projectId: P1, title: "" })).rejects.toBeInstanceOf(ZodError);
    expect(getProject).not.toHaveBeenCalled();
  });

  it("refuses tasks in an archived project", async () => {
    vi.mocked(getProject).mockResolvedValue(project(now));
    expect((await rejection(createTask({ projectId: P1, ...fields }))).code).toBe("FORBIDDEN");
    expect(insertTask).not.toHaveBeenCalled();
  });

  it("refuses a milestone from another project", async () => {
    vi.mocked(findMilestone).mockResolvedValue({ id: M1, projectId: P2, title: "v1" });
    const error = await rejection(createTask({ projectId: P1, ...fields, milestoneId: M1 }));
    expect(error.field).toBe("milestoneId");
    expect(insertTask).not.toHaveBeenCalled();
  });

  it("refuses a dependency from another project", async () => {
    vi.mocked(findTasksByIds).mockResolvedValue([
      { id: T2, projectId: P2, title: "Elsewhere", status: "DONE" },
    ]);
    const error = await rejection(createTask({ projectId: P1, ...fields, dependsOnIds: [T2] }));
    expect(error.field).toBe("dependsOnIds");
  });

  it("refuses a dependency that does not exist", async () => {
    const error = await rejection(createTask({ projectId: P1, ...fields, dependsOnIds: [T2] }));
    expect(error.field).toBe("dependsOnIds");
  });

  it("refuses to start a task whose dependency is unfinished", async () => {
    vi.mocked(findTasksByIds).mockResolvedValue([
      { id: T2, projectId: P1, title: "Design", status: "TODO" },
    ]);
    const error = await rejection(
      createTask({ projectId: P1, ...fields, status: "IN_PROGRESS", dependsOnIds: [T2] }),
    );
    expect(error.field).toBe("status");
    expect(insertTask).not.toHaveBeenCalled();
  });
});

describe("updateTask", () => {
  it("writes nothing when nothing changed", async () => {
    vi.mocked(getTaskForChange).mockResolvedValue(task());
    await updateTask({ id: T1, ...fields });
    expect(updateTaskRow).not.toHaveBeenCalled();
  });

  it("logs a status-only edit as a status change", async () => {
    vi.mocked(getTaskForChange).mockResolvedValue(task());
    await updateTask({ id: T1, ...fields, status: "IN_REVIEW" }, now);
    const [, , dependsOnIds, activity] = vi.mocked(updateTaskRow).mock.calls[0]!;
    expect(dependsOnIds).toBeUndefined();
    expect(activity).toMatchObject({
      type: "task.status_changed",
      title: "Moved Write parser to In review",
      description: "Status: To do → In review",
      taskId: T1,
    });
  });

  it("replaces dependencies only when they changed, and lists every change", async () => {
    vi.mocked(getTaskForChange).mockResolvedValue(task());
    vi.mocked(findTasksByIds).mockResolvedValue([
      { id: T2, projectId: P1, title: "Design", status: "DONE" },
    ]);
    await updateTask({ id: T1, ...fields, priority: "HIGH", dependsOnIds: [T2] });
    const [, data, dependsOnIds, activity] = vi.mocked(updateTaskRow).mock.calls[0]!;
    expect(data).toMatchObject({ priority: "HIGH" });
    expect(dependsOnIds).toEqual([T2]);
    expect(activity).toMatchObject({
      type: "task.updated",
      description: "Priority: Medium → High; Depends on: added Design",
    });
  });

  it("saves a dependency swap between two tasks with the same title", async () => {
    vi.mocked(getTaskForChange).mockResolvedValue(
      task({ dependencies: [{ dependsOn: { id: T2, title: "Setup", status: "DONE" } }] }),
    );
    vi.mocked(findTasksByIds).mockResolvedValue([
      { id: T3, projectId: P1, title: "Setup", status: "DONE" },
    ]);
    await updateTask({ id: T1, ...fields, dependsOnIds: [T3] });
    expect(vi.mocked(updateTaskRow).mock.calls[0]![2]).toEqual([T3]);
  });

  it("still allows editing a started task after its dependency was reopened", async () => {
    vi.mocked(getTaskForChange).mockResolvedValue(
      task({
        status: "IN_PROGRESS",
        dependencies: [{ dependsOn: { id: T2, title: "Design", status: "TODO" } }],
      }),
    );
    vi.mocked(findTasksByIds).mockResolvedValue([
      { id: T2, projectId: P1, title: "Design", status: "TODO" },
    ]);
    await updateTask({
      id: T1,
      ...fields,
      status: "IN_PROGRESS",
      title: "Renamed",
      dependsOnIds: [T2],
    });
    expect(updateTaskRow).toHaveBeenCalledOnce();
  });

  it("refuses a self-dependency", async () => {
    vi.mocked(getTaskForChange).mockResolvedValue(task());
    const error = await rejection(updateTask({ id: T1, ...fields, dependsOnIds: [T1] }));
    expect(error.message).toMatch(/itself/);
  });

  it("refuses a circular dependency", async () => {
    vi.mocked(getTaskForChange).mockResolvedValue(task());
    vi.mocked(findTasksByIds).mockResolvedValue([
      { id: T3, projectId: P1, title: "Release", status: "TODO" },
    ]);
    // T3 already waits on T2, which waits on T1: T1 → T3 would close the loop.
    vi.mocked(listDependencyEdges).mockResolvedValue([
      { taskId: T3, dependsOnId: T2 },
      { taskId: T2, dependsOnId: T1 },
    ]);
    const error = await rejection(updateTask({ id: T1, ...fields, dependsOnIds: [T3] }));
    expect(error.message).toMatch(/circular/);
    expect(updateTaskRow).not.toHaveBeenCalled();
  });

  it("refuses edits in an archived project", async () => {
    vi.mocked(getTaskForChange).mockResolvedValue(task({ project: { archivedAt: now } }));
    expect((await rejection(updateTask({ id: T1, ...fields, title: "New" }))).code).toBe(
      "FORBIDDEN",
    );
  });

  it("reports a missing task as not found", async () => {
    vi.mocked(getTaskForChange).mockResolvedValue(null);
    expect((await rejection(updateTask({ id: T1, ...fields }))).code).toBe("NOT_FOUND");
  });
});

describe("moveTask", () => {
  const waitingOn = (status: "TODO" | "DONE") => ({
    dependencies: [{ dependsOn: { id: T2, title: "Design", status } }],
  });

  it("refuses to move a blocked task into a started column", async () => {
    vi.mocked(getTaskForChange).mockResolvedValue(task(waitingOn("TODO")));
    const error = await rejection(moveTask({ id: T1, status: "IN_PROGRESS" }));
    expect(error.message).toMatch(/waiting on "Design"/);
    expect(updateTaskRow).not.toHaveBeenCalled();
  });

  it("allows moving a blocked task between unstarted columns", async () => {
    vi.mocked(getTaskForChange).mockResolvedValue(task(waitingOn("TODO")));
    await moveTask({ id: T1, status: "BACKLOG" });
    expect(updateTaskRow).toHaveBeenCalledOnce();
  });

  it("stamps completion when moved to Completed and clears it when moved back", async () => {
    vi.mocked(getTaskForChange).mockResolvedValue(task(waitingOn("DONE")));
    await moveTask({ id: T1, status: "DONE" }, now);
    expect(vi.mocked(updateTaskRow).mock.calls[0]![1]).toEqual({
      status: "DONE",
      completedAt: now,
    });

    vi.mocked(getTaskForChange).mockResolvedValue(task({ status: "DONE", completedAt: now }));
    await moveTask({ id: T1, status: "TODO" }, now);
    expect(vi.mocked(updateTaskRow).mock.calls[1]![1]).toEqual({
      status: "TODO",
      completedAt: null,
    });
  });

  it("does nothing when the status is unchanged", async () => {
    vi.mocked(getTaskForChange).mockResolvedValue(task());
    await moveTask({ id: T1, status: "TODO" });
    expect(updateTaskRow).not.toHaveBeenCalled();
  });

  it("rejects an unknown status", async () => {
    await expect(moveTask({ id: T1, status: "BLOCKED" })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("addComment", () => {
  it("stores the trimmed comment and logs it", async () => {
    vi.mocked(getTaskForChange).mockResolvedValue(task());
    await addComment({ taskId: T1, body: "  Looks good  " });
    expect(insertComment).toHaveBeenCalledWith(T1, "Looks good", {
      type: "task.commented",
      title: "Commented on Write parser",
      projectId: P1,
      taskId: T1,
    });
  });

  it("refuses comments on tasks in an archived project", async () => {
    vi.mocked(getTaskForChange).mockResolvedValue(task({ project: { archivedAt: now } }));
    await rejection(addComment({ taskId: T1, body: "hi" }));
    expect(insertComment).not.toHaveBeenCalled();
  });
});

describe("getTaskPage", () => {
  it("returns null for a malformed id without querying", async () => {
    expect(await getTaskPage("not-a-uuid")).toBeNull();
    expect(getTaskForChange).not.toHaveBeenCalled();
  });
});
