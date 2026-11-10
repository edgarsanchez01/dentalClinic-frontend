import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const fixturePath = process.env.DENTALCLINIC_INTAKE_FIXTURE;
if (!fixturePath || process.env.DENTALCLINIC_INTAKE_REAL !== '1') {
  throw new Error('Use node scripts/run-registration-real.mjs: fresh isolated 9D.6A fixture required.');
}
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { api: string; web: string; database: string };
if (fixture.database !== 'dentalclinic_9d6a' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.api) || fixture.web !== 'http://127.0.0.1:15196') {
  throw new Error('Refusing any target other than the isolated 9D.6A environment.');
}

export default defineConfig({
  testDir: './e2e', testMatch: 'patient-intake.real.spec.ts', workers: 1, retries: 0, timeout: 90_000,
  outputDir: join(dirname(fixturePath), 'real-results'), reporter: 'list',
  use: { baseURL: fixture.web, actionTimeout: 15_000, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 15196 --strictPort', url: fixture.web,
    reuseExistingServer: false, timeout: 60_000,
    env: { VITE_API_PROXY_TARGET: fixture.api, VITE_API_BASE_URL: '' },
  },
});
