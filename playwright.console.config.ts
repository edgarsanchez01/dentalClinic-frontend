import { defineConfig, devices } from '@playwright/test';

/** No operator backend: all API requests in these tests are intercepted and unknown routes fail. */
export default defineConfig({
  testDir: './e2e', testMatch: ['ux05e-console.spec.ts', 'ux05c-care.spec.ts', 'ux05b1-clinical-workspace.spec.ts', 'ux05b1-agenda.spec.ts'],
  workers: 1, retries: 0, timeout: 35_000,
  outputDir: '/tmp/opencode/ux05e-browser-artifacts', reporter: [['list'], ['json', { outputFile: '/tmp/opencode/ux05e-playwright.json' }]],
  use: { baseURL: 'http://127.0.0.1:5197', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5197 --strictPort', url: 'http://127.0.0.1:5197', reuseExistingServer: false,
    env: { VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: 'http://127.0.0.1:1' } },
});
