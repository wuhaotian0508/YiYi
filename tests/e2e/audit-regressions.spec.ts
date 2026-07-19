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
  await page.getByRole("button", { name: "Begin" }).click({ timeout: 5_000 });
  await page.getByRole("button", { name: "Show me how" }).click({ timeout: 5_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Try it yourself" }).click();
  await page.getByRole("button", { name: "Allow Microphone" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "More like this" }).click();
  await page.getByRole("button", { name: "Not for me" }).click();
  await page.getByRole("button", { name: "Skip this look" }).click();
  await page.getByRole("button", { name: "More like this" }).click();
  await page.getByRole("button", { name: "Not for me" }).click();
  await page.getByRole("button", { name: "Skip this look" }).click();
  await page.getByRole("button", { name: "Tell YiYi another preference" }).click();
  await expect(page.getByText("Voice didn’t start. Tap to retry.")).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } }));
  await page.getByRole("button", { name: "Retry voice preference" }).click();
  await expect(page.getByText("Added to your profile")).toBeVisible();
  await expect(page.getByText("“More soft textures and less formal structure”").last()).toBeVisible();
  await page.getByRole("button", { name: "Relaxed tailoring" }).click();
  await page.getByRole("button", { name: "Heels" }).click();
  await page.getByRole("button", { name: "Review my style" }).click();
  await expect(page.getByText("2 liked · 2 less like me")).toBeVisible();
  await expect(page.getByText("“More soft textures and less formal structure”").last()).toBeVisible();
  await page.getByRole("button", { name: "Undo last style answer" }).click();
  await expect(page.getByText("How does this feel?")).toBeVisible();
  await page.getByRole("button", { name: "Skip this look" }).click();
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
