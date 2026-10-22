import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Buttons do nothing until React hydrates, and the production server answers before that.
 * Clicks `trigger` until `opened` (a dialog, menu or popover) is visible.
 */
export async function clickUntilOpen(trigger: Locator, opened: Locator) {
  await expect(async () => {
    if (!(await opened.isVisible())) await trigger.click();
    await expect(opened).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

export async function openDialog(page: Page, button: string, dialog: string) {
  const opened = page.getByRole("dialog", { name: dialog });
  await clickUntilOpen(page.getByRole("button", { name: button }), opened);
  return opened;
}

export async function createProject(page: Page, name: string, localPath = "") {
  await page.goto("/projects");
  const dialog = await openDialog(page, "New project", "New project");
  await dialog.getByLabel("Name").fill(name);
  if (localPath) await dialog.getByLabel("Local folder").fill(localPath);
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

export async function axeViolations(page: Page, include?: string) {
  // The page fades in; measuring contrast mid-fade reports false failures.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ),
  );
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (include) builder.include(include);
  // Name the failing elements, so a failure says what to fix.
  return (await builder.analyze()).violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} ${n.any[0]?.message ?? v.help}`),
  );
}
