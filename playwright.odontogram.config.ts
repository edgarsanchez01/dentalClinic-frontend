import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** E3 only: own Vite server; any accidental proxy request cannot reach the persistent backend. */
export default defineConfig({
  ...base,
  testMatch: '**/odontogram-history.spec.ts',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5189' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5189 --strictPort',
    url: 'http://127.0.0.1:5189',
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: 'http://127.0.0.1:1' },
  },
});
