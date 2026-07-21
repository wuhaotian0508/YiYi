import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { seedExplicitDemo } from "./helpers/seed-explicit-demo";

const iPhoneSizes = [[375, 667], [390, 844], [393, 852], [430, 932]] as const;

test("capture YiYi result review set", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "One rendering engine is sufficient for the manual visual contact sheet.");
  const output = resolve(process.cwd(), "tmp/visual");
  await mkdir(output, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem("yiyi:test-auto-voice", "true");
  });
  await seedExplicitDemo(page);
  await page.goto("/today");
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("I’d wear this one today.")).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(650);
  for (const [width, height] of iPhoneSizes) {
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
    localStorage.setItem("yiyi:test-auto-voice", "true");
  });
  await seedExplicitDemo(page);
  await page.goto("/today");
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("I’d wear this one today.")).toBeVisible({ timeout: 8_000 });
  for (const [width, height] of iPhoneSizes) {
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
  await page.getByRole("button", { name: "Begin" }).click({ timeout: 6_000 });
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Allow Microphone" }).click();
  await page.getByRole("button", { name: /Menswear/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("1 of 4")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("img", { name: /matching mannequins/i })).toBeVisible();
  await page.waitForTimeout(400);
  for (const [width, height] of iPhoneSizes) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    await page.screenshot({ path: resolve(output, `${width}x${height}-style-calibration.png`), fullPage: true });
  }
  for (let index = 0; index < 4; index += 1) {
    await page.getByRole("button", { name: "A feels like me" }).click();
  }
  await expect(page.getByText("Fine-tune YiYi")).toBeVisible();
  await page.waitForTimeout(450);
  const preferenceScroll = page.locator(".preference-scroll");
  for (const [width, height] of iPhoneSizes) {
    await page.setViewportSize({ width, height });
    await preferenceScroll.evaluate((element) => { element.scrollTop = 0; });
    await expect(page.getByRole("heading", { name: "More of" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Tell YiYi another preference" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review my style" })).toBeVisible();
    await page.screenshot({ path: resolve(output, `${width}x${height}-fine-tune-top.png`), fullPage: true });

    const finalPreference = page.getByRole("button", { name: "Silver-tone jewelry" });
    await finalPreference.scrollIntoViewIfNeeded();
    await expect(finalPreference).toBeVisible();
    await expect(page.getByRole("button", { name: "Tell YiYi another preference" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review my style" })).toBeVisible();
    await page.screenshot({ path: resolve(output, `${width}x${height}-fine-tune-bottom.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Review my style" }).click();
  await expect(page.getByRole("heading", { name: "Your style so far" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Less of" })).toBeVisible();
  await expect(page.getByText("Nothing yet — YiYi will not invent dislikes.")).toBeVisible();
  await page.waitForTimeout(450);
  const profileScroll = page.getByRole("heading", { name: "Still open" }).locator("..").locator("..");
  for (const [width, height] of iPhoneSizes) {
    await page.setViewportSize({ width, height });
    await profileScroll.evaluate((element) => { element.scrollTop = 0; });
    await page.waitForTimeout(150);
    await page.screenshot({ path: resolve(output, `${width}x${height}-style-profile.png`), fullPage: true });

    await page.getByText("Oversized volume", { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByText("Oversized volume", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo last answer" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Looks right" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back and adjust" })).toBeVisible();
    const [scrollBox, actionBox] = await Promise.all([
      profileScroll.boundingBox(),
      page.getByRole("button", { name: "Undo last answer" }).boundingBox(),
    ]);
    expect(scrollBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    expect((scrollBox?.y ?? 0) + (scrollBox?.height ?? 0)).toBeLessThanOrEqual((actionBox?.y ?? 0) + 1);
    await page.screenshot({ path: resolve(output, `${width}x${height}-style-profile-bottom.png`), fullPage: true });
  }
});

test("capture compact secondary-page review set", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "One rendering engine is sufficient for the manual secondary-page contact sheet.");
  const output = resolve(process.cwd(), "tmp/visual");
  await mkdir(output, { recursive: true });
  await page.setViewportSize({ width: 375, height: 667 });
  await seedExplicitDemo(page);

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
