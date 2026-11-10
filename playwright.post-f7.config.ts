import { defineConfig } from '@playwright/test';
import base from './playwright.f7.config';

export default defineConfig({
  ...base,
  testMatch: /(?:post-f7-visual|f7-unification)\.spec\.ts/,
  outputDir: '/tmp/opencode/dc-ui-post-f7/results',
});
