import { defineConfig, devices } from '@playwright/test';

const real = process.env.DENTALCLINIC_FINANCIAL_API_URL;
export default defineConfig({
  testDir: './e2e',
  ...(real ? { testMatch: 'financial.real.spec.ts' } : { testIgnore: '**/*.real.spec.ts' }),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: 'list',
  outputDir: process.env.DENTALCLINIC_FINANCIAL_OUTPUT ?? '/tmp/opencode/dentalclinic-financial-f4a-e2e',
  use: { baseURL: 'http://localhost:5195', trace: 'retain-on-failure', screenshot: 'only-on-failure',
    ...(process.env.DENTALCLINIC_BROWSER_EXECUTABLE ? { launchOptions: { executablePath: process.env.DENTALCLINIC_BROWSER_EXECUTABLE } } : {}) },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5195 --strictPort',
    url: 'http://localhost:5195', reuseExistingServer: false, timeout: 120_000,
    // Las pruebas interceptadas no pueden alcanzar accidentalmente un backend de desarrollo.
    env: { VITE_API_PROXY_TARGET: real ?? 'http://127.0.0.1:9', VITE_API_BASE_URL: '' },
  },
});
