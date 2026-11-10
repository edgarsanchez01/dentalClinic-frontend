import { defineConfig, devices } from '@playwright/test';
if (!process.env.DENTALCLINIC_REAL_API_URL) throw new Error('Ejecuta mvn -Dtest=FeedbackBrowserIT test desde backend/.');
export default defineConfig({
  testDir: './e2e', testMatch: 'feedback.real.spec.ts', workers: 1, retries: 0, timeout: 60_000,
  outputDir: '/tmp/opencode/dentalclinic-feedback-browser', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5196', trace: 'off', screenshot: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5196 --strictPort', url: 'http://127.0.0.1:5196',
    reuseExistingServer: false, timeout: 120_000,
    env: { VITE_API_PROXY_TARGET: process.env.DENTALCLINIC_REAL_API_URL, VITE_API_BASE_URL: '' } },
});
