import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for AEGIS Security Console
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Next.js dev compiles routes on first hit; limited parallelism avoids spurious navigation timeouts.
  workers: process.env.CI ? 1 : 2,
  reporter: [['html', { outputFolder: '../../playwright-report' }], ['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    // A production build avoids on-demand compilation timeouts and tests what actually ships.
    command:
      'npm run build -w @aegis/console && npm run start -w @aegis/console',
    // Run from the repository root so npm resolves the workspace.
    cwd: '../..',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
