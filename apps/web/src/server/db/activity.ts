import type { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "./client";

export interface NewActivity {
  type: string;
  title: string;
  description?: string | null;
  metadata?: Prisma.InputJsonValue;
  projectId?: string | null;
  taskId?: string | null;
  repositoryId?: string | null;
}

/** Writes the timeline entry for a change, inside the same transaction as the change. */
export function recordActivity(tx: Prisma.TransactionClient, activity: NewActivity) {
  return tx.activityEvent.create({ data: { ...activity, occurredAt: new Date() } });
}

const activitySelect = {
  id: true,
  type: true,
  title: true,
  description: true,
  occurredAt: true,
  project: { select: { name: true } },
} satisfies Prisma.ActivityEventSelect;

export function listActivity(take: number, where: Prisma.ActivityEventWhereInput = {}) {
  return getPrisma().activityEvent.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take,
    select: activitySelect,
  });
}
