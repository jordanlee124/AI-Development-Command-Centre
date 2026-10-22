import { readFileSync } from "node:fs";
import type { IngestRequest, SessionBatch } from "@adcc/shared";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { newTranscriptState, parseTranscriptLines } from "../../bridge/src/claude-transcript.ts";
import { E2E_BRIDGE_TOKEN } from "../playwright.config";
import { axeViolations, clickUntilOpen } from "./helpers";

// The bridge's real parser reads its redacted fixture transcript; the usage goes through the real
// ingest API into adcc_e2e. The model id is unique per run so prices and rows never collide with
// other specs' usage. The price entered below is a fixture, not a real provider rate.
const run = Date.now().toString(36);
const MODEL = `e2e-model-${run}`;
const SESSION = `0b1e2c3d-4f50-4a6b-8c7d-${run.padStart(12, "0").slice(-12)}`;

test.describe.configure({ mode: "serial" });

const main = (page: Page) => page.locator("#main");
// Rows whose first cell is the model (the session table also names it, in a later cell).
const modelRow = (page: Page) => main(page).getByRole("row", { name: new RegExp(`^${MODEL} `) });

let recordedTokens = 0;

function batch(
  sessionId = SESSION,
  model = MODEL,
  times: (index: number) => string = () => new Date(Date.now() - 60_000).toISOString(),
): SessionBatch {
  const text = readFileSync(
    new URL("../../bridge/src/__fixtures__/claude-session.jsonl", import.meta.url),
    "utf8",
  );
  const lines = text.split("\n").map((line, i) => ({ text: line, lineNo: i + 1 }));
  const { events, skipped } = parseTranscriptLines(lines, newTranscriptState());
  // By default recent, so it falls in the default 30-day range. Unique ids so nothing counts as
  // a repeat of another run's usage. `times` gets the index of the usage record so far.
  let responses = 0;
  return {
    source: "CLAUDE_CODE",
    sessionId,
    sourcePath: `C:\\Users\\e2e\\.claude\\projects\\x\\${sessionId}.jsonl`,
    cwd: `D:\\e2e\\analytics-${run}`,
    gitBranch: null,
    title: `Analytics fixture ${run}`,
    details: [],
    skippedRecords: skipped,
    events: events.map((e) => ({
      ...e,
      externalId: `${e.externalId}:${sessionId}`,
      occurredAt: times(e.usage ? responses++ : responses),
      usage: e.usage && { ...e.usage, model },
    })),
  };
}

test.beforeAll(async ({ request }) => {
  const health = await (await request.get("/api/health")).json();
  test.skip(health.status !== "ok", "Postgres is not running; database flows skipped.");
  const session = batch();
  for (const e of session.events) {
    const u = e.usage;
    if (u) {
      recordedTokens +=
        u.inputTokens + u.outputTokens + u.reasoningTokens + u.cacheReadTokens + u.cacheWriteTokens;
    }
  }
  await ingest(request, [session]);
});

async function ingest(request: APIRequestContext, sessions: SessionBatch[]) {
  const now = new Date().toISOString();
  const body: IngestRequest = {
    bridge: {
      version: "0.1.0",
      pollSeconds: 10,
      approvedFolders: ["D:\\e2e"],
      live: { ok: true, checkedAt: now, sessions: [] },
      providers: [],
      errors: [],
    },
    sessions,
  };
  const response = await request.post("/api/bridge/ingest", {
    data: body,
    headers: { authorization: `Bearer ${E2E_BRIDGE_TOKEN}` },
  });
  expect(response.status()).toBe(200);
}

test("recorded usage shows by model, unpriced, never as $0", async ({ page }) => {
  await page.goto("/analytics");
  const row = modelRow(page);
  await expect(row.getByRole("cell").nth(6)).toHaveText(recordedTokens.toLocaleString("en-US"));
  await expect(row.getByRole("cell").last()).toHaveText("No price");
  await expect(row).toContainText("No price for this model on this date");
  await expect(main(page).getByText("Billed cost · not available")).toBeVisible();
  await expect(
    main(page)
      .getByRole("heading", { name: "Missing data" })
      .locator("xpath=ancestor::*[@data-slot='card']"),
  ).toContainText("have no cost estimate");
});

test("a price added for the model gives an estimate, and deleting it takes it away", async ({
  page,
}) => {
  await page.goto("/analytics/settings");
  const unpriced = main(page).getByRole("listitem").filter({ hasText: MODEL });
  await expect(unpriced).toContainText(`${recordedTokens.toLocaleString("en-US")} tokens recorded`);
  await clickUntilOpen(
    unpriced.getByRole("button", { name: `Add price for ${MODEL}` }),
    page.getByRole("dialog", { name: "Add a price" }),
  );
  const dialog = page.getByRole("dialog", { name: "Add a price" });
  await expect(dialog.getByLabel("Model")).toHaveValue(MODEL);
  await dialog.getByLabel("Effective from").fill("2026-01-01");
  // $1 per million tokens of every kind, so the estimate is tokens / 1,000,000.
  for (const label of ["Input", "Output", "Cache read", "Cache write", "Reasoning / thinking"]) {
    await dialog.getByLabel(label, { exact: true }).fill("1");
  }
  await dialog.getByLabel("Source").fill(`e2e fixture price ${run}`);
  expect(await axeViolations(page, '[role="dialog"]')).toEqual([]);
  await dialog.getByRole("button", { name: "Add price" }).click();
  await expect(dialog).toBeHidden();

  const version = modelRow(page);
  await expect(version).toContainText(`e2e fixture price ${run}`);
  await expect(version).toContainText("now");
  await expect(unpriced).toHaveCount(0);

  await page.goto("/analytics");
  const row = modelRow(page);
  // tokens × $1 per million, to the cent; the currency sign depends on the server's locale.
  await expect(row.getByRole("cell").last()).toContainText((recordedTokens / 1_000_000).toFixed(2));
  await expect(row).not.toContainText("No price");

  await page.goto("/analytics/settings");
  await clickUntilOpen(
    main(page).getByRole("button", { name: `Delete price for ${MODEL} from 2026-01-01` }),
    page.getByRole("alertdialog"),
  );
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete price" }).click();
  await expect(modelRow(page)).toHaveCount(0);
  await expect(main(page).getByRole("listitem").filter({ hasText: MODEL })).toBeVisible();
});

test("a price version starting the same day is refused", async ({ page }) => {
  await page.goto("/analytics/settings");
  for (const attempt of [1, 2]) {
    const dialog = page.getByRole("dialog", { name: "Add a price" });
    await clickUntilOpen(main(page).getByRole("button", { name: "Add price" }).first(), dialog);
    await dialog.getByLabel("Model").fill(`${MODEL}-dup`);
    await dialog.getByLabel("Effective from").fill("2026-02-01");
    await dialog.getByLabel("Input", { exact: true }).fill("1");
    await dialog.getByLabel("Output", { exact: true }).fill("2");
    await dialog.getByLabel("Source").fill("e2e fixture price");
    await dialog.getByRole("button", { name: "Add price" }).click();
    if (attempt === 1) await expect(dialog).toBeHidden();
    else await expect(dialog.getByText("already has a price starting that day")).toBeVisible();
  }
});

test("budgets and billing type are saved and shown against this month", async ({ page }) => {
  await page.goto("/analytics/settings");
  const tokens = main(page).getByLabel("Recorded tokens");
  await tokens.fill("1");
  await main(page).getByLabel("Warn at (%)").fill("50");
  await main(page).getByRole("button", { name: "Save" }).click();
  await expect(main(page).getByText("Saved.")).toBeVisible();

  await page.goto("/analytics");
  const budget = main(page)
    .getByRole("heading", { name: "Monthly budget" })
    .locator("xpath=ancestor::*[@data-slot='card']");
  await expect(budget).toContainText("Budget reached");
  await expect(budget).toContainText("Warns at 50%");
  await expect(budget.getByRole("progressbar")).toBeVisible();

  // Put it back, so the page reads "no budget" for anyone running it next.
  await page.goto("/analytics/settings");
  await main(page).getByLabel("Recorded tokens").fill("");
  await main(page).getByLabel("Warn at (%)").fill("80");
  await main(page).getByRole("button", { name: "Save" }).click();
  await expect(main(page).getByText("Saved.")).toBeVisible();
});

test("invalid budget input is refused with a message", async ({ page }) => {
  await page.goto("/analytics/settings");
  await main(page).getByLabel("Estimated cost (USD)").fill("lots");
  await main(page).getByRole("button", { name: "Save" }).click();
  await expect(main(page).getByText("Enter a number, or leave blank for no budget")).toBeVisible();
});

test("CSV export holds the range's rows, with cost labelled an estimate", async ({ request }) => {
  const response = await request.get("/analytics/export");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/csv");
  expect(response.headers()["content-disposition"]).toMatch(/attachment; filename="adcc-usage-/);
  const csv = await response.text();
  expect(csv.split("\r\n")[0]).toContain("estimated_api_equivalent_cost_usd");
  const line = csv.split("\r\n").find((l) => l.includes(`,${MODEL},`));
  expect(line).toContain(`,${recordedTokens},`);
  expect(line).toMatch(/No price for this model on this date$/);
});

test("range and period controls change the trend, and a bad range says so", async ({ page }) => {
  await page.goto("/analytics");
  await main(page).getByRole("link", { name: "Weekly" }).click();
  await expect(page).toHaveURL(/period=week/);
  await expect(main(page).getByRole("link", { name: "Weekly" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.goto("/analytics?from=2026-02-30");
  await expect(main(page).getByRole("status").first()).toContainText("isn't valid");
});

for (const theme of ["dark", "light"] as const) {
  test(`analytics pages with data have no WCAG A/AA violations (${theme})`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    for (const path of ["/analytics", "/analytics/settings"]) {
      await page.goto(path);
      await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    }
  });
}

test("days are calendar days in the server's time zone, in SQL as on the page", async ({
  page,
  request,
}) => {
  // playwright.config.ts runs the server with TZ=Asia/Seoul (UTC+9). 14:59 and 15:01 UTC are
  // 23:59 on 1 Oct and 00:01 on 2 Oct there: two days, though in UTC they'd be one.
  const model = `${MODEL}-tz`;
  const half = (i: number) =>
    i % 2 === 0 ? "2026-10-01T14:59:00.000Z" : "2026-10-01T15:01:00.000Z";
  await ingest(request, [batch(`tz-${run}`, model, half)]);

  const csv = await (await request.get("/analytics/export?from=2026-10-01&to=2026-10-02")).text();
  const days = csv
    .split("\r\n")
    .filter((line) => line.includes(`,${model},`))
    .map((line) => line.slice(0, 10));
  expect(days.sort()).toEqual(["2026-10-01", "2026-10-02"]);

  await page.goto("/analytics?from=2026-10-01&to=2026-10-02");
  await expect(main(page).getByText("Days are calendar days in Asia/Seoul.")).toBeVisible();
});
