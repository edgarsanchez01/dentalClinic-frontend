import { defineConfig } from '@playwright/test';
import base from './playwright.f7.config';

export default defineConfig({
  ...base,
  testMatch: /(?:appointments-corrective|f6-unification)\.spec\.ts/,
  outputDir: '/tmp/opencode/dc-appointments-corrective/results',
});
