import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Dedicated SPA port: do not reuse or stop an existing developer server. */
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:5298' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5298 --strictPort',
    url: 'http://127.0.0.1:5298', reuseExistingServer: false, timeout: 120_000,
  },
});
