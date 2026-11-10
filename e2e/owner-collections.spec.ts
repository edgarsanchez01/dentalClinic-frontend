import { expect, test, type Page } from '@playwright/test';
import { checkoutAppointment, checkoutContext } from '../src/test/checkoutFixtures';
import type { CollectionState } from '../src/api/collection';

const states: CollectionState[] = ['NO_CHARGE', 'PENDING', 'PARTIAL', 'SETTLED', 'REVIEW_REQUIRED'];
const labels = ['Sin cargo registrado', 'Cargo pendiente', 'Pago parcial', 'Liquidado', 'Requiere revisión administrativa'];
const empty = { content: [], page: 0, size: 20, totalPages: 0, totalElements: 0 };
const now = '2026-10-30T12:00:00Z';

async function fixture(page: Page, role = 'OWNER') {
  const mode = { many: false, error: false, empty: false, pending: false, long: false };
  const calls: Array<{ path: string; method: string }> = [];
  const blockedWrites: string[] = [];
  let release = () => {};
  await page.clock.setFixedTime(new Date(now));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    calls.push({ path: path + url.search, method: req.method() });
    if (req.method() !== 'GET' && path !== '/api/auth/refresh') {
      blockedWrites.push(`${req.method()} ${path}`);
      await route.abort('blockedbyclient'); return;
    }
    let result: unknown;
    if (path === '/api/auth/refresh') result = { accessToken: 'synthetic-read-only-collections' };
    else if (path === '/api/auth/me') result = { id: 2, role, dentistId: 3, active: true, email: 'synthetic@example.test', createdAt: now };
    else if (path === '/api/onboarding/status') result = { status: 'COMPLETED', clinicConfigured: true };
    else if (path === '/api/notifications/unread-count') result = { unread: 0 };
    else if (path === '/api/public/schedule') result = { timezone: 'America/Mexico_City', days: [], exceptions: [], dentists: [
      { dentistId: 3, firstName: 'Olivia', lastName: 'Profesional de prueba', days: [] },
      { dentistId: 4, firstName: 'Mario', lastName: 'Profesional de prueba', days: [] },
    ] };
    else if (path === '/api/patients') result = { ...empty, totalElements: 2, totalPages: 1, content: [
      { id: 1, firstName: 'Ana', lastName: 'Paciente de prueba', active: true },
      { id: 2, firstName: 'Bruno', lastName: 'Paciente de prueba', active: true },
    ] };
    else if (path === '/api/patients/1') result = { id: 1, firstName: 'Ana', lastName: 'Paciente de prueba', active: true };
    else if (path === '/api/appointments/collection-queue') {
      if (mode.pending) await new Promise<void>(resolve => { release = resolve; });
      if (mode.error) { await route.fulfill({ status: 503, json: { message: 'No disponible' } }); return; }
      const rows = Array.from({ length: mode.many ? 42 : 5 }, (_, i) => {
        const state = states[i % states.length]!;
        const money = state !== 'NO_CHARGE' && state !== 'REVIEW_REQUIRED';
        return { appointment: { ...checkoutAppointment, id: i + 7, patientId: i % 2 + 1,
          patientFirstName: i % 2 ? 'Bruno' : mode.long ? 'Ana María de los Ángeles' : 'Ana',
          patientLastName: mode.long ? 'Paciente de prueba con apellidos extensos para comprobar lectura completa' : 'Paciente de prueba',
          dentistId: i % 2 + 3, dentistFirstName: i % 2 ? 'Mario' : 'Olivia',
          service: i === 0 ? undefined : { ...checkoutAppointment.service!, name: mode.long ? 'Consulta de valoración y seguimiento de un servicio histórico con descripción extensa' : 'Consulta de valoración' },
          status: 'COMPLETED', completedAt: checkoutAppointment.endAt }, collectionState: state,
          totalAmount: money ? '500.00' : null, appliedAmount: money ? state === 'SETTLED' ? '500.00' : state === 'PARTIAL' ? '200.00' : '0.00' : null,
          pendingBalance: money ? state === 'SETTLED' ? '0.00' : state === 'PARTIAL' ? '300.00' : '500.00' : null,
          currency: money ? 'MXN' : null, hasRecordedCharge: money, activeChargeId: money ? 100 + i : null,
          financialContextToken: null, reviewReason: state === 'REVIEW_REQUIRED' ? 'MULTIPLE_ACTIVE_CHARGES' : null };
      });
      const filtered = mode.empty ? [] : rows.filter(row => (
        (!url.searchParams.has('patientId') || String(row.appointment.patientId) === url.searchParams.get('patientId'))
        && (!url.searchParams.has('dentistId') || String(row.appointment.dentistId) === url.searchParams.get('dentistId'))
        && (url.searchParams.has('state') ? row.collectionState === url.searchParams.get('state') : url.searchParams.get('includeSettled') === 'true' || row.collectionState !== 'SETTLED')
      ));
      const current = Number(url.searchParams.get('page') ?? 0);
      result = { ...empty, page: current, totalElements: filtered.length, totalPages: Math.ceil(filtered.length / 20), content: filtered.slice(current * 20, (current + 1) * 20), observedAt: now,
        summary: { completedCount: rows.length, currency: 'MXN', verifiedPendingBalance: '800.00', counts: Object.fromEntries(states.map(state => [state, rows.filter(row => row.collectionState === state).length])) } };
    } else if (path === '/api/appointments/7') result = { ...checkoutAppointment, status: 'COMPLETED', completedAt: checkoutAppointment.endAt };
    else if (path === '/api/appointments/7/financial-context') result = checkoutContext();
    else if (path === '/api/charges' || path === '/api/appointments' || path === '/api/notifications') result = empty;
    else if (path.endsWith('/events') || path === '/api/services') result = [];
    else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ json: result });
  });
  return { calls, mode, blockedWrites, release: () => release() };
}

async function ready(page: Page) {
  await expect(page.getByRole('list', { name: 'Atenciones completadas' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [1440, 768, 390, 320]) {
  test(`OWNER presentación, estados, enlaces y teclado a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const f = await fixture(page);
    await page.goto('/collections?includeSettled=true');
    await ready(page); await noOverflow(page);
    await expect(page.getByRole('heading', { name: 'Atenciones por cobrar', exact: true })).toBeVisible();
    const rows = page.getByRole('list', { name: 'Atenciones completadas' }).locator(':scope > li');
    await expect(rows).toHaveCount(5);
    for (const [i, label] of labels.entries()) {
      await expect(rows.nth(i).getByText(label, { exact: true })).toBeVisible();
      expect(await rows.nth(i).getAttribute('class')).toBe('reception-list-row');
    }
    for (const i of [0, 4]) {
      await expect(rows.nth(i).locator('.collection-totals')).toHaveCount(0);
      await expect(rows.nth(i).getByText(/MXN/)).toHaveCount(0);
    }
    await expect(rows.nth(2).getByText('$300.00 MXN', { exact: true })).toBeVisible();
    await expect(page.getByText(/Saldo pendiente verificado: \$800.00 MXN/)).toBeVisible();
    await expect(rows.first().getByText(/Sin servicio histórico/)).toBeVisible();
    await expect(rows.nth(4).getByRole('link', { name: 'Gestión administrativa de esta atención' })).toHaveAttribute('href', '/finances?appointmentId=11&patientId=1');
    await expect(page.getByRole('link', { name: 'Gestión de cargos', exact: true })).toHaveAttribute('href', '/finances');
    await page.screenshot({ path: test.info().outputPath(`collections-${width}.png`), fullPage: true });
    await page.screenshot({ path: test.info().outputPath(`viewport-${width}.png`) });
    const checkbox = page.getByRole('checkbox', { name: 'Incluir liquidados' });
    const rect = await checkbox.boundingBox();
    expect(rect!.width).toBe(20); expect(rect!.height).toBe(20);
    await checkbox.focus(); await page.keyboard.press('Space');
    await expect(checkbox).not.toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Filtros sin aplicar.' })).toBeVisible();
    await page.getByRole('button', { name: 'Aplicar filtros' }).click();
    await expect(rows).toHaveCount(4);
    await page.getByRole('link', { name: /Ana.*Atención #7/ }).click();
    await expect(page.getByRole('heading', { name: 'Cobro de la atención', exact: true })).toBeVisible();
    await expect(page.locator('.owner-collections')).toHaveCount(0);
    await page.getByRole('link', { name: 'Volver a atenciones por cobrar', exact: true }).click();
    await expect(page).toHaveURL(/\/collections$/);
    await ready(page);
    await rows.first().getByRole('link', { name: 'Consultar detalle de la cita' }).click();
    await expect(page).toHaveURL(/\/appointments\/7\?returnTo=%2Fappointments$/);
    expect(f.blockedWrites).toEqual([]);
    expect(f.calls.filter(c => c.method !== 'GET').every(c => c.path === '/api/auth/refresh')).toBe(true);
  });

  test(`OWNER filtros, paginación, borradores y retorno a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const f = await fixture(page); f.mode.many = true;
    await page.goto('/collections?includeSettled=true'); await ready(page);
    await page.getByRole('button', { name: 'Página siguiente' }).click();
    await expect(page.getByText('Página 2 de 3')).toBeVisible();
    await page.getByLabel('Profesional').selectOption('3');
    await page.getByLabel('Estado financiero').selectOption('PARTIAL');
    await page.getByLabel('Desde (fecha de atención)').fill('2026-10-22');
    await page.getByLabel('Hasta (incluye ese día)').fill('2026-10-22');
    const patient = page.getByRole('combobox', { name: 'Paciente', exact: true });
    await patient.focus(); await page.getByRole('option', { name: /Ana Paciente/ }).click();
    const before = f.calls.filter(c => c.path.startsWith('/api/appointments/collection-queue')).length;
    await expect(page.getByRole('status').filter({ hasText: 'Filtros sin aplicar.' })).toBeVisible();
    expect(f.calls.filter(c => c.path.startsWith('/api/appointments/collection-queue'))).toHaveLength(before);
    await page.getByRole('button', { name: 'Aplicar filtros' }).click(); await ready(page);
    const url = new URL(page.url());
    expect(Object.fromEntries(url.searchParams)).toEqual({ patientId: '1', dentistId: '3', state: 'PARTIAL', includeSettled: 'true', fromDay: '2026-10-22', from: '2026-10-22T06:00:00.000Z', toDay: '2026-10-22', to: '2026-10-23T06:00:00.000Z' });
    const appliedUrl = page.url();
    await expect(page.getByText('Página 1 de 1')).toBeVisible();
    await page.getByLabel('Estado financiero').selectOption('SETTLED');
    const queryBefore = f.calls.filter(c => c.path.startsWith('/api/appointments/collection-queue')).length;
    await page.getByRole('button', { name: 'Actualizar bandeja' }).click();
    await expect.poll(() => f.calls.filter(c => c.path.startsWith('/api/appointments/collection-queue')).length).toBe(queryBefore + 1);
    expect(f.calls.filter(c => c.path.startsWith('/api/appointments/collection-queue')).at(-1)!.path).toContain('state=PARTIAL');
    await expect(page.getByLabel('Estado financiero')).toHaveValue('SETTLED');
    await page.getByRole('button', { name: 'Limpiar filtros' }).click(); await ready(page);
    await expect(page.getByLabel('Profesional')).toHaveValue('');
    await page.goBack(); await ready(page); expect(page.url()).toBe(appliedUrl);
    await expect(page.getByLabel('Estado financiero')).toHaveValue('PARTIAL');
    await noOverflow(page); expect(f.blockedWrites).toEqual([]);
  });

  test(`RECEPTIONIST sin cambios frente a referencia a ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    const baseline = await context.newPage(); await baseline.setViewportSize({ width, height: 1000 });
    const actual = await fixture(page, 'RECEPTIONIST'), previous = await fixture(baseline, 'RECEPTIONIST');
    const path = '/collections?includeSettled=true';
    await Promise.all([page.goto(path), baseline.goto(`http://127.0.0.1:5297${path}`)]);
    for (const target of [page, baseline]) {
      await ready(target);
      await target.addStyleTag({ content: '* { transition: none !important; }' });
    }
    const snapshot = (target: Page) => target.locator('main').evaluate(main => Array.from(main.querySelectorAll<HTMLElement>('*')).filter(el => el.getClientRects().length).map(el => {
      const r = el.getBoundingClientRect(), css = getComputedStyle(el);
      return [el.tagName, el.innerText, r.x, r.y, r.width, r.height, css.color, css.backgroundColor, css.fontSize, css.padding, css.gap, css.borderRadius];
    }));
    expect(await snapshot(page)).toEqual(await snapshot(baseline));
    await page.screenshot({ path: test.info().outputPath(`reception-${width}.png`), fullPage: true });
    for (const target of [page, baseline]) {
      await target.getByLabel('Estado financiero').selectOption('PARTIAL');
      await target.getByRole('checkbox', { name: 'Incluir liquidados' }).uncheck();
      await target.getByRole('button', { name: 'Aplicar filtros' }).click();
      await expect(target.getByText('1 atenciones con los filtros aplicados.', { exact: true })).toBeVisible();
      await ready(target);
    }
    expect(new URL(page.url()).search).toBe(new URL(baseline.url()).search);
    // Alternar ventanas puede repetir lecturas por foco. Comparar contratos y
    // parámetros sin confundir esos refetches nativos con otra consulta.
    const contracts = (calls: typeof actual.calls) => [...new Set(calls.map(c => `${c.method} ${c.path}`))].sort();
    expect(contracts(actual.calls)).toEqual(contracts(previous.calls));
    expect(await snapshot(page)).toEqual(await snapshot(baseline));
    expect(actual.blockedWrites).toEqual([]); expect(previous.blockedWrites).toEqual([]);
    await baseline.close();
  });
}

test('OWNER carga, vacío, error seguro, reintento y fechas inválidas', async ({ page }) => {
  const f = await fixture(page); f.mode.pending = true;
  await page.goto('/collections');
  await expect(page.getByText('Consultando atenciones…', { exact: true })).toBeVisible();
  f.mode.pending = false; f.release(); await ready(page);
  f.mode.error = true;
  await page.getByRole('button', { name: 'Actualizar bandeja' }).click();
  await expect(page.getByRole('alert')).toContainText('No se pudo verificar la bandeja.');
  await expect(page.getByRole('list', { name: 'Atenciones completadas' })).toHaveCount(0);
  await expect(page.getByLabel('Resumen de atenciones completadas')).toHaveCount(0);
  f.mode.error = false; f.mode.empty = true;
  await page.getByRole('button', { name: 'Reintentar bandeja' }).click();
  await expect(page.getByText('No hay atenciones en esta página. Ajusta los filtros o vuelve a la página anterior.')).toBeVisible();
  await page.getByLabel('Desde (fecha de atención)').fill('2026-10-30');
  await page.getByLabel('Hasta (incluye ese día)').fill('2026-10-01');
  const before = f.calls.filter(c => c.path.startsWith('/api/appointments/collection-queue')).length;
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(page.getByRole('alert')).toContainText('La fecha inicial no puede ser posterior a la final.');
  expect(f.calls.filter(c => c.path.startsWith('/api/appointments/collection-queue'))).toHaveLength(before);
  expect(f.blockedWrites).toEqual([]);
});

test('OWNER contenido largo y cantidades completas a 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1000 });
  const f = await fixture(page); f.mode.long = true;
  await page.goto('/collections?includeSettled=true'); await ready(page); await noOverflow(page);
  await expect(page.getByRole('link', { name: /Ana María de los Ángeles.*Atención #7/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('long-320.png'), fullPage: true });
  expect(f.blockedWrites).toEqual([]);
});
