import { defineConfig, devices } from '@playwright/test';

/** 9A.1: SPA real en Chromium, APIs interceptadas y proxy sin acceso a servicios persistentes. */
export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/*.real.spec.ts',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: 'list',
  outputDir: '/tmp/opencode/dentalclinic-9a1-e2e',
  use: { baseURL: 'http://localhost:5189', trace: 'retain-on-failure', screenshot: 'only-on-failure',
    ...(process.env.DENTALCLINIC_BROWSER_EXECUTABLE ? { launchOptions: { executablePath: process.env.DENTALCLINIC_BROWSER_EXECUTABLE } } : {}) },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5189 --strictPort',
    url: 'http://localhost:5189', reuseExistingServer: false, timeout: 120_000,
    env: { VITE_API_PROXY_TARGET: 'http://127.0.0.1:9', VITE_API_BASE_URL: '' },
  },
});
