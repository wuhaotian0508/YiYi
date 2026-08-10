import { expect, test, type Page } from "@playwright/test";
import { seedExplicitDemo } from "../e2e/helpers/seed-explicit-demo";

async function installTokenProxy(page: Page) {
  const proxyUrl = process.env.LIVE_TOKEN_PROXY_URL;
  if (!proxyUrl) return;
  const origin = new URL(proxyUrl).origin;
  await page.route("**/api/realtime/token", async (route) => {
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
    });
    await route.fulfill({
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json", "Cache-Control": "no-store" },
      body: await response.text(),
    });
  });
}

test("one explicit start creates one Realtime token and one reusable ready session", async ({ page }) => {
  await installTokenProxy(page);
  page.on("console", (message) => {
    if (message.text().includes("yiyi_voice_lifecycle")) console.info(`[browser-voice] ${message.text()}`);
  });
  let tokenRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/realtime/token")) tokenRequests += 1;
  });
  await seedExplicitDemo(page);
  await page.goto("/today");
  expect(await page.evaluate(() => typeof RTCPeerConnection)).toBe("function");
  const start = page.getByRole("button", { name: "Start live voice session" });
  await expect(start).toBeEnabled();
  const tokenResponse = page.waitForResponse((response) => response.url().includes("/api/realtime/token"));

  const startAt = Date.now();
  await start.click();
  const response = await tokenResponse;
  const tokenResponseAt = Date.now();
  expect(response.status()).toBe(200);
  await expect(page.getByText("Listening…")).toBeVisible({ timeout: 20_000 });
  const readyAt = Date.now();
  console.info(`[realtime-live-smoke] ${JSON.stringify({ tokenResponseMs: tokenResponseAt - startAt, readyMs: readyAt - startAt, tokenRequests })}`);
  await page.waitForTimeout(6_000);
  expect(tokenRequests).toBe(1);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  expect(tokenRequests).toBe(1);
});

test("one real audio turn publishes and persists an initial recommendation", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(process.env.LIVE_FULL_TURN !== "true", "Opt-in paid Realtime and ranking smoke only.");
  const lifecycle: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("yiyi_voice_lifecycle")) lifecycle.push(message.text());
  });
  await installTokenProxy(page);
  await seedExplicitDemo(page);
  await page.goto("/today");
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("Listening…")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(7_000);
  await page.getByRole("button", { name: "Done speaking" }).click();
  await expect(page.getByText("I’d wear this one today.")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("button", { name: "Open today details" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Open today details" }).click();
  await expect(page.getByText("What YiYi heard")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Dismiss Today details" }).click();

  const persisted = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, reject) => {
      const request = indexedDB.open("yiyi");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = (storeName: string) => new Promise<number>((resolveCount, reject) => {
      const request = database.transaction(storeName).objectStore(storeName).count();
      request.onsuccess = () => resolveCount(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = {
      dailySessions: await count("dailySessions"),
      outfitVersions: await count("outfitVersions"),
    };
    database.close();
    return result;
  });
  expect(persisted.dailySessions).toBeGreaterThan(0);
  expect(persisted.outfitVersions).toBeGreaterThan(0);
  expect(lifecycle.some((entry) => entry.includes('"realtimeEvent":"response.created"'))).toBe(true);
  expect(lifecycle.some((entry) => entry.includes('"toolName":"request_outfit_recommendation"') && entry.includes('"success":true'))).toBe(true);
});

test("Today error recovery keeps the hero and dock on the shared center axis", async ({ page }, testInfo) => {
  test.skip(Boolean(process.env.LIVE_BASE_URL), "The deterministic failure boundary runs only against the local live client.");
  await page.route("**/api/realtime/token", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      error: { code: "TOKEN_PROVIDER_FAILED", message: "Unavailable", retryable: true },
    }),
  }));
  await seedExplicitDemo(page);
  await page.goto("/today");
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("YiYi couldn’t finish that.")).toBeVisible();
  await expect(page.locator('section[aria-label="Today page"]').getByText(/TOKEN_PROVIDER_FAILED/)).toHaveCount(0);

  for (const [width, height] of [[375, 667], [390, 844], [393, 852], [430, 932]] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(180);
    const selectors = [".weather-pill", ".error-state .voice-core", ".error-state h1", ".voice-dock-primary"];
    const boxes = await Promise.all(selectors.map((selector) => page.locator(selector).boundingBox()));
    boxes.forEach((box) => expect(box).not.toBeNull());
    for (const [index, box] of boxes.entries()) {
      const center = (box?.x ?? 0) + ((box?.width ?? 0) / 2);
      expect(Math.abs(center - (width / 2)), `${selectors[index]} center`).toBeLessThanOrEqual(1.5);
    }
    await testInfo.attach(`today-error-${width}x${height}`, {
      body: await page.locator('section[aria-label="Today page"]').screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator('.voice-core[data-state="error"]')).toBeVisible();
});

test("Fine-tune uses the same single-owner lifecycle and releases it on navigation", async ({ page }) => {
  let tokenRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/realtime/token")) tokenRequests += 1;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Begin" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Allow Microphone" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("Fine-tune YiYi")).toBeVisible();
  const tokenResponse = page.waitForResponse((response) => response.url().includes("/api/realtime/token"));

  await page.getByRole("button", { name: "Tell YiYi another preference" }).click();
  expect((await tokenResponse).status()).toBe(200);
  await expect(page.getByText("Listening…")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3_000);
  expect(tokenRequests).toBe(1);

  await page.goto("/");
  await page.waitForTimeout(500);
  expect(tokenRequests).toBe(1);
});
