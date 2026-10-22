import { readFileSync } from "node:fs";
import type { IngestRequest, SessionBatch } from "@adcc/shared";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { newTranscriptState, parseTranscriptLines } from "../../bridge/src/claude-transcript.ts";
import { newRolloutState, parseRolloutLines } from "../../bridge/src/codex-rollout.ts";
import { E2E_BRIDGE_TOKEN } from "../playwright.config";
import { axeViolations, createProject } from "./helpers";

// The bridge's real parser reads its real, redacted fixture transcript, and the result goes
// through the real ingest API into the adcc_e2e database. Nothing reads this machine's sessions.
const run = Date.now().toString(36);
const folder = `D:\\e2e\\agents-${run}`;
const LIVE = "0b1e2c3d-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const IDLE = "0b1e2c3d-4f50-4a6b-8c7d-000000000002";
// Unique per run: Codex sessions are keyed by the id inside the file, which is fixed.
const CODEX = `codex-${run}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const health = await (await request.get("/api/health")).json();
  test.skip(health.status !== "ok", "Postgres is not running; database flows skipped.");
});

const main = (page: Page) => page.locator("#main");

function fixtureBatch(sessionId: string, take?: number): SessionBatch {
  const text = readFileSync(
    new URL("../../bridge/src/__fixtures__/claude-session.jsonl", import.meta.url),
    "utf8",
  );
  const lines = text
    .split("\n")
    .slice(0, take)
    .map((line, i) => ({ text: line, lineNo: i + 1 }));
  const state = newTranscriptState();
  const { events, skipped } = parseTranscriptLines(lines, state);
  return {
    source: "CLAUDE_CODE",
    sessionId,
    sourcePath: `C:\\Users\\e2e\\.claude\\projects\\x\\${sessionId}.jsonl`,
    cwd: folder,
    gitBranch: state.gitBranch,
    title: take ? null : state.title,
    details: [],
    skippedRecords: skipped,
    events,
  };
}

function codexBatch(): SessionBatch {
  const text = readFileSync(
    new URL("../../bridge/src/__fixtures__/codex-session.jsonl", import.meta.url),
    "utf8",
  );
  const lines = text
    .split("\n")
    .slice(0, -1)
    .map((line, i) => ({ text: line, lineNo: i + 1 }));
  const state = newRolloutState();
  const { events, skipped } = parseRolloutLines(lines, state);
  return {
    source: "CODEX",
    sessionId: CODEX,
    sourcePath: `C:\\Users\\e2e\\.codex\\sessions\\rollout-${CODEX}.jsonl`,
    cwd: folder,
    gitBranch: state.meta?.gitBranch ?? null,
    title: `Codex fixture ${run}`,
    details: state.meta?.details ?? [],
    skippedRecords: skipped,
    // The fixture's response ids are fixed; make them unique per run like the session id, so
    // usage isn't treated as already counted by an earlier run's session.
    events: events.map((e) => ({ ...e, externalId: `${e.externalId}:${run}` })),
  };
}

function report(sessions: SessionBatch[]): IngestRequest {
  const now = new Date().toISOString();
  return {
    bridge: {
      version: "0.1.0",
      pollSeconds: 10,
      approvedFolders: ["D:\\e2e"],
      live: {
        ok: true,
        checkedAt: now,
        sessions: [
          { sessionId: LIVE, cwd: folder, kind: "interactive", status: "busy", startedAt: now },
        ],
      },
      providers: [
        { source: "CLAUDE_CODE", dataDir: "C:\\e2e\\.claude\\projects", files: 2, error: null },
        {
          source: "CODEX",
          dataDir: "C:\\e2e\\.codex\\sessions",
          files: 0,
          error: "Can't read the Codex sessions folder C:\\e2e\\.codex\\sessions: ENOENT",
        },
      ],
      errors: [],
    },
    sessions,
  };
}

async function ingest(request: APIRequestContext, body: IngestRequest, token = E2E_BRIDGE_TOKEN) {
  return request.post("/api/bridge/ingest", {
    data: body,
    headers: { authorization: `Bearer ${token}` },
  });
}

test("the bridge API refuses a wrong token", async ({ request }) => {
  const response = await ingest(request, report([]), "x".repeat(40));
  expect(response.status()).toBe(401);
});

test("sessions from the bridge show status, model, tokens, errors and timeline", async ({
  page,
  request,
}) => {
  const project = `Agents project ${run}`;
  await createProject(page, project, folder);

  const sessions = [fixtureBatch(LIVE), fixtureBatch(IDLE, 4)];
  const first = await ingest(request, report(sessions));
  expect(first.status()).toBe(200);
  expect((await first.json()).insertedEvents).toBe(9);
  // Re-sending the same data (e.g. after a bridge restart) adds nothing.
  expect((await (await ingest(request, report(sessions))).json()).insertedEvents).toBe(0);

  await page.goto("/agents");
  await expect(main(page).getByText("Connected", { exact: true })).toBeVisible();
  const live = main(page).getByRole("row", { name: /Fixture session title/ });
  await expect(live.getByText("Running · Busy")).toBeVisible();
  await expect(live.getByText("claude-opus-5-5")).toBeVisible();
  await expect(live.getByRole("link", { name: project })).toBeVisible();
  const idle = main(page).getByRole("row", { name: new RegExp(IDLE) });
  await expect(idle.getByText("Not running")).toBeVisible();
  // The second session repeats the first one's opening response, as a fork's transcript does:
  // that response's tokens stay counted once, with the first session.
  await expect(idle.getByText("Not available")).toHaveCount(2); // model and tokens
  expect(await axeViolations(page)).toEqual([]);

  await live.getByRole("link", { name: "Fixture session title" }).click();
  await expect(
    main(page).getByRole("heading", { level: 1, name: "Fixture session title" }),
  ).toBeVisible();
  // Two responses, each stored once though the transcript repeats usage per content block.
  const usage = main(page).getByRole("row", { name: /claude-opus-5-5/ });
  await expect(usage.getByRole("cell").nth(1)).toHaveText("2");
  await expect(usage.getByRole("cell").nth(3)).toHaveText("501"); // 176 + 325 output
  await expect(usage.getByRole("cell").nth(4)).toHaveText("231"); // 94 + 137 thinking
  await expect(main(page).getByText("Bash: Exit code 1").first()).toBeVisible();
  await expect(main(page).getByText("You've hit your session limit").first()).toBeVisible();
  await expect(main(page).getByText("2 records not recognised and skipped")).toBeVisible();
  await expect(main(page).getByText(/\b7 events from/)).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("Codex sessions show beside Claude Code, filtered by tool, with their own details", async ({
  page,
  request,
}) => {
  const response = await ingest(request, report([codexBatch()]));
  expect(response.status()).toBe(200);
  expect((await response.json()).insertedEvents).toBe(17);

  await page.goto("/agents");
  // One provider failing is shown on its own; the other keeps working.
  await expect(main(page).getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(main(page).getByText(/Codex sessions folder .*ENOENT/)).toBeVisible();
  const codex = main(page).getByRole("row", { name: new RegExp(`Codex fixture ${run}`) });
  await expect(codex.getByText("Codex", { exact: true })).toBeVisible();
  // Codex has no live check, so it is never shown as running.
  await expect(codex.getByText("Unverified")).toBeVisible();
  await expect(codex.getByText("gpt-6-astra")).toBeVisible(); // the latest-used model
  await expect(codex.getByText("+1 more")).toBeVisible();

  await main(page)
    .getByRole("link", { name: /^Codex \d+$/ })
    .click();
  await expect(page).toHaveURL(/source=CODEX/);
  await expect(codex).toBeVisible();
  await expect(main(page).getByRole("row", { name: /Fixture session title/ })).toHaveCount(0);
  await expect(main(page).getByText("Codex has no supported live session check")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  await codex.getByRole("link", { name: `Codex fixture ${run}` }).click();
  await expect(main(page).getByText("Codex session", { exact: true })).toBeVisible();
  await expect(main(page).getByText("Codex Desktop")).toBeVisible();
  await expect(main(page).getByText("Codex has no supported live session check.")).toBeVisible();
  const sol = main(page).getByRole("row", { name: /gpt-6\.1-sol/ });
  await expect(sol.getByRole("cell").nth(1)).toHaveText("2");
  await expect(sol.getByRole("cell").nth(3)).toHaveText("394"); // 127 + 267, reasoning split out
  await expect(sol.getByRole("cell").nth(4)).toHaveText("21");
  await expect(main(page).getByRole("row", { name: /gpt-6-astra/ })).toBeVisible();
  await expect(main(page).getByText("shell: exit code 1").first()).toBeVisible();
  await expect(main(page).getByText("You've hit your usage limit").first()).toBeVisible();
  await expect(main(page).getByText("Turn aborted").first()).toBeVisible();
  // The model's calls and the operations that ran are counted separately.
  const card = (name: string) =>
    main(page).locator("[data-slot=card]", { has: page.getByRole("heading", { name }) });
  const tools = card("Tools used");
  await expect(tools.getByText("collaboration.spawn_agent")).toBeVisible();
  const ops = card("Turns and operations");
  await expect(ops.getByText("Turns completed: 1 · aborted: 1 · failed: 1")).toBeVisible();
  await expect(ops.getByRole("listitem").filter({ hasText: "apply_patch" })).toContainText("2");
  await expect(main(page).getByText("2 records not recognised and skipped")).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});

test("session pages pass axe in the light theme", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("theme", "light"));
  await page.goto("/agents");
  await expect(page.locator("html")).toHaveClass(/light/);
  expect(await axeViolations(page)).toEqual([]);
  await main(page).getByRole("link", { name: "Fixture session title" }).click();
  await expect(main(page).getByRole("heading", { name: "Activity timeline" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
});
