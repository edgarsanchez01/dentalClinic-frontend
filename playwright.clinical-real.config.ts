import { defineConfig, devices } from '@playwright/test';

// La JVM de ClinicalTraceBrowserIT proporciona un backend REAL y PostgreSQL efímero.
// Puerto propio, sin reutilizar servidores del propietario ni interceptar HTTP.
if (!process.env.DENTALCLINIC_REAL_API_URL) throw new Error('Ejecuta mvn -Dtest=ClinicalTraceBrowserIT test desde backend/.');

export default defineConfig({
  testDir: './e2e',
  testMatch: 'clinical-attention.real.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  outputDir: process.env.DENTALCLINIC_REAL_OUTPUT ?? '/tmp/opencode/dentalclinic-1b1-real-e2e',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5187', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5187 --strictPort',
    url: 'http://127.0.0.1:5187',
    reuseExistingServer: false,
    env: { VITE_API_PROXY_TARGET: process.env.DENTALCLINIC_REAL_API_URL, VITE_API_BASE_URL: '' },
    timeout: 120_000,
  },
});
