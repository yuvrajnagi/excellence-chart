import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './',
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3018',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node /workspaces/excellence-chart/apps/server/dist/index.js',
    url: 'http://127.0.0.1:3018/api/health',
    env: { PORT: '3018', DATA_DIR: '.openexcel/e2e', STATIC_DIR: '/workspaces/excellence-chart/apps/web/dist' },
    reuseExistingServer: true,
    timeout: 30000,
  },
});
