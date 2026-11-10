import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:5296', reducedMotion: 'reduce' },
  webServer: [
    { command: 'npm run dev -- --host 127.0.0.1 --port 5296 --strictPort', url: 'http://127.0.0.1:5296', reuseExistingServer: false },
    ...(process.env.DC_OWNER_APPOINTMENTS_BASELINE ? [{
      command: 'npm run dev -- --host 127.0.0.1 --port 5295 --strictPort',
      cwd: process.env.DC_OWNER_APPOINTMENTS_BASELINE, url: 'http://127.0.0.1:5295', reuseExistingServer: false,
    }] : []),
  ],
});
