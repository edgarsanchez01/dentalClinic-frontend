import { expect, test, type Page } from '@playwright/test';

const NOW = '2026-10-25T16:00:00Z';
const patient = { id: 10, firstName: 'Ana', lastName: 'Pérez', email: 'synthetic@example.test', phone: '555-0101', active: true, createdAt: NOW };
const charges = [
  { id: 101, patientId: 10, appointmentId: 7, totalAmount: '300.00', appliedAmount: '0.00', pendingBalance: '300.00', status: 'PENDIENTE', confirmedAt: NOW },
  { id: 102, patientId: 10, appointmentId: 8, totalAmount: '1250.50', appliedAmount: '400.00', pendingBalance: '850.50', status: 'PARCIAL', confirmedAt: NOW },
  { id: 103, patientId: 10, appointmentId: 9, totalAmount: '750.00', appliedAmount: '750.00', pendingBalance: '0.00', status: 'PAGADO', confirmedAt: NOW },
  { id: 104, patientId: 10, appointmentId: 10, totalAmount: '420.00', appliedAmount: '0.00', pendingBalance: '0.00', status: 'ANULADO', confirmedAt: NOW },
];

async function fixture(page: Page, role: string) {
  const state = { error: false, empty: false, pending: false, paginate: false };
  const requests: Array<{ path: string; method: string }> = [];
  let release = () => {};
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // The simulated server supplies the authorized scope; the UI must not derive ownership.
  // All APIs, including unknown routes and attempted writes, are intercepted.
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    requests.push({ path: url.pathname + url.search, method: route.request().method() });
    if (route.request().method() !== 'GET' && url.pathname !== '/api/auth/refresh') {
      await route.fulfill({ status: 403, json: { message: 'Escritura no autorizada.' } }); return;
    }
    let body: unknown;
    if (url.pathname === '/api/auth/refresh') body = { accessToken: 'synthetic-finances-token' };
    else if (url.pathname === '/api/auth/me') body = { id: 1, role, email: 'synthetic@example.test', active: true, dentistId: 7, createdAt: NOW };
    else if (url.pathname === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (url.pathname === '/api/notifications/unread-count') body = { unread: 0 };
    else if (url.pathname === '/api/patients') body = { content: [patient], page: 0, size: 10, totalElements: 1, totalPages: 1 };
    else if (url.pathname === '/api/patients/10') body = patient;
    else if (url.pathname === '/api/financial-intents') body = { items: [] };
    else if (url.pathname.startsWith('/api/charges')) {
      if (state.pending) await new Promise<void>((resolve) => { release = resolve; });
      if (state.error || url.pathname === '/api/charges/999') {
        await route.fulfill({ status: url.pathname.endsWith('/999') ? 404 : 503, json: { message: 'Consulta financiera no disponible.' } }); return;
      }
      if (url.pathname === '/api/charges') {
        const filtered = state.empty ? [] : charges.filter((charge) => (!url.searchParams.has('status') || charge.status === url.searchParams.get('status'))
          && (!url.searchParams.has('patientId') || charge.patientId === Number(url.searchParams.get('patientId')))
          && (!url.searchParams.has('appointmentId') || charge.appointmentId === Number(url.searchParams.get('appointmentId'))));
        const pageNumber = Number(url.searchParams.get('page') ?? 0);
        body = { content: state.paginate ? filtered.slice(pageNumber, pageNumber + 1) : filtered, page: pageNumber,
          size: state.paginate ? 1 : 20, totalElements: filtered.length, totalPages: state.paginate ? filtered.length : filtered.length ? 1 : 0 };
      } else {
        const charge = charges.find(({ id }) => id === Number(url.pathname.split('/')[3]))!;
        body = { ...charge, currency: 'MXN', version: 1, createdAt: NOW, confirmedByUserId: 1, notes: 'Acuerdo administrativo registrado.',
          items: [{ id: 1, chargeId: charge.id, description: 'Concepto histórico con descripción conservada.\nSin recalcular el precio del catálogo.', quantity: 1, unitPrice: charge.totalAmount, lineTotal: charge.totalAmount, createdAt: NOW }],
          movements: charge.status === 'PARCIAL' ? [
            { id: 5, chargeId: charge.id, patientId: 10, type: 'PAYMENT', amount: '400.00', paymentMethod: 'CASH', performedByUserId: 1, performedAt: NOW, createdAt: NOW },
            { id: 6, chargeId: charge.id, patientId: 10, type: 'PAYMENT', amount: '100.00', paymentMethod: 'CARD', performedByUserId: 1, performedAt: NOW, createdAt: NOW },
            { id: 7, chargeId: charge.id, patientId: 10, type: 'REVERSAL', amount: '100.00', reversesMovementId: 6, reason: 'Corrección administrativa registrada.', performedByUserId: 1, performedAt: NOW, createdAt: NOW },
          ] : [] };
      }
    } else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ json: body });
  });
  return { state, requests, release: () => release() };
}

async function ready(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}

test('BUILD03 regresión visual de listado y detalle RECEPTIONIST/OWNER', async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(!process.env.DC_FINANCES_CAPTURE, 'Capturas opt-in con configuración aislada.');
  for (const role of ['RECEPTIONIST', 'OWNER']) {
    await page.unrouteAll({ behavior: 'wait' });
    await fixture(page, role);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const view of ['list', 'detail']) {
        await page.goto(view === 'list' ? '/finances' : '/finances/102');
        if (view === 'list') await expect(page.getByRole('link', { name: 'Cargo #102', exact: true })).toBeVisible();
        else await expect(page.locator('.reception-page-heading')).toContainText('Pérez, Ana · Paciente #10');
        await ready(page);
        await expect(page).toHaveScreenshot(`${role}-${view}-${width}.png`, { fullPage: true, animations: 'disabled', maxDiffPixels: 0 });
      }
    }
  }
});

for (const width of [1440, 768, 390, 320]) {
  test(`BUILD03 listado y detalle compartidos a ${width}px sin escritura DENTIST`, async ({ page, context }) => {
    test.setTimeout(60_000);
    const reception = await context.newPage();
    for (const target of [page, reception]) await target.setViewportSize({ width, height: 1000 });
    const api = await fixture(page, 'DENTIST');
    await fixture(reception, 'RECEPTIONIST');
    // Compare read-only blocks at the same subpixel origin, excluding only the
    // role-specific heading/payment form and fixed navigation, not their styles.
    // B5 agrega recuperacion exclusivamente a los roles de escritura, no al bloque de consulta DENTIST.
    // Se excluye solo ese bloque al comparar los mismos bloques historicos, sin tolerancia de pixeles.
    const compareStyle = '.reception-page-heading { height: 400px !important; } section[aria-label="Registro manual de pago"], section[aria-label="Recuperación de operaciones financieras"] { display: none !important; } nav[aria-label="Navegación rápida"] { visibility: hidden !important; }';
    for (const view of ['list', 'detail']) {
      for (const target of [page, reception]) {
        await target.goto(view === 'list' ? '/finances' : '/finances/102');
        if (view === 'list') await expect(target.getByRole('link', { name: 'Cargo #102', exact: true })).toBeVisible();
        else await expect(target.locator('.reception-page-heading')).toContainText('Pérez, Ana · Paciente #10');
        await ready(target);
      }
      const selectors = view === 'list' ? ['.reception-finances-toolbar', '.reception-finances-results']
        : ['section[aria-label="Estado financiero vigente"]', 'section[aria-label="Conceptos históricos"]', 'section[aria-label="Historial financiero"]'];
      for (const selector of selectors) {
        const expected = await reception.locator(selector).screenshot({ path: test.info().outputPath(`reception-${view}-${selectors.indexOf(selector)}-${width}.png`), animations: 'disabled', style: compareStyle });
        const actual = await page.locator(selector).screenshot({ path: test.info().outputPath(`dentist-${view}-${selectors.indexOf(selector)}-${width}.png`), animations: 'disabled', style: compareStyle });
        expect(actual.equals(expected), `${selector}: misma composición visual`).toBe(true);
      }
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: test.info().outputPath(`dentist-${view}-${width}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole('link', { name: /Crear cargo manual|Reportes financieros|Atenciones por cobrar/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Registrar pago|Reversar pago|Anular cargo/ })).toHaveCount(0);
      await expect(page.locator('.reception-page-actions:empty')).toHaveCount(0);
      if (view === 'list') {
        for (const status of ['Pendiente', 'Parcial', 'Pagado', 'Anulado']) await expect(page.getByRole('cell', { name: status, exact: true })).toHaveCount(1);
        await expect(page.locator('td.reception-finances-amount').first()).toHaveCSS('text-align', 'right');
        await page.getByRole('link', { name: 'Cargo #102', exact: true }).click();
        await expect(page).toHaveURL(/\/finances\/102$/);
      } else {
        await expect(page.getByRole('link', { name: 'Ver paciente', exact: true })).toHaveAttribute('href', '/patients/10');
        await expect(page.getByRole('link', { name: 'Ver cita', exact: true })).toHaveAttribute('href', '/appointments/8');
        await page.getByRole('button', { name: 'Consultar estado vigente', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Estado financiero vigente' })).toContainText('$850.50 MXN');
      }
    }
    expect(api.requests.filter(({ path }) => !path.startsWith('/api/auth/')).every(({ method }) => method === 'GET')).toBe(true);
    expect(api.requests.some(({ path }) => path.startsWith('/api/financial/reports') || path.includes('/collection'))).toBe(false);
    await reception.close();
  });
}

test('BUILD03 DENTIST conserva filtros aplicados, URL, teclado, paginación e historial del navegador', async ({ page }) => {
  const api = await fixture(page, 'DENTIST');
  api.state.paginate = true;
  await page.goto('/finances?appointmentId=8');
  await expect(page.getByRole('link', { name: 'Cargo #102' })).toBeVisible();
  const input = page.getByRole('combobox', { name: 'Paciente', exact: true });
  await input.fill('Ana');
  await expect(page.getByRole('option', { name: /Ana Pérez/ })).toBeVisible();
  await input.press('ArrowDown'); await input.press('Enter');
  await expect(page.getByLabel('Paciente seleccionado')).toContainText('Paciente #10');
  await expect(page.getByText(/Filtros sin aplicar/)).toBeVisible();
  await expect(page).not.toHaveURL(/patientId=/);
  await page.locator('details.reception-advanced > summary').click();
  await page.getByLabel('Estado del cargo').selectOption('PARCIAL');
  await page.getByLabel('Desde (fecha de confirmación)').fill('2026-10-01');
  await page.getByLabel('Hasta (incluye ese día)').fill('2026-10-25');
  await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).first().click();
  await expect(page).toHaveURL(/patientId=10.*status=PARCIAL.*appointmentId=8/);
  await expect(page.getByText(/Filtros sin aplicar/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).click();
  await expect(page.getByText('Página 1 de 4')).toBeVisible();
  await page.goBack();
  await expect(input).toHaveValue('Ana Pérez');
  await expect(page.getByLabel('Estado del cargo')).toHaveValue('PARCIAL');
  await page.goForward();
  await expect(input).toHaveValue('');
  await page.getByRole('button', { name: 'Página siguiente' }).click();
  await expect(page.getByText('Página 2 de 4')).toBeVisible();
  const queries = api.requests.filter(({ path }) => path.startsWith('/api/charges?'));
  expect(queries.some(({ path }) => path.includes('page=1'))).toBe(true);
  expect(queries.every(({ path }) => !path.includes('dentistId'))).toBe(true);
});

test('BUILD03 DENTIST conserva carga, error, reintento, vacío y 404 de cargo no autorizado', async ({ page }) => {
  const api = await fixture(page, 'DENTIST');
  api.state.pending = true;
  await page.goto('/finances');
  await expect(page.getByText('Cargando cargos…')).toBeVisible();
  api.state.error = true; api.state.pending = false; api.release();
  await expect(page.getByRole('alert')).toContainText('Consulta financiera no disponible.');
  api.state.error = false; api.state.empty = true;
  await page.getByRole('button', { name: 'Reintentar cargos' }).click();
  await expect(page.getByText('No hay cargos en esta página con los filtros seleccionados.')).toBeVisible();
  api.state.error = true;
  await page.goto('/finances/102');
  await expect(page.getByRole('alert')).toBeVisible();
  api.state.error = false;
  await page.getByRole('button', { name: 'Reintentar detalle' }).click();
  await expect(page.getByRole('heading', { name: 'Cargo #102', exact: true })).toBeVisible();
  await page.goto('/finances/999');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Estado financiero vigente' })).toHaveCount(0);
  for (const path of ['/finances/new', '/finances/reports', '/collections', '/collections/8']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Sin acceso' })).toBeVisible();
  }
  expect(api.requests.filter(({ path }) => !path.startsWith('/api/auth/')).every(({ method }) => method === 'GET')).toBe(true);
});
