import { expect, test, type Page } from "@playwright/test";
import { axeViolations, clickUntilOpen, createProject, openDialog } from "./helpers";

// Writes real rows to the separate adcc_e2e database (see global-setup.ts), never the dev one.
// Every name carries a run id so reruns and parallel files can't collide.
const run = Date.now().toString(36);

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const health = await (await request.get("/api/health")).json();
  test.skip(health.status !== "ok", "Postgres is not running; database flows skipped.");
});

async function createTask(page: Page, title: string, dependsOn: string[] = []) {
  const dialog = await openDialog(page, "New task", "New task");
  await dialog.getByLabel("Title").fill(title);
  for (const name of dependsOn) await dialog.getByRole("checkbox", { name }).check();
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();
}

const column = (page: Page, label: string) =>
  page.locator("section[data-column]").filter({ has: page.getByRole("heading", { name: label }) });

test("create, edit, archive and delete a project", async ({ page }) => {
  const name = `E2E project ${run}`;
  await createProject(page, name, `D:\\e2e\\${run}`);

  // Edit: a bad folder is refused and what was typed is kept.
  const edit = await openDialog(page, "Edit", "Edit project");
  await edit.getByLabel("Description").fill("Fixture project for e2e.");
  await edit.getByLabel("Local folder").fill("relative\\folder");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit.getByText(/absolute Windows folder path/)).toBeVisible();
  await expect(edit.getByLabel("Description")).toHaveValue("Fixture project for e2e.");
  await edit.getByLabel("Local folder").fill(`D:\\e2e\\${run}-renamed`);
  await edit.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "On hold" }).click();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText("Fixture project for e2e.")).toBeVisible();
  await expect(page.getByText("On hold").first()).toBeVisible();

  // Repository association and milestone.
  await page.getByLabel("Link a GitHub repository").fill(`E2E-Owner/repo-${run}`);
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await expect(page.getByText(`e2e-owner/repo-${run}`, { exact: true })).toBeVisible();

  const milestone = await openDialog(page, "New milestone", "New milestone");
  await milestone.getByLabel("Title").fill("First release");
  await milestone.getByLabel("Due date").fill("2026-12-01");
  await milestone.getByRole("button", { name: "Create milestone" }).click();
  await expect(milestone).toBeHidden();
  await expect(page.getByText("First release", { exact: true })).toBeVisible();

  // Archive: read-only, then delete with typed confirmation.
  await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText(/archived, so it is read-only/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New task" })).toHaveCount(0);

  await page.getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog");
  await confirm.getByLabel(/Type .* to confirm/).fill("wrong name");
  await confirm.getByRole("button", { name: "Delete project" }).click();
  await expect(confirm.getByText(/Type the project name exactly/)).toBeVisible();
  await confirm.getByLabel(/Type .* to confirm/).fill(name);
  await confirm.getByRole("button", { name: "Delete project" }).click();
  await expect(page).toHaveURL("/projects");

  await page.goto("/activity");
  // Scoped to #main: while a page streams in, React parks the next chunk in a hidden div
  // outside it, so an unscoped query can briefly match twice.
  await expect(page.locator("#main").getByText(`Deleted project ${name}`)).toBeVisible();
});

test("tasks: dependencies block the board until finished; comments and history", async ({
  page,
}) => {
  await createProject(page, `E2E board ${run}`);
  const projectUrl = page.url();
  await createTask(page, `Design schema ${run}`);
  await createTask(page, `Write parser ${run}`, [`Design schema ${run}`]);

  const parser = page.locator("li[data-task-id]").filter({ hasText: `Write parser ${run}` });
  const design = page.locator("li[data-task-id]").filter({ hasText: `Design schema ${run}` });
  await expect(parser.getByText("Blocked")).toBeVisible();

  // Blocked: the move is refused and the card returns to To do.
  await parser.getByRole("button", { name: `Move Write parser ${run}` }).click();
  await page.getByRole("menuitemradio", { name: "In progress" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /waiting on/ })).toBeVisible();
  await expect(
    column(page, "To do").locator("li", { hasText: `Write parser ${run}` }),
  ).toBeVisible();

  // Drag the dependency to Completed; the parser is no longer blocked and can start.
  // The card moves at once (optimistic); wait for the server's confirmation before reloading.
  await design.dragTo(column(page, "Completed"));
  await expect(column(page, "Completed").getByText(`Design schema ${run}`)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Moved Design schema/ })).toBeVisible();
  await page.reload();
  await expect(parser.getByText("Blocked")).toHaveCount(0);
  await clickUntilOpen(
    parser.getByRole("button", { name: `Move Write parser ${run}` }),
    page.getByRole("menuitemradio", { name: "In progress" }),
  );
  await page.getByRole("menuitemradio", { name: "In progress" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Moved Write parser/ })).toBeVisible();
  await page.reload();
  await expect(column(page, "In progress").getByText(`Write parser ${run}`)).toBeVisible();

  // Task page: edit, comment, history.
  await page.getByRole("link", { name: `Write parser ${run}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Write parser ${run}` })).toBeVisible();
  const edit = await openDialog(page, "Edit", "Edit task");
  await edit.getByRole("combobox", { name: "Priority" }).click();
  await page.getByRole("option", { name: "Urgent" }).click();
  await edit.getByRole("combobox", { name: "AI provider" }).click();
  await page.getByRole("option", { name: "Claude Code" }).click();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();

  await page.getByLabel("Add a comment").fill("Parser handles unknown records.");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByText("Parser handles unknown records.")).toBeVisible();
  await expect(page.getByLabel("Add a comment")).toHaveValue("");

  const history = page.locator("ol").filter({ hasText: "Created task" });
  await expect(
    history.getByText("Priority: Medium → Urgent; AI provider: none → Claude Code"),
  ).toBeVisible();
  await expect(history.getByText(`Moved Write parser ${run} to In progress`)).toBeVisible();
  await expect(history.getByText(`Commented on Write parser ${run}`)).toBeVisible();

  // Filters on the Tasks page.
  await page.goto(`/tasks?q=${encodeURIComponent(`parser ${run}`)}&priority=URGENT`);
  await expect(page.getByRole("link", { name: `Write parser ${run}` })).toBeVisible();
  await expect(page.getByRole("link", { name: `Design schema ${run}` })).toHaveCount(0);
  await page.goto(`/tasks?q=${run}&status=DONE`);
  await expect(page.getByRole("link", { name: `Design schema ${run}` })).toBeVisible();
  await expect(page.getByRole("link", { name: `Write parser ${run}` })).toHaveCount(0);

  await page.goto(projectUrl);
  await expect(page.getByText(/50%/).first()).toBeVisible();
});

test("project and task pages and their dialogs pass axe in both themes", async ({ page }) => {
  await createProject(page, `E2E axe ${run}`);
  await createTask(page, `Axe task ${run}`);
  const projectUrl = page.url();
  await page.getByRole("link", { name: `Axe task ${run}` }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  const taskUrl = page.url();

  for (const theme of ["dark", "light"]) {
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    for (const url of [projectUrl, taskUrl]) {
      await page.goto(url);
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      expect(await axeViolations(page)).toEqual([]);
    }
    await openDialog(page, "Edit", "Edit task");
    expect(await axeViolations(page, '[role="dialog"]')).toEqual([]);
  }
});

test("unknown or malformed ids show the not-found page", async ({ page }) => {
  await page.goto("/projects/not-a-uuid");
  await expect(page.getByText("Page not found")).toBeVisible();
  await page.goto("/tasks/0199f3a0-0000-7000-8000-000000000000");
  await expect(page.getByText("Page not found")).toBeVisible();
});
