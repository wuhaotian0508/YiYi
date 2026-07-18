import { expect, test } from "@playwright/test";

test("personal wardrobe mode stays empty and is not repopulated by Today", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [] }) } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Show me how" }).click({ timeout: 5_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Try it yourself" }).click();
  await page.getByRole("button", { name: "Allow Microphone" }).click();
  await page.getByRole("button", { name: "Style look 1" }).click();
  await page.getByRole("button", { name: "Style look 2" }).click();
  await page.getByRole("button", { name: "Style look 3" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Least-like style 1" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Looks right" }).click();
  await page.getByRole("button", { name: "Add my clothes" }).click();
  await expect(page).toHaveURL(/\/wardrobe\/add$/);

  await page.goto("/wardrobe");
  await expect(page.getByText("Your wardrobe is empty")).toBeVisible();
  await expect(page.getByText("0 items")).toBeVisible();
  await page.goto("/today");
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("YiYi couldn’t finish that.")).toBeVisible({ timeout: 8_000 });
});
