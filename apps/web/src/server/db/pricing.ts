import { DomainError } from "@/domain/errors";
import type { PriceInput, PriceVersion } from "@/domain/pricing";
import { toDateInput } from "@/domain/validation";
import { Prisma, type ModelPrice } from "@/generated/prisma/client";
import { recordActivity, type NewActivity } from "./activity";
import { getPrisma } from "./client";

const rate = (value: Prisma.Decimal | null) => (value === null ? null : value.toNumber());

function toVersion(row: ModelPrice): PriceVersion {
  return {
    id: row.id,
    model: row.model,
    effectiveFrom: toDateInput(row.effectiveFrom),
    inputPerMTok: row.inputPerMTok.toNumber(),
    outputPerMTok: row.outputPerMTok.toNumber(),
    cacheReadPerMTok: rate(row.cacheReadPerMTok),
    cacheWritePerMTok: rate(row.cacheWritePerMTok),
    reasoningPerMTok: rate(row.reasoningPerMTok),
    source: row.source,
    notes: row.notes,
  };
}

export async function listPrices(): Promise<PriceVersion[]> {
  const rows = await getPrisma().modelPrice.findMany({
    orderBy: [{ model: "asc" }, { effectiveFrom: "desc" }],
  });
  return rows.map(toVersion);
}

export async function getPrice(id: string): Promise<PriceVersion | null> {
  const row = await getPrisma().modelPrice.findUnique({ where: { id } });
  return row && toVersion(row);
}

export function findPriceVersion(model: string, effectiveFrom: Date) {
  return getPrisma().modelPrice.findUnique({
    where: { model_effectiveFrom: { model, effectiveFrom } },
    select: { id: true },
  });
}

type PriceData = Omit<PriceInput, "id">;

/** The service checks first; this catches a save racing it to the same (model, day). */
async function uniqueDay(write: Promise<void>) {
  try {
    await write;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DomainError(
        "CONFLICT",
        "This model already has a price starting that day. Edit that one instead.",
        "effectiveFrom",
      );
    }
    throw error;
  }
}

export function insertPrice(data: PriceData, activity: NewActivity) {
  return uniqueDay(
    getPrisma().$transaction(async (tx) => {
      await tx.modelPrice.create({ data });
      await recordActivity(tx, activity);
    }),
  );
}

export function updatePrice(id: string, data: PriceData, activity: NewActivity) {
  return uniqueDay(
    getPrisma().$transaction(async (tx) => {
      await tx.modelPrice.update({ where: { id }, data });
      await recordActivity(tx, activity);
    }),
  );
}

export function deletePriceRow(id: string, activity: NewActivity) {
  return getPrisma().$transaction(async (tx) => {
    await tx.modelPrice.delete({ where: { id } });
    await recordActivity(tx, activity);
  });
}
