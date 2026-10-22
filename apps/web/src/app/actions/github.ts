"use server";

import { syncAllRepositories, syncRepository } from "@/server/services/github-service";
import { mutate, type ActionState } from "./mutate";

// Sync failures are recorded on the repository, so the page refreshes either way and the
// error is also shown next to the button.

export async function refreshRepositoryAction(repositoryId: string): Promise<ActionState> {
  let failure: string | null = null;
  const state = await mutate(async () => {
    const result = await syncRepository(repositoryId);
    if (!result.ok) failure = result.error;
  });
  return failure ? { ok: false, error: failure } : state;
}

export async function refreshAllRepositoriesAction(): Promise<ActionState> {
  let failure: string | null = null;
  const state = await mutate(async () => {
    const { synced, failed, stoppedBy } = await syncAllRepositories();
    if (stoppedBy && !stoppedBy.ok) failure = stoppedBy.error;
    else if (failed > 0) failure = `${failed} of ${synced + failed} repositories failed to sync.`;
  });
  return failure ? { ok: false, error: failure } : state;
}
