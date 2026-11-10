import { defineConfig } from '@playwright/test';
import base from './playwright.ui-unification.config';

/** F6 aislada. Todas las APIs interceptadas; no se inicia backend ni BD. */
export default defineConfig({
  ...base,
  testMatch: /(?:f6-unification|owner-appointments|owner-consistency|patient-ux|ux04c-reception-operations|ux05b1-agenda)\.spec\.ts/,
  outputDir: '/tmp/opencode/dc-ui-f6/playwright-results',
  workers: 2,
  use: { ...base.use, baseURL: 'http://127.0.0.1:5307' },
  webServer: [
    { command: 'npm run dev -- --host 127.0.0.1 --port 5307 --strictPort', url: 'http://127.0.0.1:5307', reuseExistingServer: false },
    ...(process.env.DC_F6_REFERENCE ? [{ command: 'node node_modules/vite/bin/vite.js /tmp/opencode/dc-ui-f6/reference --host 127.0.0.1 --port 5308 --strictPort', url: process.env.DC_F6_REFERENCE, reuseExistingServer: false }] : []),
  ],
});
