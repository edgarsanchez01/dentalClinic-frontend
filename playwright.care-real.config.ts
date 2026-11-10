import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const file = process.env.DENTALCLINIC_CARE_FIXTURE;
if (!file) throw new Error('Ejecuta SeparatedCareBrowserIT: requiere PostgreSQL efímero y backend propios.');
const fixture = JSON.parse(readFileSync(file, 'utf8'));
if (fixture.isolated !== true || fixture.database !== 'jdbc:tc:postgresql:16:///dentalclinic_ux05c_browser?TC_TMPFS=/var/lib/postgresql/data:rw'
  || !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.api) || fixture.api.endsWith(':5434')) throw new Error('Entorno aislado no verificable.');
const output = process.env.DENTALCLINIC_CARE_OUTPUT!;
export default defineConfig({
  testDir: './e2e', testMatch: 'ux05c-care.real.spec.ts', workers: 1, retries: 0, timeout: 50_000,
  outputDir: join(output, 'artifacts'), reporter: [['list'], ['json', { outputFile: join(output, 'playwright.json') }]],
  use: { baseURL: 'http://127.0.0.1:5198', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5198 --strictPort', url: 'http://127.0.0.1:5198', reuseExistingServer: false,
    env: { VITE_API_BASE_URL: '', VITE_API_PROXY_TARGET: fixture.api } },
});
