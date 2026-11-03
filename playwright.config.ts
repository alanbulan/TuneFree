import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Keep browser tests separate from Vitest's *.test.* / *.spec.* discovery.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  workers: 2,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3101',
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // Exercise the same production chunks embedded by the native application.
    command: 'npm run build && npm run start',
    url: 'http://127.0.0.1:3101/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
