import { expect, test } from "@playwright/test";

test("dashboard renders the app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Unbuilt sections are visible but not links.
  await expect(nav.getByRole("link", { name: /Projects/ })).toHaveCount(0);
  await expect(nav.getByText("Projects")).toBeVisible();
});

test("health endpoint reports a database check", async ({ request }) => {
  const response = await request.get("/api/health");
  // 503 is a valid answer when Postgres is not running; the contract is the shape.
  expect([200, 503]).toContain(response.status());
  const body = await response.json();
  expect(body.status).toBe(response.status() === 200 ? "ok" : "degraded");
  expect(body.checks).toEqual([expect.objectContaining({ name: "database" })]);
});
