import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '*.spec.js',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8080',
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 800 },
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: { command: 'python3 -m http.server 8080 --bind 127.0.0.1 >/dev/null 2>&1', url: 'http://127.0.0.1:8080/index.html', reuseExistingServer: !process.env.CI },
});
