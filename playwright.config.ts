import { defineConfig, devices } from '@playwright/test';

/**
 * E2E de Fase 2. El backend real no se levanta: cada spec intercepta `/api/**`
 * con `page.route`, de modo que la prueba ejerce el SPA real en un navegador real
 * (rutas, guardas, sesion en memoria, CSRF) sin depender de PostgreSQL ni de la
 * semilla de usuarios, que en Fase 2 no existe (fixtures desactivadas).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});