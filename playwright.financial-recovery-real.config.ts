import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const file = process.env.DENTALCLINIC_B6_FIXTURE;
if (!file) throw new Error('Ejecuta FinancialRecoveryBrowserIT: necesita Spring y PostgreSQL efímeros propios.');
const fixture = JSON.parse(readFileSync(file, 'utf8'));
if (fixture.isolated !== true || fixture.database !== 'testcontainers-postgresql-16-V001-V021'
  || !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.api) || fixture.api.endsWith(':5434')) throw new Error('Entorno aislado no verificable.');
const output = process.env.DENTALCLINIC_B6_OUTPUT!;
export default defineConfig({
  testDir: './e2e', testMatch: 'financial-recovery.real.spec.ts', workers: 1, retries: 0, maxFailures: 1, timeout: 45_000,
  outputDir: join(output, 'artifacts'), reporter: [['list'], ['json', { outputFile: join(output, 'playwright.json') }]],
  use: { baseURL: 'http://127.0.0.1:5199', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5199 --strictPort', url: 'http://127.0.0.1:5199', reuseExistingServer: false,
    env: { VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: fixture.api } },
});
