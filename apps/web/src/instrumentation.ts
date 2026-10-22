// Runs once at server start: refuse to boot with invalid configuration, then start background
// GitHub sync (a no-op without a token or with the interval set to 0).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("@/server/env");
    getEnv();
    const { startBackgroundSync } = await import("@/server/services/github-service");
    startBackgroundSync();
  }
}
