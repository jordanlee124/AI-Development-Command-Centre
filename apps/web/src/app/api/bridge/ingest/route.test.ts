import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEnv } from "@/server/env";
import { ingestBridgeReport } from "@/server/services/agent-service";
import { POST } from "./route";

vi.mock("@/server/env", () => ({ getEnv: vi.fn() }));
vi.mock("@/server/services/agent-service", () => ({ ingestBridgeReport: vi.fn() }));

const TOKEN = "t".repeat(40);

const report = {
  bridge: {
    version: "0.1.0",
    pollSeconds: 10,
    approvedFolders: ["D:\\Projects"],
    live: { ok: true, checkedAt: "2026-10-22T00:00:00.000Z", sessions: [] },
    providers: [],
    errors: [],
  },
  sessions: [],
};

function post(body: unknown, authorization: string | null = `Bearer ${TOKEN}`, withLength = true) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization) headers.set("authorization", authorization);
  if (withLength) headers.set("content-length", String(Buffer.byteLength(text)));
  return POST(
    new Request("http://127.0.0.1:3000/api/bridge/ingest", { method: "POST", headers, body: text }),
  );
}

beforeEach(() => {
  vi.mocked(getEnv).mockReturnValue({ ADCC_BRIDGE_TOKEN: TOKEN } as ReturnType<typeof getEnv>);
  vi.mocked(ingestBridgeReport).mockResolvedValue({ sessions: 0, insertedEvents: 0 });
});

describe("POST /api/bridge/ingest", () => {
  it("is off (503) when no bridge token is configured", async () => {
    vi.mocked(getEnv).mockReturnValue({} as ReturnType<typeof getEnv>);
    expect((await post(report)).status).toBe(503);
    expect(ingestBridgeReport).not.toHaveBeenCalled();
  });

  it.each([
    ["no header", null],
    ["a wrong token", `Bearer ${"x".repeat(40)}`],
    ["a prefix of the token", `Bearer ${TOKEN.slice(0, 20)}`],
    ["another scheme", `Basic ${TOKEN}`],
  ])("refuses %s with 401 and doesn't echo it", async (_, authorization) => {
    const response = await post(report, authorization);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("x".repeat(10));
    expect(ingestBridgeReport).not.toHaveBeenCalled();
  });

  it("refuses a body without a length (411) or too large (413), unread", async () => {
    expect((await post(report, undefined, false)).status).toBe(411);
    expect((await post("x".repeat(8 * 1024 * 1024 + 1))).status).toBe(413);
    expect(ingestBridgeReport).not.toHaveBeenCalled();
  });

  it("refuses bodies that aren't JSON or don't match the contract", async () => {
    expect((await post("{not json")).status).toBe(400);
    const response = await post({ ...report, sessions: [{ sessionId: "../../etc" }] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/sessions\.0/);
    expect(ingestBridgeReport).not.toHaveBeenCalled();
  });

  it("refuses free text the contract doesn't allow, such as a long summary", async () => {
    const event = {
      externalId: "e1",
      type: "tool.use",
      occurredAt: "2026-10-22T00:00:00.000Z",
      sourceLine: 1,
      summary: "x".repeat(501),
      code: null,
      usage: null,
    };
    const batch = {
      sessionId: "s1",
      sourcePath: "C:\\x.jsonl",
      cwd: null,
      gitBranch: null,
      title: null,
      skippedRecords: 0,
      events: [event],
    };
    expect((await post({ ...report, sessions: [batch] })).status).toBe(400);
  });

  it("stores a valid report", async () => {
    const response = await post(report);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, sessions: 0, insertedEvents: 0 });
    expect(ingestBridgeReport).toHaveBeenCalledWith(report);
  });

  it("answers 500 without details when storing fails", async () => {
    vi.mocked(ingestBridgeReport).mockRejectedValue(new Error("connect ECONNREFUSED"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post(report);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("ECONNREFUSED");
  });
});
