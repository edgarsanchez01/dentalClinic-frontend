import { defineConfig } from '@playwright/test';
import base from './playwright.ui-unification.config';

export default defineConfig({
  ...base,
  testMatch: /f3-unification\.spec\.ts/,
  outputDir: '/tmp/opencode/dc-ui-f3/playwright-results',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5303' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5303 --strictPort',
    url: 'http://127.0.0.1:5303', reuseExistingServer: false,
  },
});
