import { expect, test, type Page } from '@playwright/test';

// Synthetic data only. Every /api request is intercepted; navigation config proxies to port 9.
const NOW = '2026-10-19T16:00:00Z';
const zone = 'America/Mexico_City';
const service = { id: 1, name: 'Consulta de valoración', description: null, durationMinutes: 30, referencePrice: '850.00', active: true, createdAt: NOW, updatedAt: null };
const week = { timezone: zone, days: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, open: i < 5, startTime: '09:00:00', endTime: '18:00:00', breaks: [] })), exceptions: [{ date: '2026-10-23', closed: true }], dentists: [{ dentistId: 7, firstName: 'Elena', lastName: 'Profesional de prueba', days: [] }, { dentistId: 8, firstName: 'Luis', lastName: 'Profesional de prueba', days: [] }] };
const visits = [
  [1, 'Mariana', '2026-10-19T15:00:00Z', 7, 'SCHEDULED'],
  [2, 'Alejandro', '2026-10-19T16:30:00Z', 8, 'SCHEDULED'],
  [3, 'Isabel', '2026-10-19T17:30:00Z', 7, 'SCHEDULED'],
  [4, 'Carlos', '2026-10-19T21:00:00Z', 7, 'SCHEDULED'],
  [5, 'Valentina', '2026-10-20T16:00:00Z', 8, 'SCHEDULED'],
  [6, 'Emiliano', '2026-10-21T15:00:00Z', 7, 'COMPLETED'],
  [7, 'Sofía', '2026-10-21T18:00:00Z', 8, 'CANCELLED'],
  [8, 'Daniel', '2026-10-22T16:00:00Z', 7, 'NO_SHOW'],
].map(([id, name, start, dentistId, status]) => ({ id: Number(id), patientId: Number(id), patientFirstName: String(name), patientLastName: 'Paciente de prueba', dentistId: Number(dentistId), dentistFirstName: dentistId === 7 ? 'Elena' : 'Luis', dentistLastName: 'Profesional de prueba', startAt: String(start), endAt: new Date(Date.parse(String(start)) + 30 * 60_000).toISOString(), durationMinutes: 30, status, service, occurrenceVersion: 1, createdByUserId: 10, createdAt: NOW }));
const pageOf = (content: unknown[], size = 100) => ({ content, size, page: 0, totalElements: content.length, totalPages: content.length ? 1 : 0 });

async function fixture(page: Page, options: { empty?: boolean; pastOnly?: boolean; fail?: string } = {}) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const calls: URL[] = [];
  const writes: string[] = [];
  const unexpected: string[] = [];
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const url = new URL(route.request().url()); calls.push(url);
    const method = route.request().method();
    if (method !== 'GET' && !url.pathname.startsWith('/api/auth/')) writes.push(`${method} ${url.pathname}`);
    if (url.pathname === options.fail) { await route.fulfill({ status: 503, json: { message: 'Error de prueba recuperable.' } }); return; }
    let body: unknown;
    switch (url.pathname) {
      case '/api/auth/refresh': body = { accessToken: 'ux04c-synthetic' }; break;
      case '/api/auth/me': body = { id: 10, role: 'RECEPTIONIST', email: 'recepcion@example.test', active: true, createdAt: NOW }; break;
      case '/api/onboarding/status': body = { status: 'COMPLETED', clinicConfigured: true }; break;
      case '/api/availability/policy': body = { timezone: zone, maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 }; break;
      case '/api/public/schedule': case '/api/schedules/clinic': body = week; break;
      case '/api/services': body = [service]; break;
      case '/api/patients': body = pageOf(visits.map(a => ({ id: a.patientId, firstName: a.patientFirstName, lastName: a.patientLastName, active: true }))); break;
      case '/api/appointments': {
        const p = url.searchParams;
        const content = (options.empty ? [] : options.pastOnly ? visits.slice(0, 1) : visits).filter(a =>
          (!p.has('from') || a.startAt >= p.get('from')!) && (!p.has('to') || a.startAt < p.get('to')!) &&
          (!p.has('status') || a.status === p.get('status')) && (!p.has('dentistId') || a.dentistId === Number(p.get('dentistId'))) &&
          (!p.has('patientId') || a.patientId === Number(p.get('patientId'))));
        const size = Number(p.get('size') ?? 100);
        body = { ...pageOf(content, size), content: content.slice(0, size), totalPages: Math.ceil(content.length / size) };
        break;
      }
      case '/api/appointments/2': body = visits[1]; break;
      case '/api/appointments/2/events': body = []; break;
      case '/api/financial/reports/portfolio': body = { asOf: NOW, confirmedCharges: 8, billedAmount: '5400.00', appliedAmount: '2100.00', pendingBalance: '3300.00', statusCounts: { pendiente: 3, parcial: 2, pagado: 3, anulado: 0 } }; break;
      case '/api/notifications': body = pageOf(options.empty ? [] : [{ id: 1, title: 'Aviso de prueba para recepción', body: 'Revisa los cambios de tu agenda antes de la siguiente atención.', read: false, priority: 'NORMAL', createdAt: NOW }]); break;
      case '/api/notifications/unread-count': body = { unread: options.empty ? 0 : 1 }; break;
      default:
        if (/^\/api\/schedules\/dentist\/\d+$/.test(url.pathname)) body = { ...week, dentistId: Number(url.pathname.split('/').at(-1)) };
        else if (/^\/api\/schedules\/dentist\/\d+\/(exceptions|time-off)$/.test(url.pathname)) body = [];
        else { unexpected.push(url.pathname); await route.fulfill({ status: 404, json: {} }); return; }
    }
    await route.fulfill({ status: 200, json: body });
  });
  return { calls, writes, unexpected };
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function screenshot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => scrollTo(0, 0));
  await noOverflow(page);
  await page.screenshot({ path: `/tmp/opencode/ux04c/evidence/${name}.png`, fullPage: true });
}

for (const width of [1440, 390]) {
  test(`UX-04C Inicio y Agenda con citas, navegación y capturas ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const { calls, writes, unexpected } = await fixture(page);
    await page.goto('/');
    const daily = page.getByRole('region', { name: 'Agenda de hoy', exact: true });
    await expect(daily.getByRole('link', { name: /Cita con/ })).toHaveCount(4);
    await expect(page.getByRole('region', { name: 'Citas programadas hoy' }).getByText('4', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Próximas citas' }).getByText('Alejandro Paciente de prueba', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Cartera pendiente' }).getByText('$3,300.00 MXN')).toBeVisible();
    await screenshot(page, `inicio-${width}`);
    const create = page.getByRole('link', { name: 'Crear cita', exact: true });
    await create.focus(); await expect(create).toBeFocused();
    await expect(create).toHaveCSS('outline-style', 'solid');
    await expect(create).toHaveCSS('outline-width', '2px');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Nueva cita', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Volver a la agenda', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Nueva cita', exact: true })).toBeHidden();
    if (width > 767) {
      const register = page.getByRole('region', { name: 'Agenda semanal', exact: true });
      await expect(register.getByRole('link', { name: /Cita con/ })).toHaveCount(8);
      await expect(register.getByText('Completada', { exact: true })).toBeVisible();
      await expect(register.getByText('Cancelada', { exact: true })).toBeVisible();
      await expect(register.getByText('No asistió', { exact: true })).toBeVisible();
      for (const visit of await register.getByRole('link', { name: /Cita con/ }).all()) expect((await visit.boundingBox())!.width).toBeGreaterThan(300);
      await screenshot(page, `citas-${width}`);
      await page.getByRole('button', { name: 'Mes', exact: true }).click();
      await expect(page).toHaveURL(/view=month/);
      for (const chip of await page.locator('.reception-month-view button[aria-label^="Cita con"]').all()) {
        const bounds = await chip.evaluate(element => ({ button: element.getBoundingClientRect().right, cell: element.parentElement!.parentElement!.getBoundingClientRect().right }));
        expect(bounds.button).toBeLessThanOrEqual(bounds.cell);
      }
      await screenshot(page, `citas-mes-${width}`);
      await page.getByRole('button', { name: 'Semana', exact: true }).click();
      await page.getByRole('button', { name: 'Ver día lun, 19 oct', exact: true }).click();
      await expect(page).toHaveURL(/view=day/);
      await expect(page.getByRole('region', { name: 'Agenda de Elena Profesional de prueba' })).toBeVisible();
      await screenshot(page, `citas-dia-${width}`);
    } else {
      await expect(page.getByRole('region', { name: 'Agenda del día', exact: true }).getByRole('button', { name: /Abrir cita/ })).toHaveCount(4);
      await screenshot(page, `citas-${width}`);
    }
    expect(calls.some(url => /clinical|odontogram|\/api\/clinic|\/api\/users|\/api\/feedback/.test(url.pathname))).toBe(false);
    expect(writes).toEqual([]); expect(unexpected).toEqual([]);
  });

  test(`UX-04C estados sin citas ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const { writes } = await fixture(page, { empty: true });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Una jornada por organizar' })).toBeVisible();
    await expect(page.getByText('No hay próximas citas programadas desde este momento.', { exact: false })).toBeVisible();
    await screenshot(page, `inicio-vacio-${width}`);
    await page.getByRole('link', { name: 'Consultar agenda', exact: true }).click();
    if (width > 767) {
      await page.getByRole('button', { name: 'Semana', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Una semana por organizar' })).toBeVisible();
    } else await expect(page.getByText('No hay citas para este día.', { exact: true })).toBeVisible();
    await screenshot(page, `citas-vacio-${width}`);
    expect(writes).toEqual([]);
  });
}

test('UX-04C hoy incluye citas pasadas; próximas empieza ahora, sin contradicción ni datos inventados', async ({ page }) => {
  await fixture(page, { pastOnly: true }); await page.goto('/');
  await expect(page.getByRole('region', { name: 'Citas programadas hoy' }).getByText('1', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Agenda de hoy' }).getByText('Mariana Paciente de prueba')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sin próximas atenciones' })).toBeVisible();
  await expect(page.getByText(/Las de hoy cuya hora ya pasó/)).toBeVisible();
});

test('UX-04C filtros, fechas, Día/Semana/Mes y Back/Forward conservan parámetros', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const { calls, writes } = await fixture(page);
  await page.goto('/appointments?date=2026-10-19&view=week&patientId=2');
  await expect(page.getByRole('region', { name: 'Agenda semanal' }).getByRole('link', { name: /Cita con/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Quitar filtro de paciente' }).click();
  await expect(page.getByRole('region', { name: 'Agenda semanal' }).getByRole('link', { name: /Cita con/ })).toHaveCount(8);
  await page.getByLabel('Filtrar por dentista').selectOption('8');
  await expect(page.getByRole('region', { name: 'Agenda semanal' }).getByRole('link', { name: /Cita con/ })).toHaveCount(3);
  await page.getByLabel('Filtrar por estado').selectOption('SCHEDULED');
  await expect(page.getByRole('region', { name: 'Agenda semanal' }).getByRole('link', { name: /Cita con/ })).toHaveCount(2);
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Una semana por organizar' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('date')).toBe('2026-10-26');
  await page.goBack();
  await expect(page.getByRole('region', { name: 'Agenda semanal' }).getByRole('link', { name: /Cita con/ })).toHaveCount(2);
  await page.goForward(); await expect(page.getByRole('heading', { name: 'Una semana por organizar' })).toBeVisible();
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await page.getByLabel('Fecha', { exact: true }).fill('2026-10-20');
  await page.getByRole('button', { name: 'Día', exact: true }).click();
  const p = new URL(page.url()).searchParams;
  expect(Object.fromEntries(p)).toMatchObject({ date: '2026-10-20', view: 'day', dentistId: '8', status: 'SCHEDULED' });
  await expect(page.getByRole('button', { name: /Cita con Valentina/ })).toBeVisible();
  expect(calls.some(url => url.searchParams.get('from') === '2026-10-20T06:00:00.000Z' && url.searchParams.get('dentistId') === '8')).toBe(true);
  await noOverflow(page); expect(writes).toEqual([]);
});

test('UX-04C errores independientes y reintento de agenda', async ({ page }) => {
  const { writes } = await fixture(page, { fail: '/api/appointments' });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Agenda de hoy' }).getByRole('alert')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Cartera pendiente' }).getByText('$3,300.00 MXN')).toBeVisible();
  await page.goto('/appointments');
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
  await page.route('**/api/appointments?**', route => route.fulfill({ json: pageOf([]) }));
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Una semana por organizar' })).toBeVisible();
  expect(writes).toEqual([]);
});

test('UX-04C móvil: filtros por teclado, detalle y regreso sin perder contexto', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 960 });
  const { writes, unexpected } = await fixture(page);
  await page.goto('/appointments');
  const filters = page.getByText('Filtros de agenda', { exact: true });
  await filters.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Filtrar por dentista')).toBeVisible();
  await page.getByLabel('Filtrar por dentista').selectOption('8');
  const daily = page.getByRole('region', { name: 'Agenda del día', exact: true });
  await expect(daily.getByRole('button', { name: /Abrir cita/ })).toHaveCount(1);
  await daily.getByRole('button', { name: /Abrir cita de Alejandro/ }).click();
  await expect(page).toHaveURL(/\/appointments\/2$/);
  await expect(page.getByRole('heading', { name: 'Cita #2', exact: true })).toBeVisible();
  await expect(page.getByText('Alejandro Paciente de prueba', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('Filtrar por dentista')).toHaveValue('8');
  await expect(daily.getByRole('button', { name: /Abrir cita/ })).toHaveCount(1);
  await noOverflow(page); expect(writes).toEqual([]); expect(unexpected).toEqual([]);
});

test('UX-04C contraste representativo, targets, 320/768/1280 y texto al 200%', async ({ page }) => {
  await fixture(page);
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 960 });
    for (const path of ['/', '/appointments']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: path === '/' ? 'Recepción' : 'Citas', exact: true })).toBeVisible();
      await expect(page.locator('.reception-operations .reception-button')).toBeVisible();
      await noOverflow(page);
      const button = page.locator('.reception-operations .reception-button');
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/appointments');
  await expect(page.getByRole('region', { name: 'Agenda semanal' }).getByRole('link', { name: /Cita con/ })).toHaveCount(8);
  const contrast = await page.locator('.reception-journal-cover h1, .reception-journal-cover p, .reception-journal-cover .reception-button, .reception-visit-person strong, .reception-visit-status').evaluateAll(elements => {
    function luminance(rgb: number[]) { const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }); return r! * .2126 + g! * .7152 + b! * .0722; }
    return elements.map(element => {
      const style = getComputedStyle(element);
      let ancestor: Element | null = element;
      let bg = 'rgb(255, 255, 255)';
      while (ancestor) { const value = getComputedStyle(ancestor).backgroundColor; if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') { bg = value; break; } ancestor = ancestor.parentElement; }
      const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const a = luminance(rgb(style.color)), b = luminance(rgb(bg));
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
  });
  for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
  await page.addStyleTag({ content: '.reception-operations { font-size: 200% !important; } .reception-operations h1, .reception-operations h2, .reception-operations h3, .reception-operations p, .reception-operations a, .reception-operations span, .reception-operations button, .reception-operations strong, .reception-operations input, .reception-operations select { font-size: inherit !important; }' });
  await noOverflow(page);
});
