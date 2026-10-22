import { sumTokenTotals, totalTokens } from "@/domain/agent";
import { countActive, countTotal, taskProgress } from "@/domain/task";
import { listActivity } from "@/server/db/activity";
import { activeSourcesSince, countSessions } from "@/server/db/agents";
import { countProjects, listProjects, taskCountsByProject } from "@/server/db/projects";
import { listRepositories, repositorySummary } from "@/server/db/repositories";
import { taskCountsByStatus } from "@/server/db/tasks";
import { usageByModelSince, type ModelUsage } from "@/server/db/usage";

const DAY_MS = 86_400_000;
export const USAGE_WINDOW_DAYS = 30;

// shortcut: fixed list sizes, no pagination; add paging when real data outgrows them.
const LIST_LIMIT = 200;

function summarizeUsage(byModel: ModelUsage[]) {
  if (byModel.length === 0) return null;
  return {
    byModel: [...byModel].sort((a, b) => totalTokens(b) - totalTokens(a)),
    totals: sumTokenTotals(byModel),
    records: byModel.reduce((sum, row) => sum + row.records, 0),
  };
}

export async function getOverview(now = new Date()) {
  const [
    projectCount,
    statusCounts,
    sessionCount,
    activeSources,
    recentActivity,
    projects,
    progress,
    usage,
    github,
  ] = await Promise.all([
    countProjects(),
    taskCountsByStatus(),
    countSessions(),
    activeSourcesSince(new Date(now.getTime() - DAY_MS)),
    listActivity(8),
    listProjects(6),
    taskCountsByProject(),
    usageByModelSince(new Date(now.getTime() - USAGE_WINDOW_DAYS * DAY_MS)),
    repositorySummary(),
  ]);

  return {
    projectCount,
    activeTasks: countActive(statusCounts),
    totalTasks: countTotal(statusCounts),
    agents: { sessionCount, activeSources },
    recentActivity,
    projectCompletion: projects.map((project) => ({
      id: project.id,
      name: project.name,
      ...taskProgress(progress.get(project.id) ?? {}),
    })),
    usage: summarizeUsage(usage),
    github,
  };
}

export type Overview = Awaited<ReturnType<typeof getOverview>>;

export function getRepositories() {
  return listRepositories();
}

export function getActivity() {
  return listActivity(LIST_LIMIT);
}
