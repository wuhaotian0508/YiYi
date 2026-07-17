import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("capture YiYi result review set", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "One rendering engine is sufficient for the manual visual contact sheet.");
  const output = resolve(process.cwd(), "tmp/visual");
  await mkdir(output, { recursive: true });
  await page.addInitScript(() => localStorage.setItem("yiyi:onboarding-complete", "true"));
  await page.goto("/today");
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("I’d wear this one today.")).toBeVisible({ timeout: 8_000 });
  for (const [width, height] of [[375, 667], [390, 844], [393, 852], [430, 932]] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(output, `${width}x${height}-today.png`), fullPage: true });
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
  await page.getByRole("button", { name: "Show me how" }).click({ timeout: 5_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Try it yourself" }).click();
  await page.getByRole("button", { name: "Allow Microphone" }).click();
  await expect(page.getByText("Which looks feel most like you?")).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(output, "390x844-style-calibration.png"), fullPage: true });
});
