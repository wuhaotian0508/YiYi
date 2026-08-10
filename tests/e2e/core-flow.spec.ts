import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { seedExplicitDemo } from "./helpers/seed-explicit-demo";

async function inspectRecommendationState(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, reject) => {
      const request = indexedDB.open("yiyi");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => reject(request.error);
    });
    const readAll = <T,>(store: string) => new Promise<T[]>((resolveRead, reject) => {
      const request = database.transaction(store, "readonly").objectStore(store).getAll();
      request.onsuccess = () => resolveRead(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const sessions = await readAll<{ currentVersionId: string | null; historyVersionIds: string[]; shownOutfitIds: string[]; operationGeneration: number; updatedAt: number }>("dailySessions");
    const versions = await readAll<{ id: string; parentVersionId: string | null; outfit: { id: string; itemIds: Record<string, string>; scoreTrace?: { scoringVersion: string } } }>("outfitVersions");
    database.close();
    const session = sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    return { session, versions, current: versions.find((version) => version.id === session?.currentVersionId) ?? null };
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("yiyi:test-auto-voice", "true");
  });
  await seedExplicitDemo(page);
});

test("continuous voice recommendation, targeted revision, and confirmation", async ({ page }) => {
  await page.goto("/today");
  await expect(page.getByText("Tell YiYi about your day.")).toBeVisible();
  const rankResponse = page.waitForResponse((response) => response.url().includes("/api/outfits/rank"));
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("Listening…")).toBeVisible();
  await expect(page.getByText("I’d wear this one today.")).toBeVisible({ timeout: 5_000 });
  expect((await rankResponse).status()).toBe(200);
  await expect(page.getByLabel("Recommended outfit")).toHaveCount(1);
  const initialState = await inspectRecommendationState(page);
  expect(initialState.current?.outfit.scoreTrace?.scoringVersion).toBe("constraint-search-v3");
  expect(Object.values(initialState.current?.outfit.itemIds ?? {}).length).toBeGreaterThanOrEqual(3);
  expect(initialState.session?.shownOutfitIds).toContain(initialState.current?.outfit.id);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("I’d wear this one today.")).toBeVisible();
  await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, value: false }));
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("I’d wear this one today.")).toBeVisible();
  await page.getByRole("button", { name: "Open today details" }).click();
  await page.getByRole("button", { name: "Gallery" }).click();
  await page.getByRole("textbox", { name: "Intent tag" }).fill("Museum");
  await page.getByRole("button", { name: "Update outfit" }).click();
  await page.getByRole("button", { name: "Open today details" }).click();
  await expect(page.getByRole("button", { name: "Museum" })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss Today details" }).click();
  const beforeRandom = await inspectRecommendationState(page);
  await page.getByRole("button", { name: "Another" }).click();
  await expect.poll(async () => (await inspectRecommendationState(page)).current?.id, { timeout: 8_000 }).not.toBe(beforeRandom.current?.id);
  const afterRandom = await inspectRecommendationState(page);
  expect(afterRandom.current?.parentVersionId).toBe(beforeRandom.current?.id);
  expect(afterRandom.current?.outfit.id).not.toBe(beforeRandom.current?.outfit.id);
  expect(afterRandom.session?.historyVersionIds.at(-1)).toBe(beforeRandom.current?.id);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Back to your previous outfit.")).toBeVisible();
  const afterUndo = await inspectRecommendationState(page);
  expect(afterUndo.current?.id).toBe(beforeRandom.current?.id);
  const bag = page.locator('button[data-slot="bag"]');
  const stableShoes = await page.locator('button[data-slot="shoes"]').getAttribute("aria-label");
  const firstBag = await bag.getAttribute("aria-label");
  await bag.click();
  await page.getByRole("button", { name: "Replace" }).click();
  await expect(page.locator('button[data-slot="shoes"]')).toHaveAttribute("aria-label", stableShoes!);
  await expect(bag).not.toHaveAttribute("aria-label", firstBag!, { timeout: 8_000 });
  await page.reload();
  await expect(page.getByText("I’d wear this one today.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Back to your previous outfit.")).toBeVisible();
  await page.getByRole("button", { name: "Wear this today" }).click();
  await expect(page.getByText("Outfit decided.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start live voice session" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Outfit decided.")).toBeVisible();
});

test("rapid repeated mutations leave one coherent persisted winner", async ({ page }) => {
  await page.goto("/today");
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("I’d wear this one today.")).toBeVisible({ timeout: 8_000 });
  const before = await inspectRecommendationState(page);
  await page.getByRole("button", { name: "Another" }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(async () => (await inspectRecommendationState(page)).session?.operationGeneration, { timeout: 8_000 }).toBe((before.session?.operationGeneration ?? 0) + 1);
  const after = await inspectRecommendationState(page);
  expect(after.current?.parentVersionId).toBe(before.current?.id);
  expect(after.session?.currentVersionId).toBe(after.current?.id);
  expect(after.session?.historyVersionIds.at(-1)).toBe(before.current?.id);
  expect(after.versions.filter((version) => version.parentVersionId === before.current?.id)).toHaveLength(1);
});

test("reload clears a persisted outfit after its current wardrobe item becomes unavailable", async ({ page }) => {
  await page.goto("/today");
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("I’d wear this one today.")).toBeVisible({ timeout: 8_000 });
  const state = await inspectRecommendationState(page);
  const shoeId = state.current?.outfit.itemIds.shoes;
  expect(shoeId).toBeTruthy();
  if (!shoeId) throw new Error("Current outfit has no shoes");
  await page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolveOpen, reject) => {
      const request = indexedDB.open("yiyi");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolveWrite, reject) => {
      const transaction = database.transaction("wardrobeItems", "readwrite");
      const store = transaction.objectStore("wardrobeItems");
      const get = store.get(id);
      get.onsuccess = () => store.put({ ...get.result, availability: "laundry", updatedAt: Date.now() });
      transaction.oncomplete = () => resolveWrite();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, shoeId);
  await page.reload();
  await expect(page.getByText(/previous outfit was cleared/i)).toBeVisible();
  await expect(page.getByLabel("Recommended outfit")).toHaveCount(0);
  const repaired = await inspectRecommendationState(page);
  expect(repaired.session?.currentVersionId).toBeNull();
  expect(repaired.session?.historyVersionIds).toEqual([]);
});

test("wardrobe, item details, and preference memory are reachable", async ({ page }) => {
  await page.goto("/wardrobe");
  await expect(page.getByText("My wardrobe")).toBeVisible();
  await page.locator(".wardrobe-tile").last().scrollIntoViewIfNeeded();
  await expect(page.locator(".wardrobe-tile").last()).toBeVisible();
  await page.locator(".wardrobe-tile").first().scrollIntoViewIfNeeded();
  await page.locator(".wardrobe-tile").first().click();
  await expect(page.getByText("Availability")).toBeVisible();
  await page.goto("/preferences");
  await expect(page.getByText("What YiYi remembers")).toBeVisible();
  await expect(page.getByText("Usually prefer silver-tone jewelry")).toBeVisible();
});

test("Today gesture or visible control reaches Wardrobe and the sound preference persists", async ({ page, browserName }) => {
  await page.goto("/today");
  if (browserName === "webkit") {
    // Playwright WebKit does not synthesize a continuous trusted touch-drag stream.
    await page.getByRole("button", { name: "Open wardrobe" }).click();
  } else {
    const surface = await page.locator(".today-wardrobe-pager").boundingBox();
    if (!surface) throw new Error("Today surface missing");
    const startX = surface.x + surface.width * .84;
    const endX = surface.x + surface.width * .10;
    const dragY = surface.y + Math.min(300, surface.height * .44);
    await page.mouse.move(startX, dragY);
    await page.mouse.down();
    await page.mouse.move(endX, dragY + 5, { steps: 6 });
    await page.mouse.up();
  }
  await expect(page.getByRole("heading", { name: "My wardrobe" })).toBeVisible();
  await page.getByRole("button", { name: "Back to Today" }).click();
  await expect(page.getByRole("button", { name: "Open wardrobe" })).toBeVisible();
  await page.getByRole("link", { name: "Open settings" }).click();
  const sounds = page.getByRole("switch", { name: "Interface sounds" });
  await expect(sounds).toBeChecked();
  await sounds.click();
  await expect(sounds).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Interface sounds" })).not.toBeChecked();
});

test("wardrobe search, availability, and visible preference editing work", async ({ page }) => {
  await page.goto("/wardrobe");
  await page.getByRole("button", { name: "Search wardrobe" }).click();
  await page.getByRole("textbox", { name: "Search items" }).fill("silver");
  await expect(page.locator(".wardrobe-tile")).toHaveCount(1);
  await page.getByRole("button", { name: "Search wardrobe" }).click();
  await page.locator(".wardrobe-tile").first().click();
  await page.getByRole("button", { name: "Mark as unavailable" }).click();
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();

  await page.goto("/preferences");
  const avoidSection = page.getByRole("region", { name: "Less of" });
  await avoidSection.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: "New saved preference" }).fill("neon colors");
  await page.getByRole("button", { name: "Add for review" }).click();
  await expect(page.getByRole("region", { name: "Needs review" })).toContainText("neon colors");
  await page.goto("/today");
  await page.goto("/preferences");
  await expect(page.getByRole("region", { name: "Needs review" })).toContainText("neon colors");
});

test("mock image processing saves and reloads Blob-backed clothing", async ({ page }) => {
  await page.goto("/wardrobe/add");
  const fixture = resolve(process.cwd(), "tests/fixtures/soft-jacket.webp");
  await page.locator('input[type="file"]').nth(1).setInputFiles(fixture);
  await expect(page.getByText("Review item")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Ready to add")).toBeVisible();
  await page.getByRole("button", { name: "Add to wardrobe" }).click();
  await expect(page).toHaveURL(/\/wardrobe$/);
  await expect(page.getByText("Soft jacket")).toBeVisible();
  await expect(page.getByText("1 items")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Soft jacket")).toBeVisible();
  await expect(page.locator(".wardrobe-tile img")).toBeVisible();
  const persisted = await page.evaluate(async () => {
    const request = indexedDB.open("yiyi");
    const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
      request.onsuccess = () => resolveDatabase(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["wardrobeItems", "itemImages"], "readonly");
    const itemsRequest = transaction.objectStore("wardrobeItems").getAll();
    const imagesRequest = transaction.objectStore("itemImages").getAll();
    const [items, images] = await Promise.all([
      new Promise<unknown[]>((resolveItems, reject) => { itemsRequest.onsuccess = () => resolveItems(itemsRequest.result); itemsRequest.onerror = () => reject(itemsRequest.error); }),
      new Promise<Array<{ cutoutBlob?: { bytes?: ArrayBuffer }; thumbnailBlob?: { bytes?: ArrayBuffer }; originalBlob?: { bytes?: ArrayBuffer } }>>((resolveImages, reject) => { imagesRequest.onsuccess = () => resolveImages(imagesRequest.result); imagesRequest.onerror = () => reject(imagesRequest.error); }),
    ]);
    database.close();
    return {
      itemCount: items.length,
      imageCount: images.length,
      cutoutBytes: images[0]?.cutoutBlob?.bytes?.byteLength ?? 0,
      thumbnailBytes: images[0]?.thumbnailBlob?.bytes?.byteLength ?? 0,
      originalBytes: images[0]?.originalBlob?.bytes?.byteLength ?? 0,
    };
  });
  expect(persisted).toMatchObject({ itemCount: 1, imageCount: 1 });
  expect(persisted.cutoutBytes).toBeGreaterThan(0);
  expect(persisted.thumbnailBytes).toBeGreaterThan(0);
  expect(persisted.originalBytes).toBeGreaterThan(0);
});

test("mock image processing reaches a validated review on mobile engines", async ({ page }) => {
  await page.goto("/wardrobe/add");
  const fixture = resolve(process.cwd(), "tests/fixtures/soft-jacket.webp");
  await page.locator('input[type="file"]').nth(1).setInputFiles(fixture);
  await expect(page.getByText("Review item")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Soft jacket")).toBeVisible();
  await expect(page.getByText("Ready to add")).toBeVisible();
});

test("ranking failure keeps the deterministic outfit flow alive", async ({ page }) => {
  await page.route("**/api/outfits/rank", (route) => route.abort());
  await page.goto("/today");
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("I’d wear this one today.")).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(".result-heading p").last()).not.toHaveText("");
  await expect(page.getByText("YiYi couldn’t finish that.")).toHaveCount(0);
  await expect(page.getByLabel("Recommended outfit")).toHaveCount(1);
});
