import { defineConfig } from '@playwright/test';
import base from './playwright.f7.config';

export default defineConfig({
  ...base,
  testMatch: /collections-ux\.spec\.ts/,
  workers: 1,
  retries: 0,
  use: { ...base.use, actionTimeout: 15_000 },
  outputDir: '/tmp/opencode/dc-collections-two-step/results',
});
