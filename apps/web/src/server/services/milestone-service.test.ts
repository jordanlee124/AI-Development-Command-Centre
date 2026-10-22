import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/domain/errors";
import {
  findMilestoneByTitle,
  getMilestoneForChange,
  insertMilestone,
  updateMilestoneRow,
} from "@/server/db/milestones";
import { getProject } from "@/server/db/projects";
import { createMilestone, updateMilestone } from "./milestone-service";

vi.mock("@/server/db/milestones", () => ({
  findMilestoneByTitle: vi.fn(),
  getMilestoneForChange: vi.fn(),
  insertMilestone: vi.fn(),
  updateMilestoneRow: vi.fn(),
}));
vi.mock("@/server/db/projects", () => ({ getProject: vi.fn() }));

// Fixture ids (UUIDv7-shaped).
const P1 = "0199f3a0-0000-7000-8000-0000000000a1";
const M1 = "0199f3a0-0000-7000-8000-0000000000c1";
const M2 = "0199f3a0-0000-7000-8000-0000000000c2";
const now = new Date("2026-10-22T09:00:00Z");

const milestone = (overrides = {}) => ({
  id: M1,
  projectId: P1,
  title: "v1",
  description: null,
  status: "ACTIVE" as const,
  dueDate: null,
  completedAt: null,
  project: { archivedAt: null },
  ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getProject).mockResolvedValue({ id: P1, archivedAt: null } as Awaited<
    ReturnType<typeof getProject>
  >);
  vi.mocked(findMilestoneByTitle).mockResolvedValue(null);
});

describe("createMilestone", () => {
  it("creates it with a due date and logs it", async () => {
    await createMilestone({ projectId: P1, title: "v1", dueDate: "2026-12-01" }, now);
    expect(insertMilestone).toHaveBeenCalledWith(
      {
        projectId: P1,
        title: "v1",
        description: null,
        status: "PLANNED",
        dueDate: new Date("2026-12-01T00:00:00Z"),
        completedAt: null,
      },
      { type: "milestone.created", title: "Created milestone v1", projectId: P1 },
    );
  });

  it("refuses a duplicate title in the same project", async () => {
    vi.mocked(findMilestoneByTitle).mockResolvedValue({ id: M2 });
    await expect(createMilestone({ projectId: P1, title: "v1" })).rejects.toMatchObject({
      code: "CONFLICT",
      field: "title",
    });
    expect(insertMilestone).not.toHaveBeenCalled();
  });

  it("refuses milestones in an archived project", async () => {
    vi.mocked(getProject).mockResolvedValue({ id: P1, archivedAt: now } as Awaited<
      ReturnType<typeof getProject>
    >);
    await expect(createMilestone({ projectId: P1, title: "v1" })).rejects.toBeInstanceOf(
      DomainError,
    );
  });
});

describe("updateMilestone", () => {
  it("stamps completion when completed and keeps its own title", async () => {
    vi.mocked(getMilestoneForChange).mockResolvedValue(milestone());
    vi.mocked(findMilestoneByTitle).mockResolvedValue({ id: M1 });
    await updateMilestone({ id: M1, title: "v1", status: "COMPLETED" }, now);
    expect(vi.mocked(updateMilestoneRow).mock.calls[0]![1]).toMatchObject({
      status: "COMPLETED",
      completedAt: now,
    });
  });

  it("writes nothing when nothing changed, and describes what did", async () => {
    vi.mocked(getMilestoneForChange).mockResolvedValue(milestone());
    await updateMilestone({ id: M1, title: "v1", status: "ACTIVE" });
    expect(updateMilestoneRow).not.toHaveBeenCalled();

    await updateMilestone({ id: M1, title: "v1", status: "ACTIVE", dueDate: "2026-12-01" });
    expect(vi.mocked(updateMilestoneRow).mock.calls[0]![2]).toMatchObject({
      description: "Due: none → 2026-12-01",
    });
  });

  it("clears completion when reopened", async () => {
    vi.mocked(getMilestoneForChange).mockResolvedValue(
      milestone({ status: "COMPLETED", completedAt: now }),
    );
    await updateMilestone({ id: M1, title: "v1", status: "ACTIVE" });
    expect(vi.mocked(updateMilestoneRow).mock.calls[0]![1]).toMatchObject({ completedAt: null });
  });

  it("refuses edits in an archived project", async () => {
    vi.mocked(getMilestoneForChange).mockResolvedValue(milestone({ project: { archivedAt: now } }));
    await expect(updateMilestone({ id: M1, title: "v1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
