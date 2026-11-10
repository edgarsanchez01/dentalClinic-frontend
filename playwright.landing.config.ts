import { defineConfig, devices } from '@playwright/test';

/** Solo landing y sus recorridos existentes; todas las APIs se interceptan en el spec. */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'landing.spec.ts',
  outputDir: '/tmp/opencode/dc-landing-final-polish/browser',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '/tmp/opencode/dc-landing-final-polish/browser.json' }]],
  use: { baseURL: 'http://localhost:5189', trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host localhost --port 5189 --strictPort',
    url: 'http://localhost:5189',
    reuseExistingServer: false,
  },
});
