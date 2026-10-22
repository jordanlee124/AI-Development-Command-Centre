import { expect, test, type Locator, type Page } from "@playwright/test";
import { axeViolations, clickUntilOpen, createProject } from "./helpers";

// GitHub here is the loopback mock serving recorded fixtures (e2e/github-mock.ts); rows go to
// the adcc_e2e database. Nothing reaches the real GitHub.
const run = Date.now().toString(36);

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const health = await (await request.get("/api/health")).json();
  test.skip(health.status !== "ok", "Postgres is not running; database flows skipped.");
});

/** Page content only: while a page streams in, React parks the next chunk in a hidden div
 * outside <main>, so unscoped queries can briefly match twice. */
const main = (page: Page) => page.locator("#main");

/** The button does nothing before hydration; click until the sync's result shows. */
async function refreshUntil(page: Page, shown: Locator) {
  await expect(async () => {
    await main(page).getByRole("button", { name: "Refresh" }).click();
    await expect(shown).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 20_000 });
}

test("connect, link, sync and browse a repository", async ({ page }) => {
  const project = `GitHub project ${run}`;
  await createProject(page, project);

  await page.goto("/github");
  await expect(main(page).getByRole("link", { name: "@octocat" })).toBeVisible();
  await expect(main(page).getByText("4,932 of 5,000", { exact: false })).toBeVisible();

  // Link an accessible repository to the project.
  const row = main(page).getByRole("row", { name: /octocat\/Hello-World/ });
  const listbox = page.getByRole("listbox");
  await clickUntilOpen(
    row.getByRole("combobox", { name: "Project for octocat/Hello-World" }),
    listbox,
  );
  await listbox.getByRole("option", { name: project }).click();
  await row.getByRole("button", { name: "Link" }).click();
  await expect(row.getByRole("link", { name: project })).toBeVisible();

  // Listed, never synced: counts are unknown, not zero.
  const linked = main(page).getByRole("row", { name: /octocat\/hello-world/ });
  await expect(linked.getByText("Not synced")).toBeVisible();
  await linked.getByRole("link", { name: "octocat/hello-world", exact: true }).click();
  await expect(
    main(page).getByRole("heading", { level: 1, name: "octocat/hello-world" }),
  ).toBeVisible();
  await expect(main(page).getByText("Not synced yet")).toBeVisible();

  await refreshUntil(page, main(page).getByRole("heading", { name: "Pull requests" }));

  const pr = main(page).getByRole("row", { name: /#11593/ });
  await expect(pr.getByText("Approved", { exact: true })).toBeVisible();
  await expect(
    main(page)
      .getByRole("row", { name: /#11592/ })
      .getByText("No reviews"),
  ).toBeVisible();
  await expect(
    main(page)
      .getByRole("row", { name: /#11594/ })
      .getByText("Closed"),
  ).toBeVisible();
  await expect(
    main(page).getByRole("link", { name: "Running Copilot Code Review #4" }),
  ).toBeVisible();
  await expect(main(page).getByRole("link", { name: /Merge pull request #6/ })).toBeVisible();
  await expect(main(page).getByRole("link", { name: "#11585 probe-x" })).toBeVisible();
  await expect(main(page).getByText("octocat-patch-1")).toBeVisible();
  await expect(main(page).getByText("PR #11593 opened: Добавлен файл viola.txt")).toBeVisible();

  // Re-syncing the same data adds no duplicate timeline entries.
  const entries = await main(page).getByText("PR #11593 opened").count();
  await refreshUntil(page, main(page).getByText("Synced", { exact: true }));
  await page.reload();
  await expect(main(page).getByText("PR #11593 opened")).toHaveCount(entries);

  // The project page links to the synced repository.
  await main(page).getByRole("link", { name: project }).click();
  await expect(
    main(page).getByRole("link", { name: "octocat/hello-world", exact: true }),
  ).toBeVisible();

  // Populated repository page passes axe in both themes.
  await page.goto("/github");
  await main(page).getByRole("link", { name: "octocat/hello-world", exact: true }).click();
  for (const theme of ["dark", "light"]) {
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    expect(await axeViolations(page)).toEqual([]);
  }
});

test("a repository GitHub can't find shows its sync error", async ({ page }) => {
  await createProject(page, `GitHub missing ${run}`);
  await main(page).getByLabel("Link a GitHub repository").fill(`octocat/missing-${run}`);
  await main(page).getByRole("button", { name: "Link", exact: true }).click();
  await main(page)
    .getByRole("link", { name: `octocat/missing-${run}` })
    .click();

  const alert = main(page).getByRole("alert").filter({ hasText: "Last sync failed" });
  await refreshUntil(page, alert);
  await expect(alert).toContainText("returned 404");
  await expect(main(page).getByText("Sync failed", { exact: true })).toBeVisible();
  // Nothing was ever synced, so there is no stale data to show.
  await expect(main(page).getByText("Not synced yet")).toBeVisible();

  await page.goto("/github");
  await expect(
    main(page)
      .getByRole("row", { name: new RegExp(`octocat/missing-${run}`) })
      .getByText("Sync failed"),
  ).toBeVisible();
});
