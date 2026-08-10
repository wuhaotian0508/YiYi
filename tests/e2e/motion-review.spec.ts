import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const reviewViewports = {
  "375×667": { width: 375, height: 667 },
  "390×844": { width: 390, height: 844 },
  "393×852": { width: 393, height: 852 },
  "430×932": { width: 430, height: 932 },
} as const;
const storyboardLabels = [
  "decision:start",
  "decision:questions-complete",
  "decision:delete",
  "reframe:complete",
  "understanding",
  "outfit:assemble",
  "revision:replace",
  "complete",
] as const;
const consoleErrors = new WeakMap<Page, string[]>();

async function openReview(page: Page) {
  await page.goto("/motion-review");
  await expect(page.locator("[data-motion-review]")).toBeVisible();
  await expect(page.locator("[data-gsdevtools-host]")).toBeAttached();
}

async function selectScenario(page: Page, name: string, marker: string) {
  await page.getByRole("button", { name, exact: true }).click();
  const surface = page.locator(marker);
  await expect(surface).toBeVisible();
  await surface.scrollIntoViewIfNeeded();
}

async function seek(page: Page, label: (typeof storyboardLabels)[number]) {
  await page.getByLabel("Storyboard label", { exact: true }).selectOption({ label });
}

async function slotBoxes(page: Page) {
  return page.locator('[data-review-scenario="onboarding"] .outfit-canvas').evaluate((canvas) => {
    const canvasBox = canvas.getBoundingClientRect();
    return Object.fromEntries(Array.from(canvas.querySelectorAll<HTMLElement>("[data-slot]")).map((slot) => {
      const box = slot.getBoundingClientRect();
      return [slot.dataset.slot ?? "unknown", {
        x: box.x - canvasBox.x,
        y: box.y - canvasBox.y,
        width: box.width,
        height: box.height,
      }];
    }));
  });
}

async function mouseDrag(page: Page, start: { x: number; y: number }, end: { x: number; y: number }, steps = 8, stepDelay = 0) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let index = 1; index <= steps; index += 1) {
    const progress = index / steps;
    await page.mouse.move(start.x + ((end.x - start.x) * progress), start.y + ((end.y - start.y) * progress));
    if (stepDelay) await page.waitForTimeout(stepDelay);
  }
  await page.mouse.up();
}

async function pagerTranslationX(page: Page) {
  return page.locator(".today-wardrobe-pager > .swiper-wrapper").evaluate((wrapper) => {
    const transform = getComputedStyle(wrapper).transform;
    if (transform === "none") return 0;
    const values = transform.slice(transform.indexOf("(") + 1, -1).split(",").map(Number);
    return transform.startsWith("matrix3d") ? values[12] : values[4];
  });
}

test.describe("motion review", () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    consoleErrors.set(page, errors);
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
  });

  test.afterEach(async ({ page }) => {
    expect(consoleErrors.get(page) ?? []).toEqual([]);
  });

  test("authored onboarding is continuous, causal, seekable, and spatially stable", async ({ page }, testInfo) => {
    await openReview(page);

    for (const removedCopy of [
      "Tell YiYi about your day — not your clothes.",
      "You’re still choosing",
      "Show me how",
    ]) await expect(page.getByText(removedCopy, { exact: true })).toHaveCount(0);

    const storyText = page.locator("[data-story-text]");
    await seek(page, "decision:start");
    await expect(storyText).toHaveText("");

    await seek(page, "decision:questions-complete");
    await expect(storyText).toContainText("what should I wear?????");
    const decisionText = await storyText.textContent();
    expect(decisionText?.split("\n")).toHaveLength(8);

    await seek(page, "decision:delete");
    const deletingText = await storyText.textContent();
    expect(deletingText?.startsWith("Maybe my navy hoodie...")).toBe(true);
    expect(deletingText).not.toBe(decisionText);
    expect(deletingText?.length).toBeLessThan(decisionText?.length ?? 0);

    await seek(page, "reframe:complete");
    await expect(storyText).toHaveText("I have class, dinner with friends,\nand a lot of walking.\nI want to feel relaxed and still look put together.");

    await seek(page, "understanding");
    await expect(page.getByText("Understanding…", { exact: true })).toBeVisible();
    await expect(page.locator('[data-story-tag]:visible')).toHaveCount(3);

    await seek(page, "outfit:assemble");
    await expect(page.getByRole("heading", { name: "I’d wear this one." })).toBeVisible();
    await expect(page.locator('[data-review-scenario="onboarding"] [data-slot]:visible')).toHaveCount(5);
    const before = await slotBoxes(page);

    await seek(page, "revision:replace");
    const oldShoe = page.locator('[data-review-scenario="onboarding"] [data-slot="shoes"] [data-item-id="44444444-4444-4444-8444-444444444442"]');
    const newShoe = page.locator('[data-review-scenario="onboarding"] [data-slot="shoes"] [data-item-id="44444444-4444-4444-8444-444444444441"]');
    expect(await oldShoe.count()).toBe(1);
    expect(await newShoe.count()).toBe(0);
    await expect(newShoe).toBeVisible();
    await expect(oldShoe).toHaveCount(0);
    const after = await slotBoxes(page);
    for (const slot of ["outerwear", "top", "bottom", "bag", "shoes"] as const) {
      for (const dimension of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(before[slot][dimension] - after[slot][dimension]), `${slot}.${dimension}`).toBeLessThanOrEqual(1);
      }
    }

    await seek(page, "complete");
    await expect(page.getByText("Only the shoes changed. Everything else stayed.", { exact: true })).toBeVisible();
    await expect(page.getByText("“Make it a little more relaxed.”", { exact: true })).toBeHidden();

    const firstDecision = decisionText;
    await page.getByRole("button", { name: "Restart", exact: true }).click();
    await seek(page, "decision:questions-complete");
    await expect(storyText).toHaveText(firstDecision ?? "");

    const device = page.locator("[data-review-viewport]");
    for (const label of storyboardLabels) {
      await seek(page, label);
      if (label === "revision:replace" || label === "complete") await expect(newShoe).toBeVisible();
      await testInfo.attach(`onboarding-${label}`, { body: await device.screenshot(), contentType: "image/png" });
    }
  });

  test("key onboarding frames remain stable across target iPhone sizes and reduced motion", async ({ page }) => {
    await openReview(page);
    const reviewOutput = resolve(process.cwd(), "tmp/motion-review");
    await mkdir(reviewOutput, { recursive: true });
    const device = page.locator("[data-review-viewport]");
    const viewportSelect = page.getByLabel("Review viewport", { exact: true });
    const revisedShoe = page.locator('[data-review-scenario="onboarding"] [data-slot="shoes"] [data-item-id="44444444-4444-4444-8444-444444444441"]');
    const revisedShoeImage = revisedShoe.locator("img");

    for (const [viewport, size] of Object.entries(reviewViewports)) {
      await page.setViewportSize(size);
      await viewportSelect.selectOption({ label: viewport });
      await seek(page, "complete");
      await expect(page.getByText("Only the shoes changed. Everything else stayed.", { exact: true })).toBeVisible();
      await expect(page.getByText("“Make it a little more relaxed.”", { exact: true })).toBeHidden();
      await expect(revisedShoe).toBeVisible();
      await expect.poll(() => revisedShoeImage.evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
      await expect(revisedShoe).toHaveCSS("opacity", "1");
      await device.screenshot({ path: resolve(reviewOutput, `onboarding-complete-${viewport.replace("×", "x")}.png`) });
      await expect(device).toHaveScreenshot(`onboarding-v2-complete-${viewport.replace("×", "x")}.png`, { animations: "allow" });
      await expect(page.getByText("“Make it a little more relaxed.”", { exact: true })).toBeHidden();
    }

    await page.getByRole("button", { name: "Reduced motion", exact: true }).click();
    await page.setViewportSize(reviewViewports["390×844"]);
    await viewportSelect.selectOption({ label: "390×844" });
    await seek(page, "decision:questions-complete");
    await expect(page.locator("[data-story-caret]")).toHaveCSS("animation-name", "none");
    await expect(device).toHaveScreenshot("onboarding-v2-reduced-questions-390x844.png", { animations: "allow" });
    await seek(page, "complete");
    await expect(revisedShoe).toBeVisible();
    await expect.poll(() => revisedShoeImage.evaluate((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(revisedShoe).toHaveCSS("opacity", "1");
    await expect(device).toHaveScreenshot("onboarding-v2-reduced-complete-390x844.png", { animations: "allow" });
  });

  test("runtime state changes replace stale motion instead of queueing it", async ({ page }) => {
    await openReview(page);
    await selectScenario(page, "voice", '[data-review-scenario="voice"]');
    await page.getByRole("button", { name: "speaking", exact: true }).click();
    await page.getByRole("button", { name: "interrupted", exact: true }).click();
    await expect(page.locator('.voice-core[data-state="interrupted"]')).toBeVisible();
    await expect(page.locator('.voice-dock[data-state="interrupted"]')).toBeVisible();
    await expect(page.getByText("Interrupted…", { exact: true })).toBeVisible();
    await expect(page.getByText("Speaking…", { exact: true })).toHaveCount(0);

    await selectScenario(page, "outfit", '[data-review-scenario="outfit"]');
    await page.getByRole("button", { name: "Random", exact: true }).click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator('[data-review-scenario="outfit"]')).toHaveAttribute("data-outfit-state", "initial");
    await expect(page.locator('[data-review-scenario="outfit"] [data-item-id="44444444-4444-4444-8444-444444444442"]')).toBeVisible();
    await expect(page.locator('[data-review-scenario="outfit"] [data-item-id="11111111-1111-4111-8111-111111111113"]')).toBeVisible();
  });

  test("Voice states stay distinct in normal and reduced motion", async ({ page }, testInfo) => {
    await openReview(page);
    await selectScenario(page, "voice", '[data-review-scenario="voice"]');
    const states = ["idle", "connecting", "listening", "committing", "understanding", "tool_running", "revising", "speaking", "interrupted", "recoverable_error"] as const;

    for (const state of states) {
      await page.getByRole("button", { name: state, exact: true }).click();
      await expect(page.locator(`.voice-core[data-state="${state}"]`)).toBeVisible();
      await expect(page.locator(`.voice-dock[data-state="${state}"]`)).toBeVisible();
      await testInfo.attach(`voice-${state}`, {
        body: await page.locator('[data-review-scenario="voice"]').screenshot({ animations: "allow" }),
        contentType: "image/png",
      });
    }

    await page.getByRole("button", { name: "Reduced motion", exact: true }).click();
    for (const state of ["listening", "understanding", "tool_running", "speaking", "recoverable_error"] as const) {
      await page.getByRole("button", { name: state, exact: true }).click();
      await expect(page.locator(`.voice-core[data-state="${state}"]`)).toBeVisible();
      await expect(page.locator(`.voice-dock[data-state="${state}"]`)).toBeVisible();
    }
  });

  test("Bottom Sheet owns vertical drag and remains interruptible", async ({ page }) => {
    await openReview(page);
    await selectScenario(page, "sheet", '[data-review-scenario="sheet"]');
    await page.getByRole("button", { name: "Open sheet", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Motion review sheet" });
    const handle = page.getByRole("button", { name: "Drag to close Motion review sheet" });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(550);
    const initial = await dialog.boundingBox();
    const handleBox = await handle.boundingBox();
    expect(initial).not.toBeNull();
    expect(handleBox).not.toBeNull();

    await mouseDrag(page, { x: handleBox!.x + handleBox!.width / 2, y: handleBox!.y + handleBox!.height / 2 }, { x: handleBox!.x + handleBox!.width / 2, y: handleBox!.y + 52 }, 5, 90);
    await expect(dialog).toBeVisible();
    await expect.poll(async () => (await dialog.boundingBox())?.y ?? -1).toBeCloseTo(initial!.y, 0);

    const reboundHandle = await handle.boundingBox();
    expect(reboundHandle).not.toBeNull();
    await mouseDrag(page, { x: reboundHandle!.x + reboundHandle!.width / 2, y: reboundHandle!.y + reboundHandle!.height / 2 }, { x: reboundHandle!.x + reboundHandle!.width / 2, y: reboundHandle!.y + 128 }, 6, 45);
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "Open sheet", exact: true }).click();
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Dismiss Motion review sheet" }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "Reduced motion", exact: true }).click();
    await page.getByRole("button", { name: "Open sheet", exact: true }).click();
    await page.getByRole("button", { name: "Close Motion review sheet" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("Today and Wardrobe follow horizontal intent while vertical and insufficient drags stay put", async ({ page }) => {
    await openReview(page);
    await selectScenario(page, "pager", ".today-wardrobe-pager");
    const pager = page.locator(".today-wardrobe-pager");
    const today = page.locator('section[aria-label="Today page"]');
    const wardrobe = page.locator('section[aria-label="Wardrobe slide"]');
    await expect(today).toHaveAttribute("aria-hidden", "false");
    const box = await pager.boundingBox();
    expect(box).not.toBeNull();
    const centerY = box!.y + (box!.height * 0.54);

    await mouseDrag(page, { x: box!.x + box!.width * 0.84, y: centerY }, { x: box!.x + box!.width * 0.28, y: centerY + 48 }, 7);
    await expect(wardrobe).toHaveAttribute("aria-hidden", "false");
    await page.getByRole("button", { name: "Back to Today" }).click();
    await expect(today).toHaveAttribute("aria-hidden", "false");

    await mouseDrag(page, { x: box!.x + box!.width * 0.8, y: centerY }, { x: box!.x + box!.width * 0.76, y: centerY - 150 }, 8);
    await expect(today).toHaveAttribute("aria-hidden", "false");
    await expect.poll(() => pagerTranslationX(page)).toBeCloseTo(0, 0);

    await mouseDrag(page, { x: box!.x + box!.width * 0.78, y: centerY }, { x: box!.x + box!.width * 0.71, y: centerY }, 5, 90);
    await expect(today).toHaveAttribute("aria-hidden", "false");
    await expect.poll(() => pagerTranslationX(page)).toBeCloseTo(0, 0);

    await mouseDrag(page, { x: box!.x + box!.width * 0.82, y: centerY }, { x: box!.x + box!.width * 0.61, y: centerY }, 2);
    await expect(wardrobe).toHaveAttribute("aria-hidden", "false");

    const returnBox = await pager.boundingBox();
    expect(returnBox).not.toBeNull();
    await mouseDrag(page, { x: returnBox!.x + returnBox!.width * 0.2, y: centerY }, { x: returnBox!.x + returnBox!.width * 0.72, y: centerY }, 7);
    await expect(today).toHaveAttribute("aria-hidden", "false");
  });

  test("Calibration and Fine-tune render controlled, state-backed motion", async ({ page }) => {
    await openReview(page);
    const reviewOutput = resolve(process.cwd(), "tmp/motion-review");
    await mkdir(reviewOutput, { recursive: true });
    const device = page.locator("[data-review-viewport]");

    await selectScenario(page, "calibration", '[data-review-scenario="calibration"]');
    await expect(page.locator('[data-review-scenario="calibration"] h1')).toHaveCount(1);
    await expect(page.locator('[data-review-scenario="calibration"] img')).toHaveCount(2);
    for (const image of await page.locator('[data-review-scenario="calibration"] img').all()) {
      await expect(image).toHaveCSS("object-fit", "contain");
    }
    await page.getByRole("button", { name: "A feels like me", exact: true }).click();
    await expect(page.getByText("2 of 4", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "B feels like me", exact: true }).click();
    await expect(page.getByText("3 of 4", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Both", exact: true }).click();
    await expect(page.getByText("4 of 4", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Neither", exact: true }).click();
    await expect(page.getByText(/Optional 1 of 2|Calibration complete/)).toBeVisible();
    if (await page.getByRole("button", { name: "Skip", exact: true }).isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "Skip", exact: true }).click();
    }
    await device.screenshot({ path: resolve(reviewOutput, "calibration-normal-390x844.png") });

    await page.getByRole("button", { name: "Reduced motion", exact: true }).click();
    await page.getByRole("button", { name: "voice", exact: true }).click();
    await page.getByRole("button", { name: "calibration", exact: true }).click();
    await expect(page.locator('[data-review-scenario="calibration"]')).toBeVisible();
    await expect(device).toHaveScreenshot("calibration-reduced-390x844.png", { animations: "allow" });

    await selectScenario(page, "fine-tune", '[data-review-scenario="fine-tune"]');
    await expect(page.getByText("Raw transcript stays hidden; only structured, editable signals appear.", { exact: true })).toBeVisible();
    await expect(page.locator('[data-review-scenario="fine-tune"] [data-transcript]')).toHaveCount(0);
    await page.getByRole("button", { name: "Add More signal", exact: true }).click();
    await expect(page.getByText("Soft textures", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add Less signal", exact: true }).click();
    await expect(page.getByText("Formal looks", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Soft textures", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete Soft textures", exact: true }).click();
    await expect(page.getByText("Soft textures", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Formal looks", { exact: true })).toBeVisible();
    await expect(device).toHaveScreenshot("fine-tune-reduced-390x844.png", { animations: "allow" });
  });

  test("development frame sampler reports measured refresh-relative evidence", async ({ page }) => {
    await openReview(page);
    await page.getByRole("button", { name: "Sample frames", exact: true }).click();
    const output = page.locator("[data-frame-sample]");
    await expect(output).toBeVisible({ timeout: 5_000 });
    await expect(output).toContainText("baseline");
    await expect(output).toContainText("p95");
    await expect(output).toContainText("max run");
    const reviewOutput = resolve(process.cwd(), "tmp/motion-review");
    await mkdir(reviewOutput, { recursive: true });
    await writeFile(resolve(reviewOutput, "frame-sample.txt"), `${await output.innerText()}\n`, "utf8");
  });
});
