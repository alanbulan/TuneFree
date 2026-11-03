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
    command: 'npm run dev',
    url: 'http://127.0.0.1:3101/library/playlists',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
