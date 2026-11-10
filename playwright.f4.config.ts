import { defineConfig } from '@playwright/test';
import base from './playwright.ui-unification.config';
export default defineConfig({ ...base, testMatch: /f4-unification\.spec\.ts/,
  outputDir: '/tmp/opencode/dc-ui-f4/playwright-results',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5304' },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5304 --strictPort', url: 'http://127.0.0.1:5304', reuseExistingServer: false },
});
