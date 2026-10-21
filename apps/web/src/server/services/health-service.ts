import { buildHealthReport, type HealthCheck, type HealthReport } from "@/domain/health";
import { pingDatabase } from "@/server/db/client";

export async function checkHealth(): Promise<HealthReport> {
  const checks = [await runCheck("database", pingDatabase)];
  return buildHealthReport(checks, new Date());
}

async function runCheck(name: string, probe: () => Promise<void>): Promise<HealthCheck> {
  const start = performance.now();
  const latency = () => Math.round(performance.now() - start);
  try {
    await probe();
    return { name, status: "up", latencyMs: latency() };
  } catch (error) {
    console.error(`[health] ${name} check failed`, error);
    const message = (error instanceof Error ? error.message : String(error)).trim();
    return { name, status: "down", latencyMs: latency(), error: message };
  }
}
