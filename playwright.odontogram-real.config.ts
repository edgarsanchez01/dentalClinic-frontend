import { defineConfig, devices } from '@playwright/test';

// Validación integrada 1B.3 (previa a E5): SPA E3 + backend E2 + PostgreSQL 16 reales.
// El backend lo levanta OdontogramHistoryBrowserIT sobre Testcontainers efímero (V001–V015).
// Vite propio en un puerto libre; sin interceptar HTTP. Requiere DENTALCLINIC_REAL_API_URL.
if (!process.env.DENTALCLINIC_REAL_API_URL) {
  throw new Error(
    'Ejecuta: mvn -Dtest=OdontogramHistoryBrowserIT test desde backend/ (define DENTALCLINIC_REAL_API_URL).',
  );
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'odontogram-history.real.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  outputDir: process.env.DENTALCLINIC_REAL_OUTPUT ?? '/tmp/opencode/dentalclinic-1b3-integrated-e2e',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5188',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5188 --strictPort',
    url: 'http://127.0.0.1:5188',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_API_PROXY_TARGET: process.env.DENTALCLINIC_REAL_API_URL,
      VITE_API_BASE_URL: '',
    },
  },
});
