import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("capture YiYi result review set", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "One rendering engine is sufficient for the manual visual contact sheet.");
  const output = resolve(process.cwd(), "tmp/visual");
  await mkdir(output, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem("yiyi:onboarding-complete", "true");
    localStorage.setItem("yiyi:test-auto-voice", "true");
  });
  await page.goto("/today");
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("I’d wear this one today.")).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(650);
  for (const [width, height] of [[375, 667], [390, 844], [393, 852], [430, 932]] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(output, `${width}x${height}-today.png`), fullPage: true });
  }

});

test("capture reduced-motion result review set", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "One rendering engine is sufficient for the manual reduced-motion contact sheet.");
  const output = resolve(process.cwd(), "tmp/visual");
  await mkdir(output, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("yiyi:onboarding-complete", "true");
    localStorage.setItem("yiyi:test-auto-voice", "true");
  });
  await page.goto("/today");
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("I’d wear this one today.")).toBeVisible({ timeout: 8_000 });
  for (const [width, height] of [[375, 667], [390, 844], [393, 852], [430, 932]] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: resolve(output, `${width}x${height}-today-reduced.png`), fullPage: true });
  }
});

test("capture style calibration review", async ({ page, browserName, context }) => {
  test.skip(browserName !== "chromium", "One rendering engine is sufficient for the manual visual contact sheet.");
  const output = resolve(process.cwd(), "tmp/visual");
  await mkdir(output, { recursive: true });
  await context.grantPermissions(["microphone"]);
  await page.addInitScript(() => Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [] }) } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Begin" }).click({ timeout: 5_000 });
  await page.getByRole("button", { name: "Show me how" }).click({ timeout: 5_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Try it yourself" }).click();
  await page.getByRole("button", { name: "Allow Microphone" }).click();
  await page.getByRole("button", { name: /Menswear/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("How does this feel?")).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(400);
  for (const [width, height] of [[375, 667], [390, 844], [393, 852], [430, 932]] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(output, `${width}x${height}-style-calibration.png`), fullPage: true });
  }
});

test("capture compact secondary-page review set", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "One rendering engine is sufficient for the manual secondary-page contact sheet.");
  const output = resolve(process.cwd(), "tmp/visual");
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 375, height: 667 });
  await page.addInitScript(() => localStorage.setItem("yiyi:onboarding-complete", "true"));

  await page.goto("/wardrobe");
  await expect(page.locator(".wardrobe-tile").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(output, "375x667-wardrobe.png"), fullPage: true });
  await page.locator(".wardrobe-tile").first().click();
  await expect(page.getByText("Availability")).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(output, "375x667-item-detail.png"), fullPage: true });

  await page.goto("/preferences");
  await expect(page.getByText("What YiYi remembers")).toBeVisible();
  await page.screenshot({ path: resolve(output, "375x667-preferences.png"), fullPage: true });
  await page.goto("/settings");
  await expect(page.getByRole("switch", { name: "Interface sounds" })).toBeVisible();
  await page.screenshot({ path: resolve(output, "375x667-settings.png"), fullPage: true });

  await page.goto("/wardrobe/add");
  await page.screenshot({ path: resolve(output, "375x667-add-item.png"), fullPage: true });
  const fixture = resolve(process.cwd(), "tests/fixtures/soft-jacket.webp");
  await page.locator('input[type="file"]').nth(1).setInputFiles(fixture);
  await expect(page.getByText("Review item")).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(output, "375x667-review-item.png"), fullPage: true });
});
