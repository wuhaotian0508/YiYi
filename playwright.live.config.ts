import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/live",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["microphone"],
    ...devices["Desktop Chrome"],
    launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  },
  webServer: {
    command: "AI_MODE=mock NEXT_PUBLIC_VOICE_MODE=live NEXT_PUBLIC_SEED_DEMO_WARDROBE=true pnpm dev --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium-live", use: { ...devices["Desktop Chrome"] } }],
});
