import { defineConfig, devices } from "@playwright/test";

const liveBaseURL = process.env.LIVE_BASE_URL ?? "http://localhost:3100";
const fakeAudioArgs = [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  ...(process.env.LIVE_AUDIO_FILE ? [`--use-file-for-fake-audio-capture=${process.env.LIVE_AUDIO_FILE}`] : []),
];

export default defineConfig({
  testDir: "./tests/live",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: liveBaseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["microphone"],
    ...devices["Desktop Chrome"],
    launchOptions: { args: fakeAudioArgs },
  },
  webServer: process.env.LIVE_BASE_URL ? undefined : {
    command: "AI_MODE=mock NEXT_PUBLIC_VOICE_MODE=live NEXT_PUBLIC_SEED_DEMO_WARDROBE=true pnpm dev --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium-live", use: { ...devices["Desktop Chrome"] } }],
});
