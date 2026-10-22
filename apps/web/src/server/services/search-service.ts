import { z } from "zod";
import { searchProjects } from "@/server/db/projects";
import { searchTasks } from "@/server/db/tasks";

export const searchQuerySchema = z.string().trim().min(2).max(100);

const RESULTS_PER_KIND = 5;

/** Searches project names/slugs and task titles. Input must already pass searchQuerySchema. */
export async function searchEverything(query: string) {
  const [projects, tasks] = await Promise.all([
    searchProjects(query, RESULTS_PER_KIND),
    searchTasks(query, RESULTS_PER_KIND),
  ]);
  return { projects, tasks };
}

export type SearchResults = Awaited<ReturnType<typeof searchEverything>>;
