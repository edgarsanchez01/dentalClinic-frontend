import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.skip(!process.env.DENTALCLINIC_FINANCIAL_API_URL, 'Solo con el backend y PostgreSQL efimeros del launcher financiero.');
const fixture = JSON.parse(process.env.DENTALCLINIC_FINANCIAL_FIXTURE ?? '{}') as {
  patientId: number; appointmentId: number; ownChargeId: number; foreignChargeId: number; mixedChargeId: number; unlinkedChargeId: number;
  emails: Record<'owner' | 'dentist' | 'reception' | 'patient', string>;
};

async function login(page: Page, role: keyof typeof fixture.emails, path = '/finances') {
  await page.goto(path);
  await page.getByLabel('Correo electrónico').fill(fixture.emails[role]);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.DENTALCLINIC_FINANCIAL_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}
async function fillManual(page: Page, price: string) {
  await expect(page.getByRole('option', { name: /Finanzas, Ada/ })).toBeAttached();
  await page.getByLabel('Paciente (obligatorio)').selectOption(String(fixture.patientId));
  await expect(page.getByText('Verificando paciente seleccionado…')).toHaveCount(0);
  await page.getByLabel('Descripción del concepto 1').fill('Concepto capturado desde navegador real');
  await page.getByLabel('Cantidad del concepto 1').fill('2');
  await page.getByLabel('Precio unitario del concepto 1 (MXN)').fill(price);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}
// Misma aritmetica que frontend/src/lib/financialMoney.ts, para contrastar UI y API reales.
// La API serializa BigDecimal como numero JSON; la UI lo convierte a string antes de formatear.
function amountCents(value: string | number): bigint {
  const text = String(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const [whole = '0', fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function formatMoney(value: string | number, signed = false): string {
  const text = String(value);
  const negative = signed && text.startsWith('-');
  const amount = amountCents(negative ? text.slice(1) : text);
  const body = `$${new Intl.NumberFormat('es-MX').format(amount / 100n)}.${String(amount % 100n).padStart(2, '0')} MXN`;
  return negative ? `-${body}` : body;
}
async function apiToken(request: APIRequestContext, email: string): Promise<string> {
  const base = process.env.DENTALCLINIC_FINANCIAL_API_URL!;
  const login = await request.post(base + '/api/auth/login', { data: { email, password: process.env.DENTALCLINIC_FINANCIAL_PASSWORD! } });
  expect(login.ok()).toBe(true);
  return (await login.json() as { accessToken: string }).accessToken;
}

test('OWNER: alta, pago parcial, reversa completa y anulacion contra backend real', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const writes: Array<{ path: string; key: string | undefined; body: unknown }> = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.startsWith('/api/charges')) writes.push({ path, key: request.headers()['idempotency-key'], body: request.postDataJSON() });
  });
  await login(page, 'owner', '/finances/new');
  await fillManual(page, '12.50');
  await expect(page.getByText('Total de vista previa: $25.00 MXN')).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar cargo manual' }).click();
  await expect(page.getByRole('heading', { name: /^Cargo #/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Estado vigente: Pendiente' })).toBeVisible();
  await page.getByLabel('Importe del pago (MXN)').fill('10');
  await page.getByRole('button', { name: 'Registrar pago', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Estado vigente: Parcial' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Estado financiero vigente' }).getByText('$15.00 MXN')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Anular cargo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /^Reversar pago #/ }).click();
  await page.getByLabel('Motivo obligatorio').fill('Duplicado sintetico verificado');
  await page.getByLabel('Confirmo esta operación y sus consecuencias').check();
  await page.getByRole('button', { name: 'Confirmar reversa completa' }).click();
  await expect(page.getByRole('heading', { name: 'Estado vigente: Pendiente' })).toBeVisible();
  await page.getByRole('button', { name: 'Anular cargo', exact: true }).click();
  await page.getByLabel('Motivo obligatorio').fill('Anulacion sintetica verificada');
  await page.getByLabel('Confirmo esta operación y sus consecuencias').check();
  await page.getByRole('button', { name: 'Confirmar anulación', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Estado vigente: Anulado' })).toBeVisible();
  await expect(page.getByText(/Concepto capturado desde navegador real/)).toBeVisible();
  expect(writes).toHaveLength(4);
  expect(writes.every((write) => Boolean(write.key))).toBe(true);
  expect(writes.find((write) => write.path.endsWith('/reverse'))!.body).not.toHaveProperty('amount');
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath('financial-desktop.png'), fullPage: true });
});

test('OWNER: repetir la misma Idempotency-Key no duplica el cargo contra el backend real', async ({ request }) => {
  const base = process.env.DENTALCLINIC_FINANCIAL_API_URL!;
  const login = await request.post(base + '/api/auth/login', { data: { email: fixture.emails.owner, password: process.env.DENTALCLINIC_FINANCIAL_PASSWORD! } });
  expect(login.ok()).toBe(true);
  const { accessToken } = await login.json() as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() };
  const payload = { patientId: fixture.patientId, appointmentId: fixture.appointmentId,
    items: [{ treatingDentistId: fixture.dentistId, description: 'Replay idempotente', quantity: 1, unitPrice: 25 }], notes: 'Replay' };
  const first = await request.post(base + '/api/charges', { headers, data: payload });
  const second = await request.post(base + '/api/charges', { headers, data: payload });
  expect(first.ok()).toBe(true);
  expect(second.ok()).toBe(true);
  expect((await second.json() as { id: number }).id).toBe((await first.json() as { id: number }).id);
});

test('DENTIST: la API real rechaza altas, pagos y correcciones con 403', async ({ request }) => {
  const base = process.env.DENTALCLINIC_FINANCIAL_API_URL!;
  const login = await request.post(base + '/api/auth/login', { data: { email: fixture.emails.dentist, password: process.env.DENTALCLINIC_FINANCIAL_PASSWORD! } });
  expect(login.ok()).toBe(true);
  const { accessToken } = await login.json() as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() };
  const create = await request.post(base + '/api/charges', { headers, data: { patientId: fixture.patientId, appointmentId: fixture.appointmentId,
    items: [{ treatingDentistId: fixture.dentistId, description: 'Intento de alta', quantity: 1, unitPrice: 10 }], notes: null } });
  expect(create.status()).toBe(403);
  const pay = await request.post(base + `/api/charges/${fixture.ownChargeId}/payments`, { headers, data: { method: 'CASH', amount: 1 } });
  expect(pay.status()).toBe(403);
  const reverse = await request.post(base + `/api/charges/${fixture.ownChargeId}/movements/1/reverse`, { headers, data: { reason: 'Intento' } });
  expect(reverse.status()).toBe(403);
  const cancel = await request.post(base + `/api/charges/${fixture.ownChargeId}/cancel`, { headers, data: { reason: 'Intento' } });
  expect(cancel.status()).toBe(403);
});

test('RECEPTIONIST: cargo y pago completo sin acciones de OWNER', async ({ page }) => {  await login(page, 'reception', '/finances/new'); await fillManual(page, '20');
  await page.getByRole('button', { name: 'Confirmar cargo manual' }).click();
  await expect(page.getByRole('heading', { name: 'Estado vigente: Pendiente' })).toBeVisible();
  await page.getByLabel('Importe del pago (MXN)').fill('40');
  await page.getByRole('button', { name: 'Registrar pago', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Estado vigente: Pagado' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Reversar pago|Anular cargo/ })).toHaveCount(0);
});

test('DENTIST: sin alta ni pago; consulta su cargo propio en modo lectura', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.startsWith('/api/charges')) writes.push(path);
  });
  await login(page, 'dentist', '/finances/new');
  await expect(page.getByRole('heading', { name: 'Sin acceso' })).toBeVisible();
  await page.goto(`/finances/${fixture.ownChargeId}`);
  await expect(page.getByRole('heading', { name: `Cargo #${fixture.ownChargeId}`, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Estado financiero vigente' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Registro manual de pago' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Registrar pago|Reversar pago|Anular cargo/ })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('DENTIST: lista autorizada, cargo propio en lectura y ajenos/mixtos/sin vinculo denegados', async ({ page }) => {
  await login(page, 'dentist');
  await expect(page.getByRole('link', { name: `Cargo #${fixture.ownChargeId}`, exact: true })).toBeVisible();
  await page.getByRole('link', { name: `Cargo #${fixture.ownChargeId}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: `Cargo #${fixture.ownChargeId}`, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Registro manual de pago' })).toHaveCount(0);
  await page.goto('/finances');
  for (const id of [fixture.foreignChargeId, fixture.mixedChargeId, fixture.unlinkedChargeId]) {
    await expect(page.getByRole('link', { name: `Cargo #${id}`, exact: true })).toHaveCount(0);
    await page.goto(`/finances/${id}`);
    await expect(page.getByRole('alert')).toContainText(/No encontramos|no existe|no es visible/);
    await expect(page.getByRole('region', { name: 'Estado financiero vigente' })).toHaveCount(0);
    await page.goto('/finances');
  }
});

test('PATIENT: rutas y navegacion financieras ausentes, sin solicitar cargos', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/charges')) requests.push(request.url()); });
  await login(page, 'patient');
  await expect(page.getByRole('heading', { name: 'Sin acceso' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Finanzas', exact: true })).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('Movil: filtros, tabla autorizada, enlaces y navegacion sin overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'owner');
  await expect(page.getByRole('heading', { name: 'Finanzas', exact: true })).toBeVisible();
  await page.getByLabel('Estado del cargo').selectOption('PENDIENTE');
  const filteredResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/charges' && url.searchParams.get('status') === 'PENDIENTE' && response.status() === 200;
  });
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  const filtered = await (await filteredResponse).json() as { content: unknown[]; totalElements: number };
  await expect(page.getByRole('region', { name: 'Tabla de cargos autorizados' }).locator('tbody tr')).toHaveCount(filtered.content.length);
  await expect(page.getByText(`${filtered.totalElements} cargos autorizados con estos filtros. No es un reporte de ingresos o saldo global.`)).toBeVisible();
  await page.getByLabel('Estado del cargo').selectOption('PARCIAL');
  const partialResponse = page.waitForResponse((response) => new URL(response.url()).searchParams.get('status') === 'PARCIAL' && response.status() === 200);
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await partialResponse;
  await page.goBack();
  await expect(page.getByLabel('Estado del cargo')).toHaveValue('PENDIENTE');
  await page.goForward();
  await expect(page.getByLabel('Estado del cargo')).toHaveValue('PARCIAL');
  await page.goBack();
  await expect(page.getByLabel('Estado del cargo')).toHaveValue('PENDIENTE');
  await expect(page.getByRole('region', { name: 'Tabla de cargos autorizados' }).locator('tbody tr')).toHaveCount(filtered.content.length);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole('region', { name: 'Tabla de cargos autorizados' })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath('financial-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Abrir menú de navegación' }).click();
  await expect(page.getByRole('navigation', { name: 'Navegación móvil' }).getByRole('link', { name: 'Finanzas', exact: true })).toBeVisible();
});

test('OWNER: los reportes de cartera, cobros y saldos coinciden con la API real', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const portfolioResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/financial/reports/portfolio' && response.status() === 200);
  const cashResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/financial/reports/cash-flow' && response.status() === 200);
  const chargesResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/financial/reports/charges' && response.status() === 200);
  await login(page, 'owner', '/finances/reports');
  await expect(page.getByRole('heading', { name: 'Reportes financieros' })).toBeVisible();
  const portfolio = await (await portfolioResponse).json() as {
    confirmedCharges: number; billedAmount: string; appliedAmount: string; pendingBalance: string;
    statusCounts: Record<string, number> };
  expect(Object.values(portfolio.statusCounts).reduce((sum, value) => sum + value, 0)).toBe(portfolio.confirmedCharges);
  await expect(page.getByText(formatMoney(portfolio.billedAmount), { exact: true }).first()).toBeVisible();
  await expect(page.getByText(formatMoney(portfolio.pendingBalance), { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Pendiente', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('reports-portfolio.png'), fullPage: true });

  await page.getByRole('tab', { name: 'Cobros por período' }).click();
  const cash = await (await cashResponse).json() as { grossAmount: string; reversalAmount: string; netAmount: string };
  await expect(page.getByText('Cobro neto', { exact: true })).toBeVisible();
  await expect(page.getByText(formatMoney(cash.netAmount, true), { exact: true }).first()).toBeVisible();
  expect(amountCents(cash.netAmount)).toBe(amountCents(cash.grossAmount) - amountCents(cash.reversalAmount));
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath('reports-cashflow.png'), fullPage: true });

  await page.getByRole('tab', { name: 'Cargos y saldos' }).click();
  const balanced = await (await chargesResponse).json() as { byPatient: unknown[]; confirmedCharges: number };
  await expect(page.getByRole('region', { name: 'Saldos por paciente' }).locator('tbody tr'))
    .toHaveCount(balanced.byPatient.length);
  await expect(page.getByText('Cargos confirmados', { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath('reports-charges.png'), fullPage: true });
});

test('Reportes reales: RECEPTIONIST lee; DENTIST y PATIENT reciben 403', async ({ request }) => {
  const base = process.env.DENTALCLINIC_FINANCIAL_API_URL!;
  const paths = ['/api/financial/reports/portfolio', '/api/financial/reports/cash-flow', '/api/financial/reports/charges'];
  const reception = await apiToken(request, fixture.emails.reception);
  for (const path of paths) {
    const allowed = await request.get(base + path, { headers: { Authorization: `Bearer ${reception}` } });
    expect(allowed.status()).toBe(200);
  }
  for (const role of ['dentist', 'patient'] as const) {
    const token = await apiToken(request, fixture.emails[role]);
    for (const path of paths) {
      const denied = await request.get(base + path, { headers: { Authorization: `Bearer ${token}` } });
      expect(denied.status()).toBe(403);
    }
  }
  const anonymous = await request.get(base + '/api/financial/reports/portfolio');
  expect(anonymous.status()).toBe(401);
});
