import { defineConfig } from '@playwright/test';
import base from './playwright.ui-unification.config';

/** F7: superficies y journeys simulados únicamente; no backend/BD. */
export default defineConfig({
  ...base,
  testMatch: /(?:f7-unification|owner-team-editor|owner-clinic|dentist-scheduling|ux04g-services-scheduling)\.spec\.ts/,
  outputDir: '/tmp/opencode/dc-ui-f7/playwright-results',
  workers: 2,
  use: { ...base.use, baseURL: 'http://127.0.0.1:5309' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5309 --strictPort',
    url: 'http://127.0.0.1:5309', reuseExistingServer: false,
  },
});
