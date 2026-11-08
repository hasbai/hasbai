import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  updateSnapshots: "none",
  snapshotPathTemplate: process.env.LOCAL_VISUAL_CAPTURE_DIR
    ? `${process.env.LOCAL_VISUAL_CAPTURE_DIR}/{projectName}/{arg}{ext}`
    : `{testDir}/__screenshots__/${process.platform === "linux" ? "linux-ci/" : ""}{projectName}/{arg}{ext}`,
  reporter: [
    ["list"],
    ["../financial/scripts/visual-coverage-reporter.mjs"],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4174",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixels: 50,
    },
  },
  projects: [
    {
      name: "iphone",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        defaultBrowserType: "chromium",
        userAgent: devices["Pixel 7"].userAgent,
      },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: [
    {
      command: "node e2e/api.mjs",
      url: "http://127.0.0.1:4180/rest/v1/article",
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: "pnpm preview",
      url: "http://127.0.0.1:4174/favicon.svg",
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        PUBLIC_DATA_API_URL: "http://127.0.0.1:4180/rest/v1",
        PUBLIC_ANONYMOUS_AUTH_URL: "http://127.0.0.1:4180/auth",
      },
    },
  ],
});
