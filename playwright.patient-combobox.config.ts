import { defineConfig } from '@playwright/test';
import base from './playwright.ui-unification.config';

/** F2b: isolated delta only. F2a evidence is never overwritten. */
export default defineConfig({
  ...base,
  testMatch: /patient-combobox\.spec\.ts/,
  outputDir: '/tmp/opencode/dc-ui-f2b/playwright-results',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5302' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5302 --strictPort',
    url: 'http://127.0.0.1:5302', reuseExistingServer: false,
  },
});
