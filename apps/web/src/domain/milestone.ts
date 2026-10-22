import { z } from "zod";
import { idSchema, optionalDate, optionalText } from "./validation";

// Mirrors the Prisma enum; the db layer passes it straight through, so drift fails typecheck.
export const MILESTONE_STATUSES = ["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  PLANNED: "Planned",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const milestoneFields = {
  title: z.string().trim().min(1, "Title is required").max(200),
  description: optionalText(5000),
  status: z.enum(MILESTONE_STATUSES).default("PLANNED"),
  dueDate: optionalDate,
};

export const milestoneCreateSchema = z.object({ projectId: idSchema, ...milestoneFields });
export const milestoneUpdateSchema = z.object({ id: idSchema, ...milestoneFields });
