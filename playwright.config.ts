import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // The deterministic visual/motion contract runs serially in the dedicated
  // WebKit configuration. Keeping it out of the general parallel E2E matrix
  // avoids duplicate baselines and sticky review chrome in desktop snapshots.
  testIgnore: "motion-review.spec.ts",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "AI_MODE=mock NEXT_PUBLIC_VOICE_MODE=mock NEXT_PUBLIC_SEED_DEMO_WARDROBE=true pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-iphone", use: { ...devices["iPhone 15"] } },
  ],
});
