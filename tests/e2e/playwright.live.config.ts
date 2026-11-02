import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * Live E2E: the console in real mode against a running AEGIS stack (no mock data).
 * Prerequisites: `npm run dev:init` and the Docker Compose stack (API on :3000, gateway on :3001).
 * Run: npm run test:e2e:live
 */
const devKey = fileURLToPath(
  new URL('../../.backend-tmp/dev/private.pem', import.meta.url),
);

export default defineConfig({
  testDir: './live',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3101',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // next dev (NODE_ENV=development): the console's dev-signer credential is refused in production builds.
    command: 'npx -w @aegis/console next dev --port 3101',
    cwd: '../..',
    url: 'http://localhost:3101',
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_DEMO_MODE: 'false',
      AEGIS_API_URL: process.env.AEGIS_API_URL ?? 'http://127.0.0.1:3000',
      AEGIS_CONSOLE_AUTH_MODE: 'dev-signer',
      AEGIS_CONSOLE_DEV_SIGNING_KEY_FILE: devKey,
      AEGIS_CONSOLE_DEV_SUBJECT: 'demo-human',
      JWT_ISSUER: 'https://identity.aegis.local.invalid',
      JWT_AUDIENCE: 'aegis-local',
    },
  },
});
