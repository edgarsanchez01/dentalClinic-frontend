import { defineConfig } from '@playwright/test';
import baseline from './playwright.ui-unification.config';

/** F1: SPA real, API interceptada, sin reutilizar servidor ni sobrescribir evidencia F0. */
export default defineConfig({
  ...baseline,
  testMatch: /ui-foundations\.spec\.ts/,
  outputDir: '/tmp/opencode/dc-ui-unification-f1/playwright-results',
  timeout: 180_000,
  use: { ...baseline.use, baseURL: 'http://127.0.0.1:5301' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5301 --strictPort',
    url: 'http://127.0.0.1:5301',
    reuseExistingServer: false,
  },
});
