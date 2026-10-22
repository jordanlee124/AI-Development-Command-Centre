import { z } from "zod";
import { DomainError } from "@/domain/errors";
import {
  PROJECT_STATUS_LABELS,
  projectDeleteSchema,
  projectInputSchema,
  projectUpdateSchema,
  repositoryLinkSchema,
  repositoryUnlinkSchema,
  slugify,
  uniqueSlug,
} from "@/domain/project";
import { isBlocked, taskProgress } from "@/domain/task";
import { idSchema, PAGE_SIZE, pageCount } from "@/domain/validation";
import { listActivity } from "@/server/db/activity";
import { listProjectMilestones, milestoneTaskCounts } from "@/server/db/milestones";
import {
  deleteProjectWithContents,
  findProjectByLocalPath,
  findProjects,
  getProject,
  insertProject,
  slugsStartingWith,
  taskCountsByProject,
  updateProjectRow,
  type ProjectFilter,
} from "@/server/db/projects";
import { findRepository, linkRepositoryRow, unlinkRepositoryRow } from "@/server/db/repositories";
import { listBoardTasks, listTaskOptions } from "@/server/db/tasks";

export async function listProjectsPage(filter: ProjectFilter, page: number) {
  const { rows, total } = await findProjects(filter, (page - 1) * PAGE_SIZE, PAGE_SIZE);
  const progress = await taskCountsByProject(rows.map((row) => row.id));
  return {
    projects: rows.map((row) => ({ ...row, ...taskProgress(progress.get(row.id) ?? {}) })),
    total,
    pageCount: pageCount(total),
  };
}

/** Everything the project page shows, or null when there is no such project. */
export async function getProjectDetail(id: string) {
  if (!idSchema.safeParse(id).success) return null;
  const project = await getProject(id);
  if (!project) return null;
  const [counts, milestones, milestoneCounts, board, taskOptions, activity] = await Promise.all([
    taskCountsByProject([id]),
    listProjectMilestones(id),
    milestoneTaskCounts(id),
    listBoardTasks(id),
    listTaskOptions(id),
    listActivity(10, { projectId: id }),
  ]);
  return {
    project,
    progress: taskProgress(counts.get(id) ?? {}),
    milestones: milestones.map((m) => ({ ...m, ...taskProgress(milestoneCounts.get(m.id) ?? {}) })),
    board: board.map(({ dependencies, ...task }) => ({
      ...task,
      blocked: isBlocked(
        task.status,
        dependencies.map((d) => d.dependsOn),
      ),
    })),
    taskOptions,
    activity,
  };
}

export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>;

async function requireProject(id: string, { editable }: { editable: boolean }) {
  const project = await getProject(id);
  if (!project) throw new DomainError("NOT_FOUND", "That project no longer exists.");
  if (editable && project.archivedAt) {
    throw new DomainError("FORBIDDEN", "This project is archived. Unarchive it to make changes.");
  }
  return project;
}

async function assertLocalPathFree(localPath: string | null, projectId?: string) {
  if (!localPath) return;
  const owner = await findProjectByLocalPath(localPath);
  if (owner && owner.id !== projectId) {
    throw new DomainError(
      "CONFLICT",
      `That folder is already used by project "${owner.name}".`,
      "localPath",
    );
  }
}

export async function createProject(input: unknown) {
  const data = projectInputSchema.parse(input);
  await assertLocalPathFree(data.localPath);
  const base = slugify(data.name);
  const slug = uniqueSlug(base, await slugsStartingWith(base));
  return insertProject({ ...data, slug }, (projectId) => ({
    type: "project.created",
    title: `Created project ${data.name}`,
    projectId,
  }));
}

export async function updateProject(input: unknown) {
  const { id, ...data } = projectUpdateSchema.parse(input);
  const project = await requireProject(id, { editable: true });
  await assertLocalPathFree(data.localPath, id);

  const changes = [
    project.name !== data.name && `Name: ${project.name} → ${data.name}`,
    project.status !== data.status &&
      `Status: ${PROJECT_STATUS_LABELS[project.status]} → ${PROJECT_STATUS_LABELS[data.status]}`,
    project.localPath !== data.localPath &&
      `Folder: ${project.localPath ?? "none"} → ${data.localPath ?? "none"}`,
    project.description !== data.description && "Description edited",
  ].filter((line) => typeof line === "string");
  if (changes.length === 0) return;

  await updateProjectRow(id, data, {
    type: "project.updated",
    title: `Updated project ${data.name}`,
    description: changes.join("; "),
    projectId: id,
  });
}

export async function setProjectArchived(input: unknown, archivedInput: unknown) {
  const id = idSchema.parse(input);
  const archived = z.boolean().parse(archivedInput);
  const project = await requireProject(id, { editable: false });
  if (Boolean(project.archivedAt) === archived) return;
  await updateProjectRow(
    id,
    { archivedAt: archived ? new Date() : null },
    {
      type: archived ? "project.archived" : "project.unarchived",
      title: `${archived ? "Archived" : "Unarchived"} project ${project.name}`,
      projectId: id,
    },
  );
}

/** Permanent. Allowed only for an archived project, confirmed by typing its exact name. */
export async function deleteProject(input: unknown) {
  const { id, confirmName } = projectDeleteSchema.parse(input);
  const project = await requireProject(id, { editable: false });
  if (!project.archivedAt) {
    throw new DomainError("FORBIDDEN", "Archive the project before deleting it.");
  }
  if (confirmName.trim() !== project.name) {
    throw new DomainError("FORBIDDEN", "Type the project name exactly to confirm.", "confirmName");
  }
  const { tasks, milestones } = project._count;
  await deleteProjectWithContents(id, {
    type: "project.deleted",
    title: `Deleted project ${project.name}`,
    description: `${tasks} task${tasks === 1 ? "" : "s"} and ${milestones} milestone${milestones === 1 ? "" : "s"} deleted`,
    metadata: { projectId: id, name: project.name, tasks, milestones },
  });
}

export async function linkRepository(input: unknown) {
  const { projectId, repository } = repositoryLinkSchema.parse(input);
  await requireProject(projectId, { editable: true });
  const fullName = `${repository.owner}/${repository.name}`;
  const existing = await findRepository(repository);
  if (existing?.projectId === projectId) {
    throw new DomainError("CONFLICT", `${fullName} is already linked.`, "repository");
  }
  if (existing?.project) {
    throw new DomainError(
      "CONFLICT",
      existing.project.archivedAt
        ? `${fullName} is linked to archived project "${existing.project.name}". Unarchive it and unlink the repository there first.`
        : `${fullName} is linked to project "${existing.project.name}". Unlink it there first.`,
      "repository",
    );
  }
  await linkRepositoryRow(projectId, repository, (repositoryId) => ({
    type: "repository.linked",
    title: `Linked repository ${fullName}`,
    projectId,
    repositoryId,
  }));
}

export async function unlinkRepository(input: unknown) {
  const { projectId, repositoryId } = repositoryUnlinkSchema.parse(input);
  await requireProject(projectId, { editable: true });
  const repo = await findRepository({ id: repositoryId });
  if (!repo || repo.projectId !== projectId) {
    throw new DomainError("NOT_FOUND", "That repository is not linked to this project.");
  }
  await unlinkRepositoryRow(repositoryId, {
    type: "repository.unlinked",
    title: `Unlinked repository ${repo.owner}/${repo.name}`,
    projectId,
    repositoryId,
  });
}
