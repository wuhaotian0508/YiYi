import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function setCompletedPersonal(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveOpen, reject) => {
      const request = indexedDB.open("yiyi");
      request.onsuccess = () => resolveOpen(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolveWrite, reject) => {
      const transaction = database.transaction("appSettings", "readwrite");
      transaction.objectStore("appSettings").put({ key: "experienceMode", value: "personal" });
      transaction.objectStore("appSettings").put({ key: "onboardingState", value: JSON.stringify({ status: "complete", version: 1, completedAt: Date.now(), experienceMode: "personal" }) });
      transaction.oncomplete = () => resolveWrite();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
}

async function expectFreshDeviceIsGated(context: BrowserContext, path: string) {
  const page = await context.newPage();
  await page.goto(path);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
  await page.close();
}

test("clean devices cannot bypass onboarding through Today or wardrobe deep links", async ({ browser }) => {
  const todayDevice = await browser.newContext();
  const addDevice = await browser.newContext();
  await expectFreshDeviceIsGated(todayDevice, "/today");
  await expectFreshDeviceIsGated(addDevice, "/wardrobe/add");
  await todayDevice.close();
  await addDevice.close();
});

test("completion is isolated per device and personal mode stays empty", async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  const firstPage = await first.newPage();
  await setCompletedPersonal(firstPage);
  await firstPage.goto("/wardrobe");
  await expect(firstPage).toHaveURL(/\/wardrobe$/);
  await expect(firstPage.getByText("Your wardrobe is empty")).toBeVisible();
  await expectFreshDeviceIsGated(second, "/today");
  await first.close();
  await second.close();
});

test("device weather is live, cached across provider failure, and identifies its source", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ geolocation: { latitude: 37.77, longitude: -122.42 } });
  await context.grantPermissions(["geolocation"], baseURL ? { origin: baseURL } : undefined);
  const page = await context.newPage();
  await setCompletedPersonal(page);
  let weatherCalls = 0;
  await page.route("**/api/weather?*", async (route) => {
    weatherCalls += 1;
    if (weatherCalls > 1) {
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ requestId: "99999999-9999-4999-8999-999999999999", error: { code: "WEATHER_FAILED", message: "Unavailable", retryable: true } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ requestId: "99999999-9999-4999-8999-999999999999", source: "open-meteo", weather: { minApparentTempC: 11, maxApparentTempC: 17, precipitationProbability: 12, expectedRain: false, windy: false, summary: "Cool and dry", sourceTimestamp: Date.now() } }) });
  });

  await page.goto("/today");
  await expect(page.getByText("Cool and dry")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Cool and dry")).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByText(/Current location · updated/)).toBeVisible();
  expect(weatherCalls).toBe(2);
  await context.close();
});

test("denied location is shown as unavailable instead of fixed Demo weather", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await setCompletedPersonal(page);
  await page.goto("/today");
  await expect(page.getByText("Weather unavailable")).toBeVisible();
  await expect(page.getByText(/58°/)).toHaveCount(0);
  await context.close();
});
