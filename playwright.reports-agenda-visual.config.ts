import { defineConfig } from '@playwright/test';
import base from './playwright.f7.config';

export default defineConfig({
  ...base,
  testMatch: /reports-agenda-visual\.spec\.ts/,
  workers: 1,
  outputDir: '/tmp/opencode/dc-reports-agenda-visual/results',
});
