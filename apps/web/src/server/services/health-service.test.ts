import { beforeEach, describe, expect, it, vi } from "vitest";
import { pingDatabase } from "@/server/db/client";
import { checkHealth } from "./health-service";

vi.mock("@/server/db/client", () => ({ pingDatabase: vi.fn() }));

describe("checkHealth", () => {
  beforeEach(() => {
    vi.mocked(pingDatabase).mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reports ok when the database answers", async () => {
    vi.mocked(pingDatabase).mockResolvedValue();
    const report = await checkHealth();
    expect(report.status).toBe("ok");
    expect(report.checks).toEqual([
      { name: "database", status: "up", latencyMs: expect.any(Number) },
    ]);
  });

  it("reports degraded with the error when the database is unreachable", async () => {
    vi.mocked(pingDatabase).mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    const report = await checkHealth();
    expect(report.status).toBe("degraded");
    expect(report.checks[0]).toMatchObject({
      name: "database",
      status: "down",
      error: "connect ECONNREFUSED 127.0.0.1:5432",
    });
  });
});
