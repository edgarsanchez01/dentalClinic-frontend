import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:5298', reducedMotion: 'reduce' },
  webServer: [
    { command: 'npm run dev -- --host 127.0.0.1 --port 5298 --strictPort', url: 'http://127.0.0.1:5298', reuseExistingServer: false },
    ...(process.env.DC_COLLECTIONS_BASELINE ? [{
      command: 'npm run dev -- --host 127.0.0.1 --port 5297 --strictPort',
      cwd: process.env.DC_COLLECTIONS_BASELINE, url: 'http://127.0.0.1:5297', reuseExistingServer: false,
    }] : []),
  ],
});
