import { defineConfig } from '@playwright/test';
import base from './playwright.post-f7.config';

export default defineConfig({
  ...base,
  testMatch: /(?:owner-corrective|f7-unification|post-f7-visual)\.spec\.ts/,
  outputDir: '/tmp/opencode/dc-owner-corrective/results',
});
