import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * F0 — baseline aislada de DC-UI-UNIFICATION-01.
 *
 * - Puerto propio (5298) y `reuseExistingServer: false`: nunca reutiliza un dev server abierto.
 * - Allowlist explícita: solo `e2e/ui-unification.spec.ts`. Las specs `*.real.spec.ts` y el resto
 *   de `e2e/` no se ejecutan por accidente con esta configuración.
 * - Todas las APIs se interceptan en la fixture; el backend real no se levanta.
 */
export default defineConfig({
  ...base,
  testDir: './e2e',
  testMatch: /ui-unification\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    ...base.use,
    baseURL: 'http://127.0.0.1:5298',
    // Misma zona que TIMEZONE/NOW del fixture; presentación mexicana reproducible.
    timezoneId: 'UTC',
    locale: 'es-MX',
    reducedMotion: 'reduce',
    trace: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5298 --strictPort',
    url: 'http://127.0.0.1:5298',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
