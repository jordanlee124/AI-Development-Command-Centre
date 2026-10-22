import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { clickUntilOpen } from "./helpers";

const paths = [
  "/",
  "/projects",
  "/tasks",
  "/agents",
  "/github",
  "/analytics",
  "/activity",
  "/settings",
];

for (const theme of ["dark", "light"] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      // next-themes reads its choice from localStorage before first paint.
      await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    });

    for (const path of paths) {
      test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator("html")).toHaveClass(new RegExp(theme));
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      });
    }

    test("command palette dialog has no WCAG A/AA violations", async ({ page }) => {
      await page.goto("/");
      await clickUntilOpen(
        page.getByRole("button", { name: /Search/ }),
        page.getByRole("dialog", { name: "Search" }),
      );
      const results = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  });
}
