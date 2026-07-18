import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("yiyi:onboarding-complete", "true"));
});

test("continuous voice recommendation, targeted revision, and confirmation", async ({ page }) => {
  await page.goto("/today");
  await expect(page.getByText("Tell YiYi about your day.")).toBeVisible();
  await page.getByRole("button", { name: "Start live voice session" }).click();
  await expect(page.getByText("Listening…")).toBeVisible();
  await expect(page.getByText("I’d wear this one today.")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: /Show outfit/ })).toHaveCount(3);
  await page.getByRole("button", { name: "Gallery" }).click();
  await page.getByRole("textbox", { name: "Intent tag" }).fill("Museum");
  await page.getByRole("button", { name: "Update outfit" }).click();
  await expect(page.getByRole("button", { name: "Museum" })).toBeVisible();
  await page.getByRole("button", { name: "Next outfit" }).click();
  await expect(page.getByText("A more relaxed direction.")).toBeVisible();
  await page.getByRole("button", { name: "Previous outfit" }).click();
  await page.getByText("Try a bag revision").click();
  await expect(page.getByText("The bag feels too formal.")).toBeVisible();
  await expect(page.getByText("Better. I kept everything else.")).toBeVisible({ timeout: 3_000 });
  await page.getByRole("button", { name: "Wear this today" }).click();
  await expect(page.getByText("Outfit decided.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Outfit decided.")).toBeVisible();
});

test("wardrobe, item details, and preference memory are reachable", async ({ page }) => {
  await page.goto("/wardrobe");
  await expect(page.getByText("My wardrobe")).toBeVisible();
  await page.locator(".wardrobe-tile").first().click();
  await expect(page.getByText("Availability")).toBeVisible();
  await page.goto("/preferences");
  await expect(page.getByText("What YiYi remembers")).toBeVisible();
  await expect(page.getByText("Usually prefer silver-tone jewelry")).toBeVisible();
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
  const avoidSection = page.locator(".memory-section").filter({ hasText: "Usually avoid" });
  await avoidSection.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: "New saved preference" }).fill("neon colors");
  await page.getByRole("button", { name: "Add memory" }).click();
  await expect(page.getByText("neon colors", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Done editing" }).click();
  await page.goto("/today");
  await page.goto("/preferences");
  await expect(page.getByText("neon colors", { exact: true })).toBeVisible();
});

test("mock image processing saves Blob-backed clothing", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "Playwright WebKit cannot serialize Blob values into IndexedDB; real Safari remains a device test.");
  await page.goto("/wardrobe/add");
  const fixture = resolve(process.cwd(), "public/demo-wardrobe/wardrobe-sprite.webp");
  await page.locator('input[type="file"]').nth(1).setInputFiles(fixture);
  await expect(page.getByText("Review item")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Ready to add")).toBeVisible();
  await page.getByRole("button", { name: "Add to wardrobe" }).click();
  await expect(page).toHaveURL(/\/wardrobe$/);
  await expect(page.getByText("Soft jacket")).toBeVisible();
  await expect(page.getByText("1 items")).toBeVisible();
});

test("mock image processing reaches a validated review on mobile engines", async ({ page }) => {
  await page.goto("/wardrobe/add");
  const fixture = resolve(process.cwd(), "public/demo-wardrobe/wardrobe-sprite.webp");
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
  await expect(page.getByText("Cool and effortless, with enough comfort for the full day.")).toBeVisible();
});
