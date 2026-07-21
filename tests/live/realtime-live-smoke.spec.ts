import { expect, test } from "@playwright/test";

test("one explicit start creates one Realtime token and one reusable ready session", async ({ page }) => {
  let tokenRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/realtime/token")) tokenRequests += 1;
  });
  await page.addInitScript(() => {
    localStorage.setItem("yiyi:onboarding-complete", "true");
    localStorage.removeItem("yiyi:test-auto-voice");
  });
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

  await page.getByRole("button", { name: "End voice session" }).click();
  await expect(page.getByRole("button", { name: "Start live voice session" })).toBeEnabled();
  expect(tokenRequests).toBe(1);
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

  await page.goto("/today");
  await expect(page.getByRole("button", { name: "Start live voice session" })).toBeEnabled();
  expect(tokenRequests).toBe(1);
});
