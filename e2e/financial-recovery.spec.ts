import { expect, test, type Page } from '@playwright/test';
import type { FinancialIntentOperation, FinancialIntentView } from '../src/api/financialIntents';

const NOW = '2026-10-27T16:00:00Z';
const KEY = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const ops: FinancialIntentOperation[] = ['FIN_CONFIRM_CHARGE', 'FIN_REGISTER_PAYMENT', 'FIN_REVERSE_PAYMENT', 'FIN_CANCEL_CHARGE'];

async function fixture(page: Page, role: string, operation: FinancialIntentOperation = 'FIN_REGISTER_PAYMENT') {
  const server = { view: { operation, intentId: KEY, state: 'REGISTERED', registeredAt: NOW } as FinancialIntentView,
    writes: [] as Array<{ path: string; body: unknown }>, reads: [] as string[], error: false, account: 1, loggedIn: true };
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path === '/api/auth/refresh' || path === '/api/auth/login') {
      if (path.endsWith('/login')) server.loggedIn = true;
      await route.fulfill({ status: server.loggedIn ? 200 : 401, json: server.loggedIn ? { accessToken: 'synthetic-b5' } : {} }); return;
    }
    if (path === '/api/auth/logout') { server.loggedIn = false; await route.fulfill({ status: 204 }); return; }
    let body: unknown;
    if (path === '/api/auth/me') body = { id: server.account, role, email: 'synthetic@b5.test', active: true, createdAt: NOW };
    else if (path === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (path === '/api/notifications/unread-count') body = { unread: 0 };
    else if (path === '/api/patients') body = { content: [], page: 0, size: 10, totalElements: 0, totalPages: 0 };
    else if (path === '/api/charges') body = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
    else if (path.startsWith('/api/financial-intents')) {
      if (request.method() === 'GET') {
        server.reads.push(path + url.search);
        if (server.error) { await route.fulfill({ status: 503, json: { code: 'INTENT_VERIFICATION_UNAVAILABLE', message: 'No se pudo verificar la operación.' } }); return; }
        body = path === '/api/financial-intents' ? { items: server.account === 1 && (url.searchParams.get('view') === 'recent' || server.view.state === 'REGISTERED') ? [server.view] : [] } : server.view;
      } else {
        server.writes.push({ path, body: request.postDataJSON() });
        if (path.endsWith('/execute')) server.view = { ...server.view, state: 'CONFIRMED', effect: { chargeId: 7,
          ...(['FIN_REGISTER_PAYMENT', 'FIN_REVERSE_PAYMENT'].includes(operation) ? { movementId: 9 } : {}) } };
        else if (path.endsWith('/abandon')) server.view = { ...server.view, state: 'ABANDONED', closedAt: NOW };
        else { await route.fulfill({ status: 400, json: { message: 'No se admite registro automatico.' } }); return; }
        body = server.view;
      }
    } else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ json: body, headers: { 'Cache-Control': 'no-store' } });
  });
  return server;
}

async function openRecovery(page: Page) {
  await page.getByText(/Revisar pendientes y recientes/).click();
  await page.getByRole('button', { name: 'Revisar operación' }).click();
  return page.getByRole('region', { name: 'Operación recuperada' });
}

for (const operation of ops) {
  test(`B5 ${operation}: recarga descubre, consulta no opera y reanudacion usa el mismo UUID`, async ({ page }) => {
    const api = await fixture(page, 'OWNER', operation);
    await page.goto('/finances');
    await expect(page.getByRole('heading', { name: 'Tus operaciones financieras' })).toBeVisible();
    await page.reload();
    const recovery = await openRecovery(page);
    await recovery.getByRole('button', { name: 'Consultar operación' }).click();
    await expect(recovery.getByText('Registrada · pendiente de ejecución', { exact: true })).toBeVisible();
    expect(api.writes).toEqual([]);
    await recovery.getByRole('button', { name: 'Reanudar operación' }).click();
    expect(api.writes).toEqual([]);
    await recovery.getByRole('button', { name: 'Confirmar reanudación' }).click();
    await expect(recovery.getByText('Confirmada', { exact: true })).toBeVisible();
    expect(api.writes).toEqual([{ path: `/api/financial-intents/${operation}/${KEY}/execute`, body: {} }]);
    const dump = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, href: location.href, state: history.state }));
    expect(dump).not.toContain(KEY); expect(dump).not.toContain('command');
    await recovery.getByRole('button', { name: 'Consultar operación' }).click();
    await expect(recovery.getByText('Confirmada', { exact: true })).toBeVisible();
    expect(api.writes).toHaveLength(1);
  });
}

for (const role of ['OWNER', 'RECEPTIONIST']) for (const width of [1440, 390]) {
  test(`B5 ${role} ${width}px: presentacion existente, teclado y abandono sin efecto`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, role);
    await page.goto('/finances');
    const summary = page.getByText(/Revisar pendientes y recientes/);
    await summary.focus(); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Revisar operación' }).click();
    const recovery = page.getByRole('region', { name: 'Operación recuperada' });
    await page.evaluate(() => document.fonts.ready);
    if (process.env.DC_B5_CAPTURE) await page.screenshot({ path: test.info().outputPath(`b5-${role}-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await recovery.getByRole('button', { name: 'Abandonar operación' }).click();
    await recovery.getByRole('button', { name: 'Confirmar abandono' }).click();
    await expect(recovery.getByText('Abandonada sin efecto', { exact: true })).toBeVisible();
    await expect(recovery.getByRole('button', { name: 'Reanudar operación' })).toHaveCount(0);
  });
}

for (const account of [1, 2]) test(`B5 fallo mantiene UNCERTAIN y nuevo login de actor ${account} solo descubre lo propio`, async ({ page }) => {
  const api = await fixture(page, 'RECEPTIONIST');
  await page.goto('/finances');
  const recovery = await openRecovery(page);
  api.error = true;
  await recovery.getByRole('button', { name: 'Consultar operación' }).click();
  await expect(recovery.getByText('Resultado incierto', { exact: true })).toBeVisible();
  await expect(recovery.getByRole('button', { name: 'Reanudar operación' })).toHaveCount(0);
  expect(api.writes).toEqual([]);
  // Logout no abandona; la copia de presentacion se limpia al reemplazar la sesion.
  await page.getByRole('button', { name: /Cerrar sesión/ }).first().click();
  await page.getByRole('button', { name: 'Salir de esta vista' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('region', { name: 'Operación recuperada' })).toHaveCount(0);
  api.error = false; api.account = account;
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill('other@b5.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto('/finances');
  await page.getByText(/Revisar pendientes y recientes/).click();
  if (account === 1) await expect(page.getByRole('button', { name: 'Revisar operación' })).toBeVisible();
  else await expect(page.getByText('No hay operaciones pendientes en esta página.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Operación recuperada' })).toHaveCount(0);
  expect(api.writes).toEqual([]);
});
