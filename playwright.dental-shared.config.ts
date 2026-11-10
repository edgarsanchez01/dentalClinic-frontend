import { defineConfig } from '@playwright/test';
import consoleConfig from './playwright.console.config';

/** Isolated SPA with intercepted APIs; unknown requests cannot reach an operator backend. */
export default defineConfig({
  ...consoleConfig,
  testMatch: ['ux05f-shared-dental.spec.ts', 'ux05e-console.spec.ts', 'ux05b1-clinical-workspace.spec.ts', 'ux05b1-agenda.spec.ts', 'ux05c-care.spec.ts'],
  outputDir: '/tmp/opencode/ux05f-browser-artifacts',
  reporter: [['list'], ['json', { outputFile: '/tmp/opencode/ux05f-playwright.json' }]],
});
