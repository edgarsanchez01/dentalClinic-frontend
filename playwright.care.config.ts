import { defineConfig, devices } from '@playwright/test';

/** Isolated SPA + explicitly mocked API. Never proxies unknown requests to an operator backend. */
export default defineConfig({
  testDir: './e2e', testMatch: ['ux05c-care.spec.ts', 'ux05b1-clinical-workspace.spec.ts', 'ux05b1-agenda.spec.ts'],
  workers: 1, retries: 0, timeout: 30_000,
  outputDir: '/tmp/opencode/ux05c-mocks-artifacts', reporter: [['list'], ['json', { outputFile: '/tmp/opencode/ux05c-mocks-playwright.json' }]],
  use: { baseURL: 'http://127.0.0.1:5197', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5197 --strictPort', url: 'http://127.0.0.1:5197', reuseExistingServer: false,
    env: { VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: 'http://127.0.0.1:1' } },
});
