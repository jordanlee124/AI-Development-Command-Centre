import type { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "./client";

/** Raw JSON value; callers parse it with the key's domain Zod schema. */
export async function getSetting(key: string): Promise<unknown> {
  const row = await getPrisma().applicationSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

/** Callers validate `value` with the key's domain Zod schema first (see schema.prisma). */
export async function setSetting(key: string, value: Prisma.InputJsonValue) {
  await getPrisma().applicationSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}
