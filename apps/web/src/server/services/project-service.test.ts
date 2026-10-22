import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { DomainError } from "@/domain/errors";
import {
  deleteProjectWithContents,
  findProjectByLocalPath,
  getProject,
  insertProject,
  slugsStartingWith,
  updateProjectRow,
} from "@/server/db/projects";
import { findRepository, linkRepositoryRow, unlinkRepositoryRow } from "@/server/db/repositories";
import {
  createProject,
  deleteProject,
  getProjectDetail,
  linkRepository,
  setProjectArchived,
  unlinkRepository,
  updateProject,
} from "./project-service";

vi.mock("@/server/db/activity", () => ({ listActivity: vi.fn() }));
vi.mock("@/server/db/milestones", () => ({
  listProjectMilestones: vi.fn(),
  milestoneTaskCounts: vi.fn(),
}));
vi.mock("@/server/db/projects", () => ({
  deleteProjectWithContents: vi.fn(),
  findProjectByLocalPath: vi.fn(),
  findProjects: vi.fn(),
  getProject: vi.fn(),
  insertProject: vi.fn(),
  slugsStartingWith: vi.fn(),
  taskCountsByProject: vi.fn(),
  updateProjectRow: vi.fn(),
}));
vi.mock("@/server/db/repositories", () => ({
  findRepository: vi.fn(),
  linkRepositoryRow: vi.fn(),
  unlinkRepositoryRow: vi.fn(),
}));
vi.mock("@/server/db/tasks", () => ({ listBoardTasks: vi.fn(), listTaskOptions: vi.fn() }));

// Fixture ids (UUIDv7-shaped).
const P1 = "0199f3a0-0000-7000-8000-0000000000a1";
const P2 = "0199f3a0-0000-7000-8000-0000000000a2";
const R1 = "0199f3a0-0000-7000-8000-0000000000d1";
const archivedAt = new Date("2026-10-20T00:00:00Z");

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: P1,
    name: "ADCC",
    slug: "adcc",
    description: null,
    status: "ACTIVE",
    localPath: null,
    archivedAt: null,
    _count: { tasks: 3, milestones: 1 },
    ...overrides,
  } as Awaited<ReturnType<typeof getProject>>;
}

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
  vi.mocked(slugsStartingWith).mockResolvedValue(new Set());
  vi.mocked(findProjectByLocalPath).mockResolvedValue(null);
  vi.mocked(insertProject).mockResolvedValue({ id: P1 });
  vi.mocked(getProject).mockResolvedValue(project());
});

describe("createProject", () => {
  it("creates it with a unique slug and logs it", async () => {
    vi.mocked(slugsStartingWith).mockResolvedValue(new Set(["my-app"]));
    await createProject({ name: " My App ", description: "", localPath: "D:/Projects/my-app" });

    const [data, activity] = vi.mocked(insertProject).mock.calls[0]!;
    expect(data).toEqual({
      name: "My App",
      slug: "my-app-2",
      description: null,
      status: "ACTIVE",
      localPath: "D:\\Projects\\my-app",
    });
    expect(activity(P1)).toEqual({
      type: "project.created",
      title: "Created project My App",
      projectId: P1,
    });
  });

  it("refuses a folder another project already uses", async () => {
    vi.mocked(findProjectByLocalPath).mockResolvedValue({ id: P2, name: "Other" });
    const error = await rejection(createProject({ name: "x", localPath: "D:\\Other" }));
    expect(error).toMatchObject({ code: "CONFLICT", field: "localPath" });
    expect(insertProject).not.toHaveBeenCalled();
  });

  it("rejects a missing name", async () => {
    await expect(createProject({ name: "  " })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("updateProject", () => {
  const input = { id: P1, name: "ADCC", status: "ACTIVE" };

  it("logs what changed", async () => {
    await updateProject({ ...input, name: "ADCC 2", status: "ON_HOLD" });
    expect(vi.mocked(updateProjectRow).mock.calls[0]![2]).toMatchObject({
      type: "project.updated",
      description: "Name: ADCC → ADCC 2; Status: Active → On hold",
    });
  });

  it("writes nothing when nothing changed", async () => {
    await updateProject(input);
    expect(updateProjectRow).not.toHaveBeenCalled();
  });

  it("allows keeping its own folder", async () => {
    vi.mocked(getProject).mockResolvedValue(project({ localPath: "D:\\App" }));
    vi.mocked(findProjectByLocalPath).mockResolvedValue({ id: P1, name: "ADCC" });
    await updateProject({ ...input, localPath: "D:\\App", name: "Renamed" });
    expect(updateProjectRow).toHaveBeenCalledOnce();
  });

  it("refuses edits to an archived project", async () => {
    vi.mocked(getProject).mockResolvedValue(project({ archivedAt }));
    expect((await rejection(updateProject({ ...input, name: "x" }))).code).toBe("FORBIDDEN");
  });

  it("reports a missing project as not found", async () => {
    vi.mocked(getProject).mockResolvedValue(null);
    expect((await rejection(updateProject(input))).code).toBe("NOT_FOUND");
  });
});

describe("archiving", () => {
  it("archives and logs it", async () => {
    await setProjectArchived(P1, true);
    const [id, data, activity] = vi.mocked(updateProjectRow).mock.calls[0]!;
    expect(id).toBe(P1);
    expect(data.archivedAt).toBeInstanceOf(Date);
    expect(activity.type).toBe("project.archived");
  });

  it("unarchives", async () => {
    vi.mocked(getProject).mockResolvedValue(project({ archivedAt }));
    await setProjectArchived(P1, false);
    expect(vi.mocked(updateProjectRow).mock.calls[0]![1]).toEqual({ archivedAt: null });
  });

  it("rejects a non-boolean archived flag from the client", async () => {
    await expect(setProjectArchived(P1, "false")).rejects.toBeInstanceOf(ZodError);
    expect(updateProjectRow).not.toHaveBeenCalled();
  });

  it("does nothing when already in that state", async () => {
    await setProjectArchived(P1, false);
    expect(updateProjectRow).not.toHaveBeenCalled();
  });
});

describe("deleteProject", () => {
  it("refuses a project that is not archived", async () => {
    const error = await rejection(deleteProject({ id: P1, confirmName: "ADCC" }));
    expect(error.message).toMatch(/Archive/);
    expect(deleteProjectWithContents).not.toHaveBeenCalled();
  });

  it("refuses when the typed name does not match exactly", async () => {
    vi.mocked(getProject).mockResolvedValue(project({ archivedAt }));
    const error = await rejection(deleteProject({ id: P1, confirmName: "adcc" }));
    expect(error.field).toBe("confirmName");
    expect(deleteProjectWithContents).not.toHaveBeenCalled();
  });

  it("deletes an archived project and records what went with it", async () => {
    vi.mocked(getProject).mockResolvedValue(project({ archivedAt }));
    await deleteProject({ id: P1, confirmName: " ADCC " });
    expect(deleteProjectWithContents).toHaveBeenCalledWith(P1, {
      type: "project.deleted",
      title: "Deleted project ADCC",
      description: "3 tasks and 1 milestone deleted",
      metadata: { projectId: P1, name: "ADCC", tasks: 3, milestones: 1 },
    });
  });
});

describe("repositories", () => {
  it("links a repository, normalising its name", async () => {
    vi.mocked(findRepository).mockResolvedValue(null);
    await linkRepository({ projectId: P1, repository: "https://github.com/Owner/Repo" });
    const [projectId, repo, activity] = vi.mocked(linkRepositoryRow).mock.calls[0]!;
    expect([projectId, repo]).toEqual([P1, { owner: "owner", name: "repo" }]);
    expect(activity(R1)).toMatchObject({ type: "repository.linked", repositoryId: R1 });
  });

  it("refuses a repository linked to another project", async () => {
    vi.mocked(findRepository).mockResolvedValue({
      id: R1,
      owner: "owner",
      name: "repo",
      projectId: P2,
      project: { name: "Other", archivedAt: null },
    });
    const error = await rejection(linkRepository({ projectId: P1, repository: "owner/repo" }));
    expect(error.message).toMatch(/"Other"/);
    expect(linkRepositoryRow).not.toHaveBeenCalled();
  });

  it("says how to free a repository held by an archived project", async () => {
    vi.mocked(findRepository).mockResolvedValue({
      id: R1,
      owner: "owner",
      name: "repo",
      projectId: P2,
      project: { name: "Old", archivedAt },
    });
    const error = await rejection(linkRepository({ projectId: P1, repository: "owner/repo" }));
    expect(error.message).toMatch(/archived project "Old". Unarchive it/);
  });

  it("refuses to unlink a repository from a project it isn't linked to", async () => {
    vi.mocked(findRepository).mockResolvedValue({
      id: R1,
      owner: "owner",
      name: "repo",
      projectId: P2,
      project: { name: "Other", archivedAt: null },
    });
    await rejection(unlinkRepository({ projectId: P1, repositoryId: R1 }));
    expect(unlinkRepositoryRow).not.toHaveBeenCalled();
  });

  it("refuses repository changes on an archived project", async () => {
    vi.mocked(getProject).mockResolvedValue(project({ archivedAt }));
    expect(
      (await rejection(linkRepository({ projectId: P1, repository: "owner/repo" }))).code,
    ).toBe("FORBIDDEN");
  });
});

describe("getProjectDetail", () => {
  it("returns null for a malformed id without querying", async () => {
    expect(await getProjectDetail("123")).toBeNull();
    expect(getProject).not.toHaveBeenCalled();
  });
});
