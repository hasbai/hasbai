import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  // Missing baselines fail normal runs, including CI; updates are always explicit.
  updateSnapshots: "none",
  snapshotPathTemplate: process.env.LOCAL_VISUAL_CAPTURE_DIR
    ? `${process.env.LOCAL_VISUAL_CAPTURE_DIR}/{projectName}/{testFilePath}/{arg}{ext}`
    : `{testDir}/__screenshots__/${process.platform === "linux" ? "linux-ci" : `{platform}${process.env.GITHUB_ACTIONS ? "-ci" : ""}`}-{projectName}/{testFilePath}/{arg}{ext}`,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["./scripts/visual-coverage-reporter.mjs"],
  ],
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      maxDiffPixels: 50,
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "light",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "iphone",
      testMatch: /(mobile|states)\.spec\.ts/,
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        defaultBrowserType: "chromium",
        userAgent: devices["Pixel 7"].userAgent,
      },
    },
    {
      name: "iphone-se",
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...devices["iPhone SE"],
        browserName: "chromium",
        defaultBrowserType: "chromium",
        userAgent: devices["Pixel 7"].userAgent,
      },
    },
    {
      name: "android",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    {
      name: "desktop",
      testMatch: /desktop\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command:
      "pnpm exec vite preview --mode e2e --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/e2e/index.html",
    reuseExistingServer: false,
    env: { VITE_DATA_API_URL: "http://127.0.0.1:4173/test-api" },
  },
});
