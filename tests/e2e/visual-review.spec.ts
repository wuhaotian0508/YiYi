import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { seedExplicitDemo } from "./helpers/seed-explicit-demo";

const iPhoneSizes = [[375, 667], [390, 844], [393, 852], [430, 932]] as const;

async function expectOrderedTodayResult(page: import("@playwright/test").Page) {
  await expect(page.locator(".today-stage > .today-content")).toHaveCount(1);
  await expect(page.locator(".today-stage > .editable-voice-transcript")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Undo$/ })).toHaveCount(0);
  const regions = [
    page.locator(".result-heading"),
    page.locator(".single-outfit-stage"),
    page.locator(".result-actions"),
    page.locator(".voice-dock"),
  ];
  const boxes = await Promise.all(regions.map((region) => region.boundingBox()));
  boxes.forEach((box) => expect(box).not.toBeNull());
  for (let index = 0; index < boxes.length - 1; index += 1) {
    expect((boxes[index]?.y ?? 0) + (boxes[index]?.height ?? 0)).toBeLessThanOrEqual((boxes[index + 1]?.y ?? 0) + 1);
  }
  for (const name of ["Open today details", "Another", "Wear this today"]) {
    await page.getByRole("button", { name }).click({ trial: true });
  }
}

async function expectSharedTodayAxis(page: import("@playwright/test").Page) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const regions = [
    { name: "weather", locator: page.locator(".weather-pill") },
    { name: "heading", locator: page.locator(".result-heading h1") },
    { name: "outfit", locator: page.locator(".single-outfit-stage .outfit-canvas") },
    { name: "voice dock", locator: page.locator(".voice-dock-primary") },
  ];
  const boxes = await Promise.all(regions.map((region) => region.locator.boundingBox()));
  boxes.forEach((box) => expect(box).not.toBeNull());
  for (const [index, box] of boxes.entries()) {
    const center = (box?.x ?? 0) + ((box?.width ?? 0) / 2);
    expect(Math.abs(center - (viewport!.width / 2)), `${regions[index].name} center`).toBeLessThanOrEqual(1.5);
  }
}

async function expectOutfitPaintWithinStage(page: import("@playwright/test").Page) {
  const stage = await page.locator(".single-outfit-stage").boundingBox();
  expect(stage).not.toBeNull();
  const visuals = await page.locator(".single-outfit-stage .outfit-item-visual > :is(.garment, .garment-photo, .garment-local, .garment-demo-asset)").all();
  expect(visuals.length).toBeGreaterThan(0);
  for (const visual of visuals) {
    const box = await visual.boundingBox();
    const slot = await visual.locator("xpath=../..").getAttribute("data-slot");
    const imageAsset = await visual.evaluate((element) => !element.classList.contains("garment"));
    expect(box).not.toBeNull();
    expect(box!.x + (box!.width / 2), `${slot} horizontal center`).toBeGreaterThanOrEqual(stage!.x);
    expect(box!.x + (box!.width / 2), `${slot} horizontal center`).toBeLessThanOrEqual(stage!.x + stage!.width);
    expect(box!.y + (box!.height / 2), `${slot} vertical center`).toBeGreaterThanOrEqual(stage!.y);
    expect(box!.y + (box!.height / 2), `${slot} vertical center`).toBeLessThanOrEqual(stage!.y + stage!.height);
    // Image assets deliberately include transparent optical padding; their
    // visual center is the stable browser-level boundary we can assert.
    if (imageAsset) continue;
    // CSS transforms land on fractional device pixels. Two CSS pixels cover
    // raster rounding while still catching meaningful garment clipping.
    expect(box!.x, `${slot} left edge`).toBeGreaterThanOrEqual(stage!.x - 2);
    expect(box!.y, `${slot} top edge`).toBeGreaterThanOrEqual(stage!.y - 2);
    expect(box!.x + box!.width, `${slot} right edge`).toBeLessThanOrEqual(stage!.x + stage!.width + 2);
    expect(box!.y + box!.height, `${slot} bottom edge`).toBeLessThanOrEqual(stage!.y + stage!.height + 2);
  }
}

test("keeps one Today result owner and non-overlapping regions on iPhone viewports", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("yiyi:test-auto-voice", "true");
  });
  await seedExplicitDemo(page);
  await page.goto("/today");
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("I’d wear this one today.")).toBeVisible({ timeout: 8_000 });
  for (const [width, height] of iPhoneSizes) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(180);
    await expectOrderedTodayResult(page);
    await expectSharedTodayAxis(page);
    await expectOutfitPaintWithinStage(page);
  }
});

test("keeps live listening feedback on the same Today center axis", async ({ page }, testInfo) => {
  await seedExplicitDemo(page);
  await page.goto("/today");
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("Listening…")).toBeVisible();

  for (const [width, height] of iPhoneSizes) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(180);
    const selectors = [".weather-pill", ".session-focus", ".voice-dock-primary"];
    const boxes = await Promise.all(selectors.map((selector) => page.locator(selector).boundingBox()));
    boxes.forEach((box) => expect(box).not.toBeNull());
    for (const [index, box] of boxes.entries()) {
      const center = (box?.x ?? 0) + ((box?.width ?? 0) / 2);
      expect(Math.abs(center - (width / 2)), `${selectors[index]} center`).toBeLessThanOrEqual(1.5);
    }
    await testInfo.attach(`today-listening-${width}x${height}`, {
      body: await page.locator('section[aria-label="Today page"]').screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.voice-dock[data-state="listening"]')).toBeVisible();
  await expect(page.locator(".voice-dock-listening-breath")).toBeVisible();
});

test("keeps the full outfit legible when the voice transport is paused", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("yiyi:test-auto-voice", "true");
  });
  await seedExplicitDemo(page);
  await page.goto("/today");
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("I’d wear this one today.")).toBeVisible({ timeout: 8_000 });
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("YiYi is listening…")).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("Your outfit is still here.")).toBeVisible({ timeout: 7_000 });
  await page.waitForTimeout(400);

  for (const [width, height] of iPhoneSizes) {
    await page.setViewportSize({ width, height });
    const paused = page.locator(".paused-outfit");
    const copy = page.locator(".paused-copy");
    const [pausedBox, copyBox] = await Promise.all([paused.boundingBox(), copy.boundingBox()]);
    expect(pausedBox).not.toBeNull();
    expect(copyBox).not.toBeNull();
    expect(pausedBox!.width).toBeGreaterThanOrEqual(Math.min(width - 40, 300));
    expect(pausedBox!.y + pausedBox!.height).toBeLessThanOrEqual(copyBox!.y + 1);
    await testInfo.attach(`today-paused-${width}x${height}`, {
      body: await page.locator('section[aria-label="Today page"]').screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
  }

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("I’d wear this one today.")).toBeVisible();
});

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
    await expectOrderedTodayResult(page);
    await expectSharedTodayAxis(page);
    await expectOutfitPaintWithinStage(page);
    await expect(page.locator('section[aria-label="Today page"]')).toHaveScreenshot(`today-result-${width}x${height}.png`, {
      animations: "disabled",
      maxDiffPixelRatio: 0.008,
      threshold: 0.22,
    });
    await page.screenshot({ path: resolve(output, `${width}x${height}-today.png`), fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open today details" }).click();
  const details = page.getByRole("dialog", { name: "Today details" });
  await expect(details).toBeVisible();
  await expect(details.getByText("What YiYi heard")).toBeVisible();
  const editTarget = await details.getByRole("button", { name: "Edit transcript" }).boundingBox();
  expect(editTarget?.width).toBeGreaterThanOrEqual(44);
  expect(editTarget?.height).toBeGreaterThanOrEqual(44);
  await page.waitForTimeout(450);
  await page.screenshot({ path: resolve(output, "390x844-today-details.png"), fullPage: true });
  await page.getByRole("button", { name: "Dismiss Today details" }).click();

  await page.getByRole("button", { name: /Wear this today/ }).click();
  await expect(page.getByText("Outfit decided.")).toBeVisible();
  await expect(page.locator(".confirmed-voice-transcript")).toHaveCount(0);
  await page.waitForTimeout(450);
  const [confirmedActions, confirmedDock] = await Promise.all([
    page.locator(".confirmed-actions").boundingBox(),
    page.locator(".voice-dock").boundingBox(),
  ]);
  expect(confirmedActions).not.toBeNull();
  expect(confirmedDock).not.toBeNull();
  expect((confirmedActions?.y ?? 0) + (confirmedActions?.height ?? 0)).toBeLessThanOrEqual((confirmedDock?.y ?? 0) + 1);
  await expect(page.locator('section[aria-label="Today page"]')).toHaveScreenshot("today-confirmed-390x844.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.008,
    threshold: 0.22,
  });
  await page.screenshot({ path: resolve(output, "390x844-today-confirmed.png"), fullPage: true });

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
    await page.waitForTimeout(180);
    await expectOrderedTodayResult(page);
    await expectSharedTodayAxis(page);
    await expectOutfitPaintWithinStage(page);
    expect(await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })))
      .toEqual({ scrollWidth: width, clientWidth: width });
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
