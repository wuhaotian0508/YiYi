import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const violations = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test.describe("release accessibility boundary", () => {
  test("major routes have no serious or critical automated WCAG violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
    await expectNoSeriousViolations(page);

    await page.addInitScript(() => localStorage.setItem("yiyi:onboarding-complete", "true"));
    for (const route of ["/today", "/wardrobe", "/preferences", "/settings"]) {
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      await expectNoSeriousViolations(page);
    }
  });

  test("bottom sheet traps focus, closes with Escape, and restores the trigger", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("yiyi:onboarding-complete", "true"));
    await page.goto("/preferences");
    const region = page.getByRole("region", { name: "More of" });
    const trigger = region.getByRole("button", { name: "Edit" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Edit saved preferences" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("Today to Wardrobe has a non-drag single-pointer alternative", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("yiyi:onboarding-complete", "true"));
    await page.goto("/today");
    await page.getByRole("button", { name: "Open wardrobe" }).click();
    await expect(page.getByRole("region", { name: "Wardrobe page" })).toBeVisible();
    await page.getByRole("button", { name: "Back to Today" }).click();
    await expect(page.getByRole("region", { name: "Today page" })).toHaveAttribute("aria-hidden", "false");
  });

  test("security headers are present without blocking the application", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.headers()["x-frame-options"]).toBe("DENY");
    expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response?.headers()["content-security-policy"]).toContain("connect-src 'self' https://api.openai.com wss://api.openai.com");
    await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
  });
});
