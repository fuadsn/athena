import { defineConfig, devices } from '@playwright/test';

const recording = process.env.ATHENA_RECORD_DEMO === '1';
const recordingDirectory = `.local/demo-recordings/${new Date().toISOString().replaceAll(':', '-')}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 360_000,
  expect: { timeout: 130_000 },
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: '.local/playwright-report', open: 'never' }]],
  outputDir: recording ? recordingDirectory : '.local/playwright-results',
  use: {
    ignoreHTTPSErrors: process.env.ATHENA_HOSTED_TEST === '1',
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: recording ? { mode: 'on', size: { width: 1440, height: 1000 } } : 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 }, launchOptions: {
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    ...(recording ? { slowMo: 200 } : {}),
  } } }],
});
