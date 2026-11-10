import { defineConfig } from '@playwright/test';
import base from './playwright.collections-ux.config';

export default defineConfig({
  ...base,
  testMatch: /payment-options-visual\.spec\.ts/,
  outputDir: '/tmp/opencode/dc-payment-options-visual/results',
});
