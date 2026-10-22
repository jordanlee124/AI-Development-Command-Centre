import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import {
  assertStatusAllowed,
  completionPercent,
  countActive,
  countTotal,
  createsCycle,
  describeTaskChanges,
  isBlocked,
  nextCompletedAt,
  taskCreateSchema,
  type TaskSnapshot,
} from "./task";

describe("task counts", () => {
  const counts = { BACKLOG: 2, TODO: 3, IN_PROGRESS: 1, IN_REVIEW: 1, DONE: 4, CANCELLED: 1 };

  it("counts only committed, unfinished work as active", () => {
    expect(countActive(counts)).toBe(5);
  });

  it("totals every status", () => {
    expect(countTotal(counts)).toBe(12);
  });
});

describe("completionPercent", () => {
  it("excludes cancelled tasks from the denominator", () => {
    expect(completionPercent({ DONE: 1, TODO: 1, CANCELLED: 8 })).toBe(50);
  });

  it("is null when there is nothing to complete", () => {
    expect(completionPercent({})).toBeNull();
    expect(completionPercent({ CANCELLED: 3 })).toBeNull();
  });

  it("rounds to a whole percent", () => {
    expect(completionPercent({ DONE: 1, TODO: 2 })).toBe(33);
  });
});

describe("status transitions", () => {
  const open = { title: "Design schema", status: "IN_PROGRESS" as const };
  const done = { title: "Set up repo", status: "DONE" as const };
  const cancelled = { title: "Old idea", status: "CANCELLED" as const };

  it.each(["IN_PROGRESS", "IN_REVIEW", "DONE"] as const)(
    "refuses %s while a dependency is unfinished, naming it",
    (status) => {
      expect(() => assertStatusAllowed(status, [done, open])).toThrow(/"Design schema"/);
      expect(() => assertStatusAllowed(status, [open])).toThrow(DomainError);
    },
  );

  it.each(["BACKLOG", "TODO", "CANCELLED"] as const)(
    "allows %s with unfinished dependencies",
    (status) => {
      expect(() => assertStatusAllowed(status, [open])).not.toThrow();
    },
  );

  it("treats completed and cancelled dependencies as finished", () => {
    expect(() => assertStatusAllowed("DONE", [done, cancelled])).not.toThrow();
  });

  it("marks unfinished tasks with unfinished dependencies as blocked", () => {
    expect(isBlocked("TODO", [open])).toBe(true);
    expect(isBlocked("TODO", [done])).toBe(false);
    expect(isBlocked("DONE", [open])).toBe(false);
    expect(isBlocked("CANCELLED", [open])).toBe(false);
  });
});

describe("nextCompletedAt", () => {
  const then = new Date("2026-10-01T00:00:00Z");
  const now = new Date("2026-10-22T00:00:00Z");

  it("stamps the time a task becomes done", () => {
    expect(nextCompletedAt(false, true, null, now)).toBe(now);
  });

  it("keeps the original time while it stays done", () => {
    expect(nextCompletedAt(true, true, then, now)).toBe(then);
  });

  it("clears it when the task is reopened", () => {
    expect(nextCompletedAt(true, false, then, now)).toBeNull();
  });
});

describe("createsCycle", () => {
  // c depends on b, b depends on a.
  const edges = [
    { taskId: "b", dependsOnId: "a" },
    { taskId: "c", dependsOnId: "b" },
  ];

  it("detects a direct cycle", () => {
    expect(createsCycle("a", ["b"], edges)).toBe(true);
  });

  it("detects an indirect cycle", () => {
    expect(createsCycle("a", ["c"], edges)).toBe(true);
  });

  it("allows a chain that does not loop back", () => {
    expect(createsCycle("d", ["c"], edges)).toBe(false);
    expect(createsCycle("c", ["a"], edges)).toBe(false);
  });

  it("ignores the task's own current edges, since they are being replaced", () => {
    // b currently depends on a; replacing that with nothing can't make a cycle via a.
    expect(createsCycle("b", [], edges)).toBe(false);
  });
});

describe("describeTaskChanges", () => {
  const before: TaskSnapshot = {
    title: "Write parser",
    description: null,
    status: "TODO",
    priority: "MEDIUM",
    dueDate: null,
    milestone: null,
    assignedAgent: null,
    dependsOn: [{ id: "d1", title: "Design schema" }],
  };

  it("is empty when nothing changed", () => {
    expect(describeTaskChanges(before, { ...before })).toEqual([]);
  });

  it("describes each changed field in words", () => {
    const after: TaskSnapshot = {
      ...before,
      status: "DONE",
      dueDate: new Date("2026-11-01T00:00:00Z"),
      assignedAgent: "CODEX",
      description: "Now with notes",
      dependsOn: [{ id: "d2", title: "Set up repo" }],
    };
    expect(describeTaskChanges(before, after)).toEqual([
      "Status: To do → Completed",
      "Due: none → 2026-11-01",
      "AI provider: none → Codex",
      "Description edited",
      "Depends on: added Set up repo",
      "Depends on: removed Design schema",
    ]);
  });

  it("sees a swap between two tasks with the same title", () => {
    const after = { ...before, dependsOn: [{ id: "d9", title: "Design schema" }] };
    expect(describeTaskChanges(before, after)).toEqual([
      "Depends on: added Design schema",
      "Depends on: removed Design schema",
    ]);
  });
});

describe("taskCreateSchema", () => {
  const projectId = "0199f3a0-0000-7000-8000-000000000001";
  const dep = "0199f3a0-0000-7000-8000-000000000002";

  it("turns blank optional fields into null and applies defaults", () => {
    expect(
      taskCreateSchema.parse({
        projectId,
        title: "  Ship it ",
        description: "",
        dueDate: "",
        milestoneId: "",
        assignedAgent: "",
      }),
    ).toEqual({
      projectId,
      title: "Ship it",
      description: null,
      status: "TODO",
      priority: "MEDIUM",
      dueDate: null,
      milestoneId: null,
      assignedAgent: null,
      dependsOnIds: [],
    });
  });

  it("parses a due date as UTC midnight and removes duplicate dependencies", () => {
    const parsed = taskCreateSchema.parse({
      projectId,
      title: "x",
      dueDate: "2026-11-01",
      dependsOnIds: [dep, dep],
    });
    expect(parsed.dueDate).toEqual(new Date("2026-11-01T00:00:00Z"));
    expect(parsed.dependsOnIds).toEqual([dep]);
  });

  it.each([
    { title: "" },
    { title: "x", dueDate: "2026-02-30" },
    { title: "x", status: "BLOCKED" },
    { title: "x", assignedAgent: "GPT" },
    { title: "x", milestoneId: "not-a-uuid" },
  ])("rejects %j", (fields) => {
    expect(taskCreateSchema.safeParse({ projectId, ...fields }).success).toBe(false);
  });
});
