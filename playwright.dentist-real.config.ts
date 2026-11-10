import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * UX-05A.1 — Configuración de Playwright contra el backend REAL del entorno de demostración.
 *
 * NO intercepta `/api/**`: el SPA habla con el backend demo arrancado por
 * `scripts/run-ux05a-demo.mjs`, que apunta a una base PostgreSQL efímera y aislada.
 *
 * Rechaza cualquier objetivo que no sea el entorno demo aislado (mismo patrón que
 * `playwright.intake-real.config.ts`).
 */
const fixturePath = process.env.DENTALCLINIC_DENTIST_FIXTURE;
if (!fixturePath || process.env.DENTALCLINIC_DENTIST_REAL !== '1') {
  throw new Error('Use node scripts/run-ux05a-demo.mjs: fresh isolated UX-05A demo environment required.');
}
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { api: string; web: string; database: string };
if (fixture.database !== 'dentalclinic_ux05a_demo'
    || !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.api)
    || fixture.web !== 'http://127.0.0.1:15197') {
  throw new Error('Refusing any target other than the isolated UX-05A demo environment.');
}

export default defineConfig({
  testDir: './e2e',
  testMatch: process.env.DENTALCLINIC_UX05B === '1' ? 'ux05b-dentist-appointments.real.spec.ts' : 'ux05a-dentist-home.real.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 90_000,
  outputDir: join(dirname(fixturePath), 'real-results'),
  reporter: 'list',
  use: { baseURL: fixture.web, actionTimeout: 15_000, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 15197 --strictPort',
    url: fixture.web,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { VITE_API_PROXY_TARGET: fixture.api, VITE_API_BASE_URL: '' },
  },
});
