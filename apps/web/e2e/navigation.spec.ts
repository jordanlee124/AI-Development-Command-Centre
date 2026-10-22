import { expect, test, type Page } from "@playwright/test";
import { clickUntilOpen } from "./helpers";

/** Keyboard shortcuts only work once React has hydrated; retry the key until it takes effect. */
async function pressUntil(page: Page, key: string, check: () => Promise<void>) {
  await expect(async () => {
    await page.keyboard.press(key);
    await check();
  }).toPass({ timeout: 10_000 });
}

// Must match the sidebar (src/components/app-shell/nav.ts).
const pages = [
  { link: "Overview", path: "/", heading: "Overview" },
  { link: "Projects", path: "/projects", heading: "Projects" },
  { link: "Tasks", path: "/tasks", heading: "Tasks" },
  { link: "AI Agents", path: "/agents", heading: "AI Agents" },
  { link: "GitHub", path: "/github", heading: "GitHub" },
  { link: "Analytics", path: "/analytics", heading: "Analytics" },
  { link: "Activity", path: "/activity", heading: "Activity" },
  { link: "Settings", path: "/settings", heading: "Settings" },
];

test("sidebar links reach every page and mark the current one", async ({ page }) => {
  await page.goto("/");
  const nav = page.locator('[data-slot="sidebar"]');

  for (const { link, path, heading } of pages) {
    await nav.getByRole("link", { name: link, exact: true }).click();
    await expect(page).toHaveURL(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(nav.getByRole("link", { name: link, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  }
});

test("every page shows real data, an empty state, or says data is unavailable", async ({
  page,
}) => {
  for (const { path } of pages.filter((p) => p.path !== "/settings")) {
    await page.goto(path);
    const states = page
      .getByRole("table")
      .or(page.getByRole("alert").filter({ hasText: "Data unavailable" }))
      .or(page.locator('[data-slot="empty"]'))
      .or(page.getByRole("region", { name: "Key metrics" }))
      // The activity timeline is a list, not a table.
      .or(page.locator("main ol"));
    await expect(states.first()).toBeVisible();
  }
});

test("sidebar collapses to icons, remembers it across reloads, and Ctrl+B toggles it", async ({
  page,
}) => {
  await page.goto("/");
  const sidebar = page.locator('[data-slot="sidebar"][data-state]');
  await expect(sidebar).toHaveAttribute("data-state", "expanded");

  await page.locator('[data-sidebar="trigger"]').click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");

  await page.reload();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");

  await pressUntil(page, "Control+b", () =>
    expect(sidebar).toHaveAttribute("data-state", "expanded", { timeout: 500 }),
  );
});

test("command palette opens with Ctrl+K and navigates to a page", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Search" });
  await pressUntil(page, "Control+k", () => expect(dialog).toBeVisible({ timeout: 500 }));

  await dialog.getByRole("combobox").fill("analytics");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL("/analytics");
  await expect(dialog).toBeHidden();
});

test("command palette search button opens the palette", async ({ page }) => {
  await page.goto("/");
  await clickUntilOpen(
    page.getByRole("button", { name: /Search/ }),
    page.getByRole("dialog", { name: "Search" }),
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Search" })).toBeHidden();
});

test("dark is the default theme; a chosen theme persists", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/dark/);

  const light = page.getByRole("menuitemradio", { name: "Light" });
  await clickUntilOpen(page.getByRole("button", { name: "Theme" }), light);
  await light.click();
  await expect(page.locator("html")).toHaveClass(/light/);

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/);

  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
  await expect(async () => {
    await page.getByText("Dark", { exact: true }).click();
    await expect(page.locator("html")).toHaveClass(/dark/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
});

test("notifications reflect the live health check", async ({ page, request }) => {
  const health = await (await request.get("/api/health")).json();
  await page.goto("/");
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await clickUntilOpen(page.getByRole("button", { name: /Notifications/ }), panel);
  await expect(
    panel.getByText(health.status === "ok" ? "All systems operational." : "Database unavailable."),
  ).toBeVisible();
});

test("unknown status filter falls back to all tasks", async ({ page }) => {
  await page.goto("/tasks?status=NOT_A_STATUS");
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  const filter = page.getByRole("navigation", { name: "Filter by status" });
  // The filter only renders when the database answered.
  if (await filter.count()) {
    await expect(filter.getByRole("link", { name: /^All/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
});

test("unknown routes show the not-found state", async ({ page }) => {
  await page.goto("/does-not-exist");
  await expect(page.getByText("Page not found")).toBeVisible();
  await page.getByRole("link", { name: "Back to overview" }).click();
  await expect(page).toHaveURL("/");
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("sidebar opens as a sheet and closes after navigating", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-slot="sidebar"][data-state]')).toBeHidden();

    const sheet = page.locator('[data-mobile="true"]');
    // The trigger does nothing until hydrated; click until the sheet opens.
    await expect(async () => {
      await page.locator('[data-sidebar="trigger"]').click();
      await expect(sheet).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 10_000 });

    await sheet.getByRole("link", { name: "Tasks", exact: true }).click();
    await expect(page).toHaveURL("/tasks");
    await expect(sheet).toBeHidden();
  });
});

test("health endpoint reports a database check", async ({ request }) => {
  const response = await request.get("/api/health");
  // 503 is a valid answer when Postgres is not running; the contract is the shape.
  expect([200, 503]).toContain(response.status());
  const body = await response.json();
  expect(body.status).toBe(response.status() === 200 ? "ok" : "degraded");
  expect(body.checks).toEqual([expect.objectContaining({ name: "database" })]);
});
