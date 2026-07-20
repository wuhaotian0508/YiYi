import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "motion-review.spec.ts",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "test-results/motion-review",
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.008,
      threshold: 0.22,
    },
  },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "AI_MODE=mock NEXT_PUBLIC_VOICE_MODE=mock NEXT_PUBLIC_SEED_DEMO_WARDROBE=true pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "webkit-motion",
      use: {
        ...devices["iPhone 15"],
      },
    },
  ],
});
