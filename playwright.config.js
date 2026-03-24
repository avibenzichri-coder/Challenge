// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 20000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  projects: [
    {
      name: 'Desktop Chrome',
      use: { headless: true, viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'iPhone 14',
      use: { ...devices['iPhone 14'], browserName: 'chromium', headless: true },
    },
  ],
});
