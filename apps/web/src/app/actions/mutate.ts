import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DomainError } from "@/domain/errors";

export type ActionState =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> }
  | null;

/**
 * Runs a service mutation for a form. Rule and validation failures come back as messages the
 * form shows; anything else is logged and reported as a failed save, never hidden.
 */
export async function mutate(run: () => Promise<unknown>): Promise<ActionState> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DomainError) {
      return {
        ok: false,
        error: error.message,
        fieldErrors: error.field ? { [error.field]: [error.message] } : undefined,
      };
    }
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        error: "Some fields need attention.",
        fieldErrors: z.flattenError(error).fieldErrors,
      };
    }
    console.error("[action] mutation failed", error);
    return { ok: false, error: "Couldn't save. Check the database is running, then try again." };
  }
  // Every page is dynamic and many show the same rows; refresh them all.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** FormData → plain object. Keys in `lists` keep every value (checkbox groups). */
export function formObject(formData: FormData, lists: string[] = []) {
  const object: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith("$ACTION")) continue;
    object[key] = lists.includes(key) ? formData.getAll(key) : formData.get(key);
  }
  for (const key of lists) object[key] ??= [];
  return object;
}
