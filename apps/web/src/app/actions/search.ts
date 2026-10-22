"use server";

import { load } from "@/server/services/load";
import { searchEverything, searchQuerySchema } from "@/server/services/search-service";

const noResults = { projects: [], tasks: [] };

export async function searchAction(rawQuery: unknown) {
  const query = searchQuerySchema.safeParse(rawQuery);
  if (!query.success) return { ok: true as const, data: noResults };
  const result = await load(() => searchEverything(query.data));
  // The palette only needs to know search failed; the details are in the server log.
  return result.ok ? result : { ok: false as const };
}
