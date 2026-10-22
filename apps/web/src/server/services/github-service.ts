import { DomainError } from "@/domain/errors";
import { nextSyncAt, snapshotActivity } from "@/domain/github";
import { idSchema } from "@/domain/validation";
import { listActivity } from "@/server/db/activity";
import {
  findLinkedRepositories,
  findSyncRepository,
  getRepositoryWithSnapshot,
  listSyncTargets,
  recordSyncFailure,
  saveSnapshot,
} from "@/server/db/github";
import { listProjectOptions } from "@/server/db/projects";
import { getEnv } from "@/server/env";
import {
  fetchAccessibleRepositories,
  fetchConnection,
  fetchRepositorySnapshot,
  GitHubError,
  type GitHubErrorKind,
} from "@/server/github/client";

/** Whether a token is configured and how often background sync runs (0 = off). Never the token. */
export function getGitHubSettings() {
  const { GITHUB_TOKEN, GITHUB_SYNC_INTERVAL_MINUTES } = getEnv();
  return { configured: Boolean(GITHUB_TOKEN), syncIntervalMinutes: GITHUB_SYNC_INTERVAL_MINUTES };
}

/** The connected account, or null when no token is configured. GitHub errors propagate. */
export async function getGitHubConnection() {
  return getGitHubSettings().configured ? fetchConnection() : null;
}

/** Repositories the token can read, each marked with the project it's linked to, if any. */
export async function getAccessibleRepositories() {
  const [repositories, projects] = await Promise.all([
    fetchAccessibleRepositories(),
    listProjectOptions(),
  ]);
  const linked = await findLinkedRepositories(repositories);
  const projectOf = (repo: (typeof repositories)[number]) =>
    linked.find(
      (row) =>
        row.githubId === BigInt(repo.githubId) ||
        (row.owner === repo.owner && row.name === repo.name),
    )?.project ?? null;
  return {
    repositories: repositories.map((repo) => ({ ...repo, linkedProject: projectOf(repo) })),
    projects,
  };
}

export async function getGitHubRepository(id: string) {
  if (!idSchema.safeParse(id).success) return null;
  const repository = await getRepositoryWithSnapshot(id);
  if (!repository) return null;
  return { repository, activity: await listActivity(30, { repositoryId: id }) };
}

export type GitHubRepositoryDetail = NonNullable<Awaited<ReturnType<typeof getGitHubRepository>>>;

export type SyncResult =
  { ok: true } | { ok: false; error: string; kind: GitHubErrorKind | "internal"; retryAt?: Date };

/** Failures that would hit every other repository too: they stop a batch and don't count
 * toward one repository's backoff. */
const sharedFailure = (result: SyncResult) =>
  !result.ok && (result.kind === "rate_limited" || result.kind === "unauthorized");

// On globalThis like the scheduler, so every copy of this module (dev reloads, the
// instrumentation bundle) shares one lock and one rate-limit pause.
// shortcut: in-process lock; fine for ADCC's single server process, needs a DB lock if the
// app ever runs more than one.
const shared = globalThis as unknown as {
  adccGitHub?: { inFlight: Map<string, Promise<SyncResult>>; rateLimit: SyncResult | null };
};
const syncState = () => (shared.adccGitHub ??= { inFlight: new Map(), rateLimit: null });

/**
 * Syncs one repository now. A GitHub failure is recorded on the repository and returned, not
 * thrown, and the last good snapshot stays. A second call while one runs joins it. While a
 * known rate limit lasts, it returns that without calling GitHub.
 */
export async function syncRepository(input: unknown): Promise<SyncResult> {
  const id = idSchema.parse(input);
  const state = syncState();
  const limit = state.rateLimit;
  if (limit && !limit.ok && limit.retryAt && limit.retryAt > new Date()) return limit;
  let run = state.inFlight.get(id);
  if (!run) {
    run = runSync(id).finally(() => state.inFlight.delete(id));
    state.inFlight.set(id, run);
  }
  return run;
}

async function runSync(id: string): Promise<SyncResult> {
  const repo = await findSyncRepository(id);
  if (!repo) throw new DomainError("NOT_FOUND", "That repository doesn't exist.");
  const at = new Date();
  let result: SyncResult;
  try {
    const snapshot = await fetchRepositorySnapshot(repo.owner, repo.name);
    await saveSnapshot(id, repo.projectId, snapshot, snapshotActivity(snapshot), at);
    return { ok: true };
  } catch (error) {
    if (error instanceof GitHubError) {
      result = { ok: false, error: error.message, kind: error.kind, retryAt: error.retryAt };
    } else {
      console.error(`[github] sync of ${repo.owner}/${repo.name} failed`, error);
      result = {
        ok: false,
        error: "Sync failed unexpectedly; see the server log.",
        kind: "internal",
      };
    }
  }
  if (!result.ok && result.kind === "rate_limited") syncState().rateLimit = result;
  await recordSyncFailure(id, result.error, at, !sharedFailure(result));
  return result;
}

/**
 * Syncs linked repositories of non-archived projects one at a time; `due` picks which.
 * Stops early on a rate limit or rejected token, which it returns as `stoppedBy`.
 */
async function syncTargets(
  due: (repo: Awaited<ReturnType<typeof listSyncTargets>>[number]) => boolean,
) {
  let synced = 0;
  let failed = 0;
  for (const repo of await listSyncTargets()) {
    if (!due(repo)) continue;
    const result = await syncRepository(repo.id);
    if (result.ok) synced++;
    else failed++;
    if (sharedFailure(result)) return { synced, failed, stoppedBy: result };
  }
  return { synced, failed, stoppedBy: null };
}

/** Manual "Sync all". */
export function syncAllRepositories() {
  return syncTargets(() => true);
}

/** One background pass: repositories whose next sync time (with failure backoff) has come. */
export function syncDueRepositories(intervalMs: number, now = new Date()) {
  return syncTargets((repo) => nextSyncAt(repo, intervalMs) <= now);
}

const TICK_MS = 60_000;
const scheduler = globalThis as unknown as { adccGitHubSync?: { pausedUntil: number } };

/**
 * Starts background sync once per process (called from instrumentation.ts). Off when there's
 * no token or GITHUB_SYNC_INTERVAL_MINUTES is 0. Pauses until the reset time on a rate limit,
 * and until restart on a rejected token (a new token means editing .env and restarting).
 */
export function startBackgroundSync() {
  const { GITHUB_TOKEN, GITHUB_SYNC_INTERVAL_MINUTES } = getEnv();
  if (!GITHUB_TOKEN || GITHUB_SYNC_INTERVAL_MINUTES === 0 || scheduler.adccGitHubSync) return;
  const state = { pausedUntil: 0, running: false };
  scheduler.adccGitHubSync = state;
  const intervalMs = GITHUB_SYNC_INTERVAL_MINUTES * 60_000;

  const tick = async () => {
    if (state.running || Date.now() < state.pausedUntil) return;
    state.running = true;
    try {
      const { stoppedBy } = await syncDueRepositories(intervalMs);
      if (stoppedBy && !stoppedBy.ok) {
        state.pausedUntil = stoppedBy.retryAt?.getTime() ?? Infinity;
        console.warn(`[github] background sync paused: ${stoppedBy.error}`);
      }
    } catch (error) {
      // Usually the database being down; the next tick tries again.
      console.error("[github] background sync pass failed", error);
    } finally {
      state.running = false;
    }
  };
  setInterval(() => void tick(), TICK_MS).unref();
}
