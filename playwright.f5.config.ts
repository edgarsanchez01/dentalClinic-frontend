import { defineConfig } from '@playwright/test';
import base from './playwright.ui-unification.config';

/** F5 — harness aislado: solo la spec de consolidación administrativa/tabs. */
export default defineConfig({
  ...base,
  testMatch: /f5-unification\.spec\.ts/,
  outputDir: '/tmp/opencode/dc-ui-f5/playwright-results',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5306' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5306 --strictPort',
    url: 'http://127.0.0.1:5306',
    reuseExistingServer: false,
  },
});
