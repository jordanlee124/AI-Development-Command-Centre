export type CheckStatus = "up" | "down";

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  latencyMs: number;
  error?: string;
}

export interface HealthReport {
  status: "ok" | "degraded";
  timestamp: string;
  checks: HealthCheck[];
}

export function buildHealthReport(checks: HealthCheck[], now: Date): HealthReport {
  return {
    status: checks.every((check) => check.status === "up") ? "ok" : "degraded",
    timestamp: now.toISOString(),
    checks,
  };
}
