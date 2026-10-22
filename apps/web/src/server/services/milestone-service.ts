import { DomainError } from "@/domain/errors";
import {
  MILESTONE_STATUS_LABELS,
  milestoneCreateSchema,
  milestoneUpdateSchema,
} from "@/domain/milestone";
import { toDateInput } from "@/domain/validation";
import { nextCompletedAt } from "@/domain/task";
import {
  findMilestoneByTitle,
  getMilestoneForChange,
  insertMilestone,
  updateMilestoneRow,
} from "@/server/db/milestones";
import { getProject } from "@/server/db/projects";

const archived = () =>
  new DomainError("FORBIDDEN", "This project is archived. Unarchive it to make changes.");

async function assertTitleFree(projectId: string, title: string, milestoneId?: string) {
  const existing = await findMilestoneByTitle(projectId, title);
  if (existing && existing.id !== milestoneId) {
    throw new DomainError(
      "CONFLICT",
      "This project already has a milestone with that title.",
      "title",
    );
  }
}

export async function createMilestone(input: unknown, now = new Date()) {
  const data = milestoneCreateSchema.parse(input);
  const project = await getProject(data.projectId);
  if (!project) throw new DomainError("NOT_FOUND", "That project no longer exists.");
  if (project.archivedAt) throw archived();
  await assertTitleFree(data.projectId, data.title);
  return insertMilestone(
    { ...data, completedAt: nextCompletedAt(false, data.status === "COMPLETED", null, now) },
    {
      type: "milestone.created",
      title: `Created milestone ${data.title}`,
      projectId: data.projectId,
    },
  );
}

export async function updateMilestone(input: unknown, now = new Date()) {
  const { id, ...data } = milestoneUpdateSchema.parse(input);
  const milestone = await getMilestoneForChange(id);
  if (!milestone) throw new DomainError("NOT_FOUND", "That milestone no longer exists.");
  if (milestone.project.archivedAt) throw archived();
  await assertTitleFree(milestone.projectId, data.title, id);
  const due = (date: Date | null) => toDateInput(date) || "none";
  const changes = [
    milestone.title !== data.title && `Title: ${milestone.title} → ${data.title}`,
    milestone.status !== data.status &&
      `Status: ${MILESTONE_STATUS_LABELS[milestone.status]} → ${MILESTONE_STATUS_LABELS[data.status]}`,
    due(milestone.dueDate) !== due(data.dueDate) &&
      `Due: ${due(milestone.dueDate)} → ${due(data.dueDate)}`,
    milestone.description !== data.description && "Description edited",
  ].filter((line) => typeof line === "string");
  if (changes.length === 0) return;
  const completedAt = nextCompletedAt(
    milestone.status === "COMPLETED",
    data.status === "COMPLETED",
    milestone.completedAt,
    now,
  );
  await updateMilestoneRow(
    id,
    { ...data, completedAt },
    {
      type: "milestone.updated",
      title: `Updated milestone ${data.title}`,
      description: changes.join("; "),
      projectId: milestone.projectId,
    },
  );
}
