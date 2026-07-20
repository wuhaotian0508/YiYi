import { expect, test } from "@playwright/test";

test("personal wardrobe mode stays empty and is not repopulated by Today", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { throw new Error("denied"); } } });
    class MockSpeechRecognition {
      lang = ""; interimResults = false; continuous = false;
      onresult: ((event: { results: { 0: { transcript: string } }[] }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() { window.setTimeout(() => this.onresult?.({ results: [{ 0: { transcript: "More soft textures and less formal structure" } }] }), 20); }
      stop() {}
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: MockSpeechRecognition });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Begin" }).click({ timeout: 6_000 });
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Allow Microphone" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "A feels like me" }).click();
  await page.getByRole("button", { name: "B feels like me" }).click();
  await page.getByRole("button", { name: "Both" }).click();
  await page.getByRole("button", { name: "Neither" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "A feels like me" }).click();
  await page.getByRole("button", { name: "Tell YiYi another preference" }).click();
  await expect(page.getByText("Microphone access is off. Check Settings and try again.")).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } }));
  await page.getByRole("button", { name: "Retry voice preference" }).click();
  await expect(page.getByText("Added to your profile")).toBeVisible();
  await expect(page.getByRole("button", { name: "Soft textures" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Formal looks" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/More soft textures and less formal structure/)).toHaveCount(0);
  await page.getByRole("button", { name: "Relaxed tailoring" }).click();
  await page.getByRole("button", { name: "Heels" }).click();
  await page.getByRole("button", { name: "Review my style" }).click();
  await expect(page.getByRole("heading", { name: "More of" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Less of" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Still open" })).toBeVisible();
  await page.getByRole("button", { name: "Undo last answer" }).click();
  await expect(page.getByText("Optional 2 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Review my style" }).click();
  await page.getByRole("button", { name: "Looks right" }).click();
  await page.getByRole("button", { name: "Add my clothes" }).click();
  await expect(page).toHaveURL(/\/wardrobe\/add$/);

  await page.goto("/wardrobe");
  await expect(page.getByText("Your wardrobe is empty")).toBeVisible();
  await expect(page.getByText("0 items")).toBeVisible();
  await page.evaluate(() => localStorage.setItem("yiyi:test-auto-voice", "true"));
  await page.goto("/today");
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("YiYi couldn’t finish that.")).toBeVisible({ timeout: 8_000 });
});
