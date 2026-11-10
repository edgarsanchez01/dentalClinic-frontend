import { expect, test, type Page } from '@playwright/test';

// All APIs (including writes and unknown paths) are intercepted. No backend/DB integration.
const NOW = '2026-10-25T23:30:00Z';
const timezone = 'Europe/Madrid';
const days = Array.from({ length: 7 }, (_, index) => ({ dayOfWeek: index + 1, open: index < 5,
  startTime: index < 5 ? '09:00:00' : null, endTime: index < 5 ? '17:00:00' : null,
  breaks: index === 0 ? [{ startTime: '12:00:00', endTime: '13:00:00' }, { startTime: '15:00:00', endTime: '15:15:00' }] : [],
}));
const professionals = [
  { dentistId: 8, firstName: 'Luis', lastName: 'Ajeno', days: [] },
  { dentistId: 7, firstName: 'Ana', lastName: 'Prueba', days: [] },
];
const exception = { date: '2026-11-02', closed: true, reason: 'Excepción propia registrada' };
const absence = { id: 40, startDate: '2026-11-03', endDate: '2026-11-03', allDay: false, startTime: '10:00:00', endTime: '11:00:00', reason: 'Ausencia propia registrada' };

async function fixture(page: Page, role = 'DENTIST', dentistId: number | null = 7) {
  const state = { fail: '', empty: false, availability: 'results', directory: professionals, wrongId: false };
  const calls: Array<{ path: string; search: string; method: string; body: unknown }> = [];
  let week = days;
  let exceptions: Array<Record<string, unknown>> = [exception];
  let absences: Array<Record<string, unknown>> = [absence];
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const body = request.postDataJSON();
    calls.push({ path, method, search: url.search, body });
    if (state.fail === path || path === '/api/availability' && state.availability === 'error') {
      await route.fulfill({ status: 503, json: { message: 'Consulta de prueba no disponible.' } }); return;
    }
    // Ownership is enforced by the simulated server too, not by filtering its response.
    const privateId = path.match(/^\/api\/schedules\/dentist\/(\d+)/)?.[1];
    if (role === 'DENTIST' && privateId && Number(privateId) !== dentistId) {
      await route.fulfill({ status: 404, json: { message: 'No encontrado.' } }); return;
    }
    let result: unknown;
    if (path === '/api/auth/refresh') result = { accessToken: 'synthetic-scheduling-token' };
    else if (path === '/api/auth/me') result = { id: 1, email: 'synthetic@example.test', role, active: true, dentistId, createdAt: NOW };
    else if (path === '/api/onboarding/status') result = { status: 'COMPLETED', clinicConfigured: true };
    else if (path === '/api/notifications/unread-count') result = { unread: 0 };
    else if (path === '/api/public/schedule') result = { timezone, days, exceptions: [], dentists: state.directory };
    else if (path === '/api/schedules/clinic') result = { timezone, days: state.empty ? [] : days };
    else if (path === '/api/schedules/clinic/exceptions') result = state.empty ? [] : [{ ...exception, reason: 'Cierre de clínica registrado' }];
    else if (path === '/api/availability/policy') result = { timezone, maxAdvanceDays: 73, minBookingLeadTimeHours: 3, cancellationLeadTimeHours: 16 };
    else if (/^\/api\/schedules\/dentist\/\d+$/.test(path)) {
      if (method === 'PUT') week = body.days;
      result = { dentistId: state.wrongId ? 999 : Number(privateId), timezone, days: state.empty ? [] : week };
    } else if (/\/dentist\/\d+\/exceptions(?:\/[^/]+)?$/.test(path)) {
      if (method === 'PUT') exceptions = [...exceptions.filter((item) => item.date !== path.split('/').at(-1)), { date: path.split('/').at(-1), ...body }];
      if (method === 'DELETE') exceptions = exceptions.filter((item) => item.date !== path.split('/').at(-1));
      result = method === 'PUT' ? exceptions.at(-1) : state.empty ? [] : exceptions;
    } else if (/\/dentist\/\d+\/time-off(?:\/\d+)?$/.test(path)) {
      if (method === 'POST') absences = [...absences, { id: 50, allDay: !body.startTime, ...body }];
      if (method === 'PUT') absences = absences.map((item) => item.id === Number(path.split('/').at(-1)) ? { ...item, allDay: !body.startTime, ...body } : item);
      if (method === 'DELETE') absences = absences.filter((item) => item.id !== Number(path.split('/').at(-1)));
      result = method === 'POST' ? absences.at(-1) : method === 'PUT' ? absences.find((item) => item.id === Number(path.split('/').at(-1))) : state.empty ? [] : absences;
    } else if (path === '/api/availability') {
      const date = url.searchParams.get('from')!;
      result = { dentistId: state.wrongId ? 999 : Number(url.searchParams.get('dentistId')), timezone, durationMinutes: Number(url.searchParams.get('duration')),
        slots: state.availability === 'empty' ? [] : [
          { startDate: date, startTime: '14:00:00', endTime: '14:30:00', start: `${date}T13:00:00Z`, end: `${date}T13:30:00Z` },
          { startDate: date, startTime: '09:00:00', endTime: '09:30:00', start: `${date}T08:00:00Z`, end: `${date}T08:30:00Z` },
        ] };
    } else { await route.fulfill({ status: 404, json: {} }); return; }
    if (method === 'DELETE') await route.fulfill({ status: 204 });
    else await route.fulfill({ json: result });
  });
  return { state, calls };
}

const editor = (page: Page) => page.locator('section.reception-card').filter({ has: page.getByRole('heading', { name: /^(Horario de dentistas|Gestionar mi horario)$/ }) });

async function openWeek(page: Page) {
  const button = editor(page).getByRole('button', { name: 'Editar horario' });
  await expect(button).toBeEnabled();
  await button.click();
}

async function samePixels(page: Page, expected: { image: Buffer; contentHeight: number }, actual: { image: Buffer; contentHeight: number }) {
  // PNG encoders may use different compression for identical pixels. Compare decoded RGBA.
  if (expected.contentHeight !== actual.contentHeight) return false;
  return page.evaluate(async ({ expected, actual, contentHeight }) => {
    async function decode(source: string) {
      const image = new Image(); image.src = `data:image/png;base64,${source}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, contentHeight).data };
    }
    const [a, b] = await Promise.all([decode(expected), decode(actual)]);
    return a.width === b.width && a.height === b.height && a.pixels.every((value, index) => value === b.pixels[index]);
  }, { expected: expected.image.toString('base64'), actual: actual.image.toString('base64'), contentHeight: expected.contentHeight });
}

async function blockScreenshot(page: Page, selector: string, style: string, path: string) {
  const sheet = await page.addStyleTag({ content: style });
  try {
    const block = page.locator(selector);
    const box = (await block.boundingBox())!;
    // Never capture the partially covered exterior row of a fractional-height block.
    // That row can blend with a different shell behind the page, not with the component.
    return { image: await block.screenshot({ path, animations: 'disabled' }), contentHeight: Math.floor(box.height) };
  } finally { await sheet.evaluate((el) => el.remove()); }
}

test('BUILD04A regresión visual RECEPTIONIST/OWNER', async ({ page }) => {
  test.setTimeout(90_000);
  test.skip(!process.env.DC_SCHEDULING_CAPTURE, 'Baseline opt-in en configuración aislada.');
  for (const role of ['RECEPTIONIST', 'OWNER']) {
    await page.unrouteAll({ behavior: 'wait' });
    await fixture(page, role);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/scheduling');
      if (role === 'RECEPTIONIST') await expect(page.locator('.rs-policy')).toContainText('73');
      else await expect(editor(page).getByRole('button', { name: 'Guardar horario' })).toBeEnabled();
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      await expect(page).toHaveScreenshot(`${role}-scheduling-${width}.png`, { fullPage: true, animations: 'disabled', maxDiffPixels: 0 });
    }
  }
});

// The pre-tabs whole-editor golden is superseded by this intentional navigation change.
// Keep OWNER/RECEPTIONIST pixel baselines and consultation comparisons unchanged.
for (const width of [1440, 768, 390, 320]) {
  test(`UX01 BUILD01 apartados de gestión a ${width}px`, async ({ page }) => {
    const api = await fixture(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/scheduling');
    const tools = editor(page);
    await expect(tools.getByRole('button', { name: 'Editar horario' })).toBeEnabled();
    await page.getByRole('link', { name: 'Gestionar mi horario' }).click();
    await expect(page).toHaveURL(/\/scheduling#professional-schedule-tools$/);
    const url = page.url();
    await page.evaluate(() => document.fonts.ready);
    await expect(tools.locator('[role="tabpanel"]')).toHaveCount(3);
    await expect(tools.getByRole('tab', { name: 'Mi semana' })).toHaveAttribute('aria-selected', 'true');
    for (const name of ['Mi semana', 'Excepciones', 'Ausencias']) {
      const tab = tools.getByRole('tab', { name, exact: true });
      await tab.click();
      const panel = tools.getByRole('tabpanel', { name, exact: true });
      await expect(panel).toBeVisible();
      await expect(tools.getByRole('tabpanel')).toHaveCount(1);
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      expect(await tab.getAttribute('aria-controls')).toBe(await panel.getAttribute('id'));
      expect(await panel.getAttribute('aria-labelledby')).toBe(await tab.getAttribute('id'));
      const nav = tools.getByRole('tablist');
      expect(await nav.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const navBox = (await nav.boundingBox())!;
      const toolsBox = (await tools.boundingBox())!;
      expect(navBox.x + navBox.width).toBeLessThanOrEqual(toolsBox.x + toolsBox.width);
      for (const button of await nav.getByRole('tab').all()) {
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await page.mouse.move(0, 0);
      await tools.screenshot({ path: test.info().outputPath(`management-${name}-${width}.png`), animations: 'disabled',
        style: 'nav[aria-label="Navegación rápida"] { visibility: hidden !important; }' });
      expect(page.url()).toBe(url);
    }
    expect(api.calls.filter(({ path, method }) => !path.startsWith('/api/auth/') && method !== 'GET')).toEqual([]);
  });
}

test('UX01 BUILD01 teclado, activación manual, foco y paneles ocultos fuera de Tab', async ({ page }) => {
  await fixture(page);
  await page.goto('/scheduling');
  const tools = editor(page);
  const week = tools.getByRole('tab', { name: 'Mi semana' });
  const exceptions = tools.getByRole('tab', { name: 'Excepciones', exact: true });
  const absences = tools.getByRole('tab', { name: 'Ausencias', exact: true });
  await week.focus();
  await page.keyboard.press('ArrowRight');
  await expect(exceptions).toBeFocused();
  await expect(week).toHaveAttribute('aria-selected', 'true');
  expect(await exceptions.evaluate((el) => {
    const style = getComputedStyle(el);
    return el.matches(':focus-visible') && (style.outlineStyle !== 'none' || style.boxShadow !== 'none');
  })).toBe(true);
  await page.keyboard.press('Space');
  await expect(exceptions).toHaveAttribute('aria-selected', 'true');
  await expect(exceptions).toBeFocused();
  await page.keyboard.press('End');
  await expect(absences).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(absences).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(week).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(absences).toBeFocused();
  await page.keyboard.press('Home');
  await expect(week).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tools.getByRole('tabpanel', { name: 'Mi semana' })).toBeVisible();
  await exceptions.click();
  await page.keyboard.press('Tab');
  await expect(tools.getByRole('tabpanel', { name: 'Excepciones', exact: true })).toBeFocused();
  // Traverse the full form and beyond; no hidden panel can receive focus.
  for (let index = 0; index < 24; index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="tabpanel"][hidden]'))).toBe(false);
  }
  await absences.click();
  await page.keyboard.press('Tab');
  await expect(tools.getByRole('tabpanel', { name: 'Ausencias', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(absences).toBeFocused();
});

test('UX01 BUILD01 alternar conserva borradores, errores y edición sin solicitudes de escritura', async ({ page }) => {
  const api = await fixture(page);
  await page.goto('/scheduling');
  const tools = editor(page);
  const select = (name: string) => tools.getByRole('tab', { name, exact: true }).click();
  const week = tools.getByRole('tabpanel', { name: 'Mi semana' });
  const exceptions = tools.getByRole('tabpanel', { name: 'Excepciones', exact: true });
  const absences = tools.getByRole('tabpanel', { name: 'Ausencias', exact: true });
  await openWeek(page);
  await week.getByLabel('Inicio Lunes', { exact: true }).fill('');
  await week.getByRole('button', { name: 'Guardar horario' }).click();
  await expect(week.getByRole('alert')).toContainText('Lunes: indica la hora de apertura y la de cierre.');
  await select('Excepciones');
  await exceptions.getByRole('button', { name: 'Editar', exact: true }).click();
  await exceptions.getByLabel('Motivo (opcional)').fill('Borrador de excepción');
  await exceptions.getByLabel('Cerrado todo el día').uncheck();
  await exceptions.getByLabel('Apertura', { exact: true }).fill('14:00');
  await exceptions.getByLabel('Cierre', { exact: true }).fill('13:00');
  await exceptions.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(exceptions.getByRole('alert')).toContainText('La apertura de la excepción debe ser anterior al cierre.');
  await select('Ausencias');
  await absences.getByRole('button', { name: 'Editar', exact: true }).click();
  await absences.getByLabel('Motivo (opcional)').fill('Borrador de ausencia');
  await absences.getByLabel('Hora inicio').fill('14:00');
  await absences.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(absences.getByRole('alert')).toContainText('La hora de inicio debe ser anterior a la de fin.');
  await select('Mi semana');
  await expect(week.getByLabel('Inicio Lunes', { exact: true })).toHaveValue('');
  await expect(week.getByRole('alert')).toContainText('Lunes: indica la hora de apertura y la de cierre.');
  await select('Excepciones');
  await expect(exceptions.getByLabel('Motivo (opcional)')).toHaveValue('Borrador de excepción');
  await expect(exceptions.getByRole('button', { name: 'Guardar cambios' })).toBeVisible();
  await expect(exceptions.getByRole('alert')).toBeVisible();
  await select('Ausencias');
  await expect(absences.getByLabel('Motivo (opcional)')).toHaveValue('Borrador de ausencia');
  await expect(absences.getByRole('button', { name: 'Guardar cambios' })).toBeVisible();
  await expect(absences.getByRole('alert')).toBeVisible();
  expect(api.calls.filter(({ path, method }) => !path.startsWith('/api/auth/') && method !== 'GET')).toEqual([]);
});

for (const width of [1440, 768, 390, 320]) {
  test(`BUILD04A consulta compartida y privada propia a ${width}px`, async ({ page, context }) => {
    test.setTimeout(60_000);
    const api = await fixture(page);
    const reception = await context.newPage();
    await fixture(reception, 'RECEPTIONIST');
    for (const target of [page, reception]) {
      await target.setViewportSize({ width, height: 1000 });
      await target.goto('/scheduling');
      await expect(target.locator('.rs-policy')).toContainText('73');
    }
    await reception.getByRole('button', { name: 'Cambiar dentista' }).click();
    await reception.getByRole('option', { name: 'Ana Prueba', exact: true }).click();
    await expect(reception.locator('.rs-selected-name')).toHaveText('Ana Prueba');
    for (const target of [page, reception]) {
      const tool = target.getByRole('region', { name: 'Consultar disponibilidad', exact: true });
      await expect(tool.getByLabel('Fecha', { exact: true })).toHaveValue('2026-10-26');
      await tool.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
      await expect(tool.locator('.rs-slots li')).toHaveText(['09:00–09:30', '14:00–14:30']);
      await target.evaluate(() => document.fonts.ready);
      await target.mouse.move(0, 0);
    }
    // Normalize excluded context and the newly interleaved management block only
    // for component parity. BUILD04B separately captures the real, unmodified order.
    const style = '#professional-schedule-tools { display: none !important; } .reception-page-heading { height: 260px !important; } .rs-directory { height: 140px !important; position: static !important; visibility: hidden !important; } .rs-professional .rs-heading { height: 80px !important; } .rs-tool-controls > .rs-field { display: none !important; } nav[aria-label="Navegación rápida"] { visibility: hidden !important; }';
    const selectors = ['.rs-calendar', '.rs-exceptions', '.rs-search', '.rs-results', '.rs-clinic'];
    for (const [index, selector] of selectors.entries()) {
      const expected = await blockScreenshot(reception, selector, style, test.info().outputPath(`reception-${index}-${width}.png`));
      const actual = await blockScreenshot(page, selector, style, test.info().outputPath(`dentist-${index}-${width}.png`));
      expect(await samePixels(page, expected, actual), `${selector}: misma presentación aprobada`).toBe(true);
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('.dentist-scheduling-flow').screenshot({ path: test.info().outputPath(`dentist-consultation-${width}.png`), animations: 'disabled' });
    const consultation = page.locator('.reception-scheduling');
    for (const block of await consultation.all()) expect(await block.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const control of await consultation.locator('input, select, button, a').all()) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    if (width < 1101) {
      await page.getByLabel('Día de la semana', { exact: true }).selectOption('6');
      await expect(page.locator('.rs-calendar-day h3')).toHaveText('Domingo');
      await expect(page.getByRole('button', { name: 'Día siguiente', exact: true })).toBeDisabled();
      await page.getByLabel('Día de la semana', { exact: true }).selectOption('0');
      await page.getByRole('button', { name: 'Día siguiente', exact: true }).click();
      await expect(page.locator('.rs-calendar-day h3')).toHaveText('Martes');
    } else await expect(page.locator('.rs-calendar-day')).toHaveCount(7);
    await expect(consultation.getByRole('button', { name: /Guardar|Editar|Eliminar|Añadir|Reservar/ })).toHaveCount(0);
    await expect(consultation.getByRole('button', { name: 'Cambiar dentista' })).toHaveCount(0);
    const tool = page.getByRole('region', { name: 'Consultar disponibilidad', exact: true });
    await tool.getByLabel('Dentista', { exact: true }).selectOption('8');
    await expect(tool.locator('.rs-slots')).toHaveCount(0);
    await tool.getByRole('button', { name: 'Buscar disponibilidad' }).click();
    await expect(tool.locator('.rs-result-context')).toContainText('Luis Ajeno');
    await expect(page.locator('.rs-selected-name')).toHaveText('Ana Prueba');
    expect(api.calls.filter(({ path }) => path.startsWith('/api/schedules/dentist/')).every(({ path }) => path.startsWith('/api/schedules/dentist/7'))).toBe(true);
    expect(api.calls.filter(({ path }) => !path.startsWith('/api/auth/')).every(({ method }) => method === 'GET')).toBe(true);
    await reception.close();
  });
}

test('BUILD04A criterios pendientes, teclado, carga, error, reintento y respuesta tardía', async ({ page }) => {
  const api = await fixture(page);
  await page.goto('/scheduling');
  const tool = page.getByRole('region', { name: 'Consultar disponibilidad', exact: true });
  const date = tool.getByLabel('Fecha', { exact: true });
  const duration = tool.getByLabel('Duración (min)', { exact: true });
  await expect(date).toHaveValue('2026-10-26');
  await date.fill('2026-10-27');
  await duration.fill('45');
  expect(api.calls.filter(({ path }) => path === '/api/availability')).toHaveLength(0);
  let release!: () => void;
  await page.route('**/api/availability?**', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fallback();
  }, { times: 1 });
  await duration.focus(); await page.keyboard.press('Tab');
  await expect(tool.getByRole('button', { name: 'Buscar disponibilidad' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tool.getByText('Calculando disponibilidad…')).toBeVisible();
  await expect(tool.getByRole('button', { name: 'Buscar disponibilidad' })).toBeDisabled();
  await date.fill('2026-10-28');
  release();
  await expect(tool.locator('.rs-slots')).toHaveCount(0);
  await expect(tool.getByText('Selecciona fecha y duración para consultar intervalos.')).toBeVisible();
  api.state.availability = 'error';
  await tool.getByRole('button', { name: 'Buscar disponibilidad' }).click();
  await expect(tool.getByRole('alert')).toContainText('Consulta de prueba no disponible.');
  await expect(tool.getByText('Sin disponibilidad', { exact: true })).toHaveCount(0);
  api.state.availability = 'empty';
  await tool.getByRole('button', { name: 'Reintentar la disponibilidad' }).click();
  await expect(tool.getByText('Sin disponibilidad', { exact: true })).toBeVisible();
  api.state.availability = 'results';
  await tool.getByRole('button', { name: 'Buscar disponibilidad' }).click();
  await expect(tool.locator('.rs-slots li')).toHaveText(['09:00–09:30', '14:00–14:30']);
  await expect(tool.locator('.rs-result-context')).toContainText('28 de octubre de 2026');
  await expect(tool.locator('.rs-slots').locator('button, a, [tabindex]')).toHaveCount(0);
  expect(api.calls.filter(({ path }) => path === '/api/availability').every(({ search }) => !search.includes('from=2026-10-26'))).toBe(true);
});

test('BUILD04A recursos con carga, error y reintento independiente; vacíos reales', async ({ page }) => {
  const api = await fixture(page);
  let release!: () => void;
  await page.route('**/api/schedules/dentist/7', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; }); await route.fallback();
  }, { times: 1 });
  await page.goto('/scheduling');
  const week = page.getByRole('region', { name: 'Horario semanal', exact: true });
  await expect(week.getByRole('status')).toContainText('Cargando el horario del dentista');
  api.state.fail = '/api/schedules/dentist/7'; release();
  await expect(week.getByRole('alert')).toBeVisible();
  api.state.fail = '';
  await week.getByRole('button', { name: 'Reintentar el horario del dentista' }).click();
  await expect(week.locator('.rs-calendar')).toBeVisible();
  for (const [path, title, label] of [
    ['/api/schedules/dentist/7/exceptions', 'Excepciones del dentista', 'las excepciones del dentista'],
    ['/api/schedules/dentist/7/time-off', 'Ausencias del dentista', 'las ausencias del dentista'],
    ['/api/schedules/clinic', 'Horario de la clínica', 'el horario de la clínica'],
    ['/api/schedules/clinic/exceptions', 'Excepciones de la clínica', 'las excepciones de la clínica'],
    ['/api/availability/policy', 'Política de reservas', 'la política de reservas'],
  ]) {
    api.state.fail = path!; await page.reload();
    const region = page.getByRole('region', { name: title!, exact: true });
    await expect(region.getByRole('alert')).toContainText('Consulta de prueba no disponible.');
    api.state.fail = '';
    await region.getByRole('button', { name: `Reintentar ${label}` }).click();
    await expect(region.getByRole('alert')).toHaveCount(0);
  }
  api.state.empty = true; await page.reload();
  await expect(week.getByText('No hay horario semanal registrado.')).toBeVisible();
  await expect(week.locator('.rs-calendar-columns')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Excepciones del dentista', exact: true })).toContainText('Sin excepciones registradas.');
  await expect(page.getByRole('region', { name: 'Ausencias del dentista', exact: true })).toContainText('Sin ausencias registradas.');
});

test('BUILD04A sin asociación o directorio público no se infiere otro calendario privado', async ({ page }) => {
  const api = await fixture(page, 'DENTIST', null);
  await page.goto('/scheduling');
  await expect(page.getByRole('region', { name: 'Horario semanal', exact: true })).toContainText('Sin perfil profesional asociado');
  await expect(page.locator('.rs-calendar')).toHaveCount(0);
  await expect(editor(page).getByRole('button', { name: 'Guardar horario' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Consultar disponibilidad', exact: true }).getByLabel('Dentista', { exact: true })).toHaveValue('8');
  expect(api.calls.some(({ path }) => path.startsWith('/api/schedules/dentist/'))).toBe(false);
  await page.unrouteAll({ behavior: 'wait' });
  const associatedApi = await fixture(page);
  associatedApi.state.directory = [];
  await page.reload();
  await expect(page.getByRole('region', { name: 'Horario semanal', exact: true }).locator('.rs-calendar')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Consultar disponibilidad', exact: true })).toContainText('Todavía no hay dentistas registrados.');
  expect(associatedApi.calls.filter(({ path }) => path.startsWith('/api/schedules/dentist/')).every(({ path }) => path.startsWith('/api/schedules/dentist/7'))).toBe(true);
});

test('BUILD04A herramientas existentes guardan semana, excepciones y ausencias propias', async ({ page }) => {
  const api = await fixture(page);
  await page.goto('/scheduling');
  const tools = editor(page);
  await openWeek(page);
  await expect(tools).not.toContainText(/franquici/i);
  await page.getByRole('link', { name: 'Gestionar mi horario' }).click();
  await tools.getByLabel('Inicio Lunes', { exact: true }).fill('10:00');
  await tools.getByRole('button', { name: 'Guardar horario' }).click();
  await expect(tools.getByText('Horario del dentista guardado.')).toBeVisible();
  await expect(tools.getByLabel('Inicio Lunes', { exact: true })).toHaveCount(0);
  await expect(tools.getByRole('button', { name: 'Editar horario' })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Horario semanal', exact: true })).toContainText('10:00–17:00');
  await tools.getByRole('tab', { name: 'Excepciones', exact: true }).click();
  await tools.getByRole('button', { name: 'Nueva excepción', exact: true }).click();
  const exceptionForm = tools.getByRole('form', { name: 'Nueva excepción', exact: true });
  await exceptionForm.getByLabel('Fecha', { exact: true }).fill('2026-11-07');
  await exceptionForm.getByLabel('Motivo (opcional)', { exact: true }).fill('Nueva excepción propia');
  await exceptionForm.getByRole('button', { name: 'Añadir excepción' }).click();
  await expect(page.getByRole('region', { name: 'Excepciones del dentista', exact: true })).toContainText('Nueva excepción propia');
  await tools.getByRole('tab', { name: 'Ausencias', exact: true }).click();
  await expect(tools.getByRole('heading', { name: 'Ausencias programadas', exact: true })).toBeVisible();
  await tools.getByRole('button', { name: 'Nueva ausencia', exact: true }).click();
  const absenceForm = tools.getByRole('form', { name: 'Nueva ausencia', exact: true });
  await absenceForm.getByLabel('Desde', { exact: true }).fill('2026-11-09');
  await absenceForm.getByLabel('Hasta', { exact: true }).fill('2026-11-10');
  await absenceForm.getByLabel('Motivo (opcional)', { exact: true }).fill('Nueva ausencia propia');
  await absenceForm.getByRole('button', { name: 'Registrar ausencia' }).click();
  await expect(tools.getByText('Ausencia registrada.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ausencias del dentista', exact: true })).toContainText('Nueva ausencia propia');
  const row = tools.getByRole('listitem').filter({ hasText: 'Nueva ausencia propia' });
  await row.getByRole('button', { name: 'Editar', exact: true }).click();
  const editForm = tools.getByRole('button', { name: 'Guardar cambios', exact: true }).locator('..').locator('..');
  await editForm.getByLabel('Motivo (opcional)', { exact: true }).fill('Ausencia actualizada');
  await editForm.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(tools.getByText('Ausencia actualizada.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ausencias del dentista', exact: true })).toContainText('Ausencia actualizada');
  page.once('dialog', (dialog) => { expect(dialog.message()).toBe('¿Eliminar la ausencia del 2026-11-09?'); void dialog.accept(); });
  await tools.getByRole('listitem').filter({ hasText: 'Ausencia actualizada' }).getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Ausencias del dentista', exact: true })).not.toContainText('Ausencia actualizada');
  await expect(tools.getByText('Ausencia eliminada.', { exact: true })).toBeVisible();
  const writes = api.calls.filter(({ path, method }) => !path.startsWith('/api/auth/') && method !== 'GET');
  expect(writes.map(({ method, path }) => [method, path])).toEqual([
    ['PUT', '/api/schedules/dentist/7'], ['PUT', '/api/schedules/dentist/7/exceptions/2026-11-07'],
    ['POST', '/api/schedules/dentist/7/time-off'], ['PUT', '/api/schedules/dentist/7/time-off/50'], ['DELETE', '/api/schedules/dentist/7/time-off/50'],
  ]);
});

// Test-only access to the same QueryClient used by the app, to exercise background
// refetches without adding a production refresh control or reloading the document.
async function refetchOwnWeek(page: Page) {
  await page.evaluate(async () => {
    const modulePath = '/src/app/authStore.ts';
    const { useAuthStore } = await import(modulePath);
    await useAuthStore.getState().queryClient.invalidateQueries({ queryKey: ['dentist-schedule', 7], exact: true });
  });
}

test('UX01 BUILD02 refresco limpio/modificado, pestañas y protección nativa al cerrar', async ({ page }) => {
  await fixture(page);
  await page.goto('/scheduling');
  const tools = editor(page);
  const start = tools.getByLabel('Inicio Lunes', { exact: true });
  await openWeek(page);
  await expect(start).toHaveValue('09:00');
  let refreshedStart = '08:00:00';
  await page.route('**/api/schedules/dentist/7', async (route) => {
    if (route.request().method() !== 'GET') { await route.fallback(); return; }
    await route.fulfill({ json: { dentistId: 7, timezone, days: days.map((day) => day.dayOfWeek === 1 ? { ...day, startTime: refreshedStart } : day) } });
  });
  await refetchOwnWeek(page);
  await expect(start).toHaveValue('08:00');
  await start.fill('');
  await tools.getByRole('button', { name: 'Guardar horario' }).click();
  await expect(tools.getByRole('alert')).toContainText('Lunes: indica la hora de apertura y la de cierre.');
  await tools.getByRole('tab', { name: 'Ausencias', exact: true }).click();
  refreshedStart = '07:00:00';
  await refetchOwnWeek(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Servicios', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeVisible();
  await page.getByRole('button', { name: 'Seguir aquí' }).click();
  await tools.getByRole('tab', { name: 'Mi semana' }).click();
  await expect(start).toHaveValue('');
  await expect(tools.getByRole('alert')).toContainText('Lunes: indica la hora de apertura y la de cierre.');
  const nativePrompt = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const dialog = await nativePrompt;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  expect(page.isClosed()).toBe(false);
  await expect(start).toHaveValue('');
});

test('UX01 BUILD02 error y respuesta tardía no borran cambios posteriores; guardar libera el guard', async ({ page }) => {
  const api = await fixture(page);
  await page.goto('/scheduling');
  const tools = editor(page);
  const start = tools.getByLabel('Inicio Lunes', { exact: true });
  await openWeek(page);
  await start.fill('10:00');
  api.state.fail = '/api/schedules/dentist/7';
  await tools.getByRole('button', { name: 'Guardar horario' }).click();
  await expect(tools.getByRole('alert')).toContainText('Consulta de prueba no disponible.');
  await expect(start).toHaveValue('10:00');
  api.state.fail = '';
  let release: (() => void) | undefined;
  await page.route('**/api/schedules/dentist/7', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fallback();
  }, { times: 1 });
  try {
    await tools.getByRole('button', { name: 'Guardar horario' }).click();
    await expect.poll(() => !!release).toBe(true);
    await expect(tools.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    await start.fill('11:00');
    await tools.getByRole('tab', { name: 'Excepciones', exact: true }).click();
    await page.getByRole('link', { name: 'Servicios', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Guardado en curso' })).toContainText('Hay un guardado en curso. Salir no garantiza que la operación se cancele');
    await expect(page.getByRole('button', { name: 'Seguir aquí' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    release!();
    await tools.getByRole('tab', { name: 'Mi semana' }).click();
    await expect(tools.getByText('Horario del dentista guardado.')).toBeVisible();
    await expect(start).toHaveValue('11:00');
    await expect(page.getByRole('region', { name: 'Horario semanal', exact: true })).toContainText('10:00–17:00');
    await page.getByRole('link', { name: 'Servicios', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeVisible();
    await page.getByRole('button', { name: 'Seguir aquí' }).click();
    await tools.getByRole('button', { name: 'Guardar horario' }).click();
    await expect(page.getByRole('region', { name: 'Horario semanal', exact: true })).toContainText('11:00–17:00');
    await page.getByRole('link', { name: 'Servicios', exact: true }).click();
    await expect(page).toHaveURL(/\/services$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally { release?.(); }
});

for (const width of [1440, 390]) {
  test(`UX01 BUILD02 salir durante guardado sin cambios a ${width}px no promete cancelación`, async ({ page }) => {
    await fixture(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/scheduling');
    const tools = editor(page);
    await openWeek(page);
    let release: (() => void) | undefined;
    await page.route('**/api/schedules/dentist/7', async (route) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fallback();
    }, { times: 1 });
    try {
      await tools.getByRole('button', { name: 'Guardar horario' }).click();
      await expect.poll(() => !!release).toBe(true);
      await tools.getByRole('tab', { name: 'Ausencias', exact: true }).click();
      // The real sidebar is inside a drawer on mobile.
      if (width < 768) await page.getByRole('button', { name: 'Abrir menú de navegación' }).click();
      await page.getByRole('link', { name: 'Servicios', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Guardado en curso' });
      await expect(dialog).toContainText('Hay un guardado en curso. Salir no garantiza que la operación se cancele');
      await expect(dialog).not.toContainText(/cobro|clave|finalización/);
      await expect(dialog.getByRole('button', { name: 'Seguir aquí' })).toBeFocused();
      await dialog.screenshot({ path: test.info().outputPath(`scheduling-pending-${width}.png`) });
      await dialog.getByRole('button', { name: 'Salir de esta vista' }).click();
      await expect(page).toHaveURL(/\/services$/);
    } finally { release?.(); }
  });
}

for (const width of [1440, 768, 390, 320]) {
  test(`UX01 BUILD03 formulario contextual y borradores a ${width}px`, async ({ page }) => {
    const api = await fixture(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/scheduling');
    const tools = editor(page);
    await tools.getByRole('tab', { name: 'Excepciones', exact: true }).click();
    const panel = tools.getByRole('tabpanel', { name: 'Excepciones', exact: true });
    const create = panel.getByRole('button', { name: 'Nueva excepción', exact: true });
    await expect(create).toBeEnabled();
    await expect(panel.getByRole('heading', { name: 'Excepciones por fecha' })).toBeVisible();
    await expect(panel.getByText(/Excepción propia registrada/)).toBeVisible();
    await expect(panel.getByRole('form')).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    const capture = async (state: string) => {
      await page.mouse.move(0, 0);
      await tools.screenshot({ path: test.info().outputPath(`exceptions-${state}-${width}.png`), animations: 'disabled',
        style: 'nav[aria-label="Navegación rápida"] { visibility: hidden !important; }' });
    };
    await capture('list');
    await create.focus();
    await page.keyboard.press('Enter');
    const form = panel.getByRole('form', { name: 'Nueva excepción', exact: true });
    await expect(form.getByLabel('Fecha', { exact: true })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await capture('new');
    await form.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(panel.getByRole('form')).toHaveCount(0);
    await expect(create).toBeFocused();
    await create.click();
    await form.getByLabel('Fecha', { exact: true }).fill('2026-11-07');
    await form.getByLabel('Cerrado todo el día').uncheck();
    await form.getByLabel('Apertura', { exact: true }).fill('14:00');
    await form.getByLabel('Cierre', { exact: true }).fill('13:00');
    await form.getByLabel('Motivo (opcional)').fill('Borrador de una excepción con horario especial');
    await form.getByRole('button', { name: 'Añadir excepción' }).click();
    await expect(form.getByRole('alert')).toContainText('La apertura de la excepción debe ser anterior al cierre.');
    await expect(form.locator('[data-exception-validation]')).toBeFocused();
    await capture('validation');
    await tools.getByRole('tab', { name: 'Mi semana' }).click();
    await tools.getByRole('tab', { name: 'Excepciones', exact: true }).click();
    await expect(form.getByLabel('Fecha', { exact: true })).toHaveValue('2026-11-07');
    await expect(form.getByRole('alert')).toBeVisible();
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toBe('¿Descartar los cambios sin guardar de esta excepción?');
      void dialog.dismiss();
    });
    await form.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    await form.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(panel.getByRole('form')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Editar', exact: true }).click();
    const editForm = panel.getByRole('form', { name: 'Editar excepción', exact: true });
    await expect(editForm.getByLabel('Fecha', { exact: true })).toBeDisabled();
    await expect(editForm.getByLabel('Cerrado todo el día')).toBeFocused();
    await expect(panel.getByRole('form')).toHaveCount(1);
    await capture('edit');
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const control of await editForm.locator('input, button').all()) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    expect(api.calls.filter(({ path, method }) => !path.startsWith('/api/auth/') && method !== 'GET')).toEqual([]);
  });
}

test('UX01 BUILD03 reemplazo protegido, error, reintento, operación pendiente y borrado relacionado', async ({ page }) => {
  const api = await fixture(page);
  await page.goto('/scheduling');
  const tools = editor(page);
  await tools.getByRole('tab', { name: 'Excepciones', exact: true }).click();
  const panel = tools.getByRole('tabpanel', { name: 'Excepciones', exact: true });
  const create = panel.getByRole('button', { name: 'Nueva excepción', exact: true });
  await create.click();
  await panel.getByLabel('Fecha', { exact: true }).fill('2026-11-07');
  await panel.getByLabel('Motivo (opcional)').fill('Borrador sin sustituir');
  for (const button of [create, panel.getByRole('button', { name: 'Editar', exact: true })]) {
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toBe('¿Descartar los cambios sin guardar de esta excepción?');
      void dialog.dismiss();
    });
    await button.click();
    await expect(panel.getByLabel('Motivo (opcional)')).toHaveValue('Borrador sin sustituir');
  }
  page.once('dialog', (dialog) => void dialog.accept());
  await panel.getByRole('button', { name: 'Editar', exact: true }).click();
  const form = panel.getByRole('form', { name: 'Editar excepción', exact: true });
  await expect(form.getByLabel('Fecha', { exact: true })).toHaveValue('2026-11-02');
  await form.getByLabel('Motivo (opcional)').fill('Excepción actualizada en navegador');
  const path = '/api/schedules/dentist/7/exceptions/2026-11-02';
  api.state.fail = path;
  await form.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(panel.getByRole('alert')).toContainText('Consulta de prueba no disponible.');
  await expect(form.getByLabel('Motivo (opcional)')).toHaveValue('Excepción actualizada en navegador');
  api.state.fail = '';
  let release: (() => void) | undefined;
  await page.route(`**${path}`, async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fallback();
  }, { times: 1 });
  try {
    await form.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect.poll(() => !!release).toBe(true);
    await expect(form.getByLabel('Motivo (opcional)')).toBeDisabled();
    await expect(form.getByRole('button', { name: 'Cancelar', exact: true })).toBeDisabled();
    await expect(create).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Editar', exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Eliminar excepción' })).toBeDisabled();
    await form.evaluate((element) => element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await tools.getByRole('tab', { name: 'Mi semana' }).click();
    release!();
    await expect(tools.getByRole('tab', { name: 'Mi semana' })).toBeFocused();
    await expect(page.getByRole('region', { name: 'Excepciones del dentista', exact: true })).toContainText('Excepción actualizada en navegador');
    await expect(tools.getByRole('tab', { name: 'Mi semana' })).toBeFocused();
    await tools.getByRole('tab', { name: 'Excepciones', exact: true }).click();
    await expect(panel.getByText('Excepción actualizada.', { exact: true })).toBeVisible();
    await expect(panel.getByRole('form')).toHaveCount(0);
    expect(api.calls.filter((call) => call.method === 'PUT' && call.path === path)).toHaveLength(2); // Failed request + retry, not duplicate submit.
    await panel.getByRole('button', { name: 'Editar', exact: true }).click();
    await panel.getByLabel('Motivo (opcional)').fill('Borrador relacionado con eliminación');
    const confirmations: string[] = [];
    const stay = (dialog: import('@playwright/test').Dialog) => {
      confirmations.push(dialog.message());
      if (confirmations.length === 1) void dialog.accept();
      else void dialog.dismiss();
    };
    page.on('dialog', stay);
    await panel.getByRole('button', { name: 'Eliminar excepción' }).click();
    page.off('dialog', stay);
    expect(confirmations).toEqual([
      'Esta excepción tiene cambios sin guardar. Si se elimina el registro, se descartarán esos cambios. ¿Continuar?',
      '¿Eliminar la excepción del 2026-11-02?',
    ]);
    await expect(panel.getByLabel('Motivo (opcional)')).toHaveValue('Borrador relacionado con eliminación');
    const accept = (dialog: import('@playwright/test').Dialog) => void dialog.accept();
    page.on('dialog', accept);
    await panel.getByRole('button', { name: 'Eliminar excepción' }).click();
    page.off('dialog', accept);
    await expect(panel.getByText('Excepción eliminada.', { exact: true })).toBeVisible();
    await expect(panel.getByText('Sin excepciones registradas.')).toBeVisible();
    await expect(panel.getByRole('form')).toHaveCount(0);
    await expect(create).toBeFocused();
  } finally { release?.(); }
});

test('UX01 BUILD03 cambiar de sesión cierra el formulario anterior y libera su registro', async ({ page }) => {
  await fixture(page);
  await page.goto('/scheduling');
  const tools = editor(page);
  await tools.getByRole('tab', { name: 'Excepciones', exact: true }).click();
  await tools.getByRole('button', { name: 'Nueva excepción', exact: true }).click();
  await tools.getByRole('form', { name: 'Nueva excepción', exact: true }).getByLabel('Motivo (opcional)', { exact: true }).fill('Borrador de sesión anterior');
  await page.evaluate(async () => {
    const modulePath = '/src/app/authStore.ts';
    const { useAuthStore } = await import(modulePath);
    useAuthStore.setState({ sessionVersion: useAuthStore.getState().sessionVersion + 1 });
  });
  await expect(tools.getByRole('tab', { name: 'Mi semana' })).toHaveAttribute('aria-selected', 'true');
  await tools.getByRole('tab', { name: 'Excepciones', exact: true }).click();
  await expect(tools.getByRole('form')).toHaveCount(0);
  await page.getByRole('link', { name: 'Servicios', exact: true }).click();
  await expect(page).toHaveURL(/\/services$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const width of [1440, 768, 390, 320]) {
  test(`UX01 BUILD04 consulta y formularios coherentes a ${width}px`, async ({ page }) => {
    const api = await fixture(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/scheduling');
    const tools = editor(page);
    const week = tools.getByRole('tabpanel', { name: 'Mi semana', exact: true });
    await expect(week.getByRole('button', { name: 'Editar horario' })).toBeEnabled();
    await expect(tools.getByLabel('Dentista', { exact: true })).toHaveCount(0);
    await expect(week.getByLabel('Inicio Lunes', { exact: true })).toHaveCount(0);
    await expect(week.locator('.reception-week-row')).toHaveCount(7);
    await expect(week.getByText('Descanso:', { exact: false })).toContainText('12:00–13:00');
    const initialHeading = (await week.locator('.schedule-management-heading').boundingBox())!;
    const initialTools = (await tools.boundingBox())!;
    const headingOffset = initialHeading.y - initialTools.y;
    const capture = async (state: string) => {
      await page.evaluate(() => document.fonts.ready);
      await page.mouse.move(0, 0);
      expect(await tools.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await tools.screenshot({ path: test.info().outputPath(`unified-${state}-${width}.png`), animations: 'disabled',
        style: 'nav[aria-label="Navegación rápida"] { visibility: hidden !important; }' });
    };
    await capture('week-read');
    await openWeek(page);
    await expect(week.getByLabel('Lunes', { exact: true })).toBeFocused();
    await capture('week-edit');
    await week.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(week.getByRole('button', { name: 'Editar horario' })).toBeFocused();
    await openWeek(page);
    await week.getByLabel('Inicio Lunes', { exact: true }).fill('');
    await week.getByRole('button', { name: 'Guardar horario' }).click();
    await expect(week.getByRole('alert')).toContainText('Lunes: indica la hora de apertura y la de cierre.');
    await capture('week-validation');
    await tools.getByRole('tab', { name: 'Ausencias', exact: true }).click();
    const absences = tools.getByRole('tabpanel', { name: 'Ausencias', exact: true });
    await expect(absences.getByRole('heading', { name: 'Ausencias programadas' })).toBeVisible();
    await expect(absences.getByRole('form')).toHaveCount(0);
    const absenceHeading = (await absences.locator('.schedule-management-heading').boundingBox())!;
    expect(Math.abs(absenceHeading.y - (await tools.boundingBox())!.y - headingOffset)).toBeLessThanOrEqual(1);
    await capture('absences-list');
    await absences.getByRole('button', { name: 'Nueva ausencia', exact: true }).click();
    let form = absences.getByRole('form', { name: 'Nueva ausencia', exact: true });
    await expect(form.getByLabel('Desde', { exact: true })).toBeFocused();
    await capture('absence-new');
    // This clean cancellation must not confirm because Mi semana has a draft.
    await form.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(absences.getByRole('form')).toHaveCount(0);
    await absences.getByRole('button', { name: 'Nueva ausencia', exact: true }).click();
    form = absences.getByRole('form', { name: 'Nueva ausencia', exact: true });
    await form.getByLabel('Todo el día (permite varios días)').uncheck();
    await form.getByLabel('Hora inicio').fill('14:00');
    await form.getByLabel('Hora fin').fill('13:00');
    await form.getByLabel('Motivo (opcional)').fill('Borrador de ausencia con horas');
    await form.getByRole('button', { name: 'Registrar ausencia' }).click();
    await expect(form.getByRole('alert')).toContainText('La hora de inicio debe ser anterior a la de fin.');
    await capture('absence-validation');
    await tools.getByRole('tab', { name: 'Excepciones', exact: true }).click();
    await expect(tools.getByRole('heading', { name: 'Excepciones por fecha' })).toBeVisible();
    await capture('exceptions-list');
    await tools.getByRole('tab', { name: 'Ausencias', exact: true }).click();
    await expect(form.getByLabel('Motivo (opcional)')).toHaveValue('Borrador de ausencia con horas');
    await expect(form.getByRole('alert')).toBeVisible();
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toBe('¿Descartar los cambios sin guardar de esta ausencia?');
      void dialog.dismiss();
    });
    await form.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    await form.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await tools.getByRole('tab', { name: 'Mi semana' }).click();
    await expect(week.getByLabel('Inicio Lunes', { exact: true })).toHaveValue('');
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toBe('¿Descartar los cambios sin guardar de tu horario?');
      void dialog.accept();
    });
    await week.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(week.getByLabel('Inicio Lunes', { exact: true })).toHaveCount(0);
    expect(api.calls.filter(({ path, method }) => !path.startsWith('/api/auth/') && method !== 'GET')).toEqual([]);
  });
}

test('UX01 BUILD04 Ausencias: fallo, reintento, respuesta oculta, navegación y recarga protegidas', async ({ page }) => {
  const api = await fixture(page);
  await page.goto('/scheduling');
  const tools = editor(page);
  await tools.getByRole('tab', { name: 'Ausencias', exact: true }).click();
  const panel = tools.getByRole('tabpanel', { name: 'Ausencias', exact: true });
  await panel.getByRole('button', { name: 'Nueva ausencia', exact: true }).click();
  const form = panel.getByRole('form', { name: 'Nueva ausencia', exact: true });
  await form.getByLabel('Desde', { exact: true }).fill('2026-11-09');
  await form.getByLabel('Hasta', { exact: true }).fill('2026-11-10');
  await form.getByLabel('Motivo (opcional)').fill('Ausencia conservada');
  api.state.fail = '/api/schedules/dentist/7/time-off';
  await form.getByRole('button', { name: 'Registrar ausencia' }).click();
  await expect(panel.getByRole('alert')).toContainText('Consulta de prueba no disponible.');
  await expect(form.getByLabel('Motivo (opcional)')).toHaveValue('Ausencia conservada');
  api.state.fail = '';
  let release: (() => void) | undefined;
  await page.route('**/api/schedules/dentist/7/time-off', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fallback();
  }, { times: 1 });
  try {
    await form.getByRole('button', { name: 'Registrar ausencia' }).click();
    await expect.poll(() => !!release).toBe(true);
    await expect(form.getByRole('button', { name: 'Cancelar', exact: true })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Nueva ausencia', exact: true })).toBeDisabled();
    await form.evaluate((el) => el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await tools.getByRole('tab', { name: 'Mi semana' }).click();
    await page.getByRole('link', { name: 'Servicios', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Guardado en curso' })).toBeVisible();
    await page.keyboard.press('Escape');
    await tools.getByRole('tab', { name: 'Mi semana' }).click();
    release!();
    await expect(page.getByRole('region', { name: 'Ausencias del dentista', exact: true })).toContainText('Ausencia conservada');
    await expect(tools.getByRole('tab', { name: 'Mi semana' })).toBeFocused();
    await tools.getByRole('tab', { name: 'Ausencias', exact: true }).click();
    await expect(panel.getByRole('form')).toHaveCount(0);
    await expect(panel.getByText('Ausencia registrada.', { exact: true })).toBeVisible();
    expect(api.calls.filter((call) => call.path === '/api/schedules/dentist/7/time-off' && call.method === 'POST')).toHaveLength(2);
    await panel.getByRole('button', { name: 'Nueva ausencia', exact: true }).click();
    await form.getByLabel('Motivo (opcional)').fill('Borrador sin enviar');
    await tools.getByRole('tab', { name: 'Excepciones', exact: true }).click();
    await page.getByRole('link', { name: 'Servicios', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeVisible();
    await page.getByRole('button', { name: 'Seguir aquí' }).click();
    const prompt = page.waitForEvent('dialog');
    // Trigger a real reload without waiting for a navigation commit that the user
    // intentionally cancels in beforeunload.
    const reload = page.evaluate(() => { window.location.reload(); });
    const native = await prompt;
    expect(native.type()).toBe('beforeunload');
    await native.dismiss(); await reload;
    await tools.getByRole('tab', { name: 'Ausencias', exact: true }).click();
    await expect(form.getByLabel('Motivo (opcional)')).toHaveValue('Borrador sin enviar');
  } finally { release?.(); }
});

for (const width of [1440, 768, 390, 320]) {
  test(`UX01 BUILD04B orden, ancla y borradores sin reinicializar a ${width}px`, async ({ page }) => {
    const api = await fixture(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/scheduling');
    const tools = editor(page);
    await expect(tools.getByRole('button', { name: 'Editar horario' })).toBeEnabled();
    await expect(page.locator('.rs-policy')).toContainText('73');
    await expect(page.getByRole('region', { name: 'Excepciones del dentista', exact: true })).toContainText('Excepción propia registrada');
    const boxes = await page.evaluate(() => [
      '.reception-page-heading', '.rs-directory', '.rs-professional', '#professional-schedule-tools', '.rs-availability', '.rs-clinic',
    ].map((selector) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return { top: rect.top + scrollY, bottom: rect.bottom + scrollY };
    }));
    for (let index = 1; index < boxes.length; index++) expect(boxes[index].top).toBeGreaterThanOrEqual(boxes[index - 1].bottom);
    await expect(page.locator('#professional-schedule-tools')).toHaveCount(1);
    await expect(page.locator('.rs-calendar')).toHaveCount(1);
    await expect(page.getByRole('tablist', { name: 'Gestionar mi horario' })).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Consultar disponibilidad', exact: true })).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Información de la clínica', exact: true })).toHaveCount(1);
    expect(await page.locator('#professional-schedule-tools').evaluate((el) => el.closest('.reception-scheduling') === null)).toBe(true);
    expect(await page.locator('.dentist-scheduling-flow').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: test.info().outputPath(`reordered-page-${width}.png`), fullPage: true, animations: 'disabled' });

    const link = page.getByRole('link', { name: 'Gestionar mi horario', exact: true });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/scheduling#professional-schedule-tools$/);
    await expect(tools.getByRole('tab', { name: 'Mi semana' })).toBeFocused();
    await expect(tools).toBeInViewport();
    const offset = await page.locator('#professional-schedule-tools').evaluate((el) => el.getBoundingClientRect().top);
    expect(offset).toBeGreaterThanOrEqual(-1);
    expect(offset).toBeLessThanOrEqual(2);
    await tools.screenshot({ path: test.info().outputPath(`reordered-management-${width}.png`), animations: 'disabled',
      style: 'nav[aria-label="Navegación rápida"] { visibility: hidden !important; }' });
    await page.keyboard.press('Tab');
    await expect(tools.getByRole('tabpanel', { name: 'Mi semana' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(tools.getByRole('button', { name: 'Editar horario' })).toBeFocused();
    await page.keyboard.press('Enter');
    const input = tools.getByLabel('Inicio Lunes', { exact: true });
    await input.fill('');
    await tools.getByRole('button', { name: 'Guardar horario' }).click();
    await expect(tools.getByRole('alert')).toContainText('Lunes: indica la hora de apertura y la de cierre.');
    for (const name of ['Excepciones', 'Ausencias']) await tools.getByRole('tab', { name, exact: true }).click();
    await page.evaluate(() => scrollTo(0, 0));
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(tools.getByRole('tab', { name: 'Ausencias', exact: true })).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await tools.getByRole('tab', { name: 'Mi semana' }).click();
    await expect(input).toHaveValue('');
    await expect(tools.getByRole('alert')).toBeVisible();
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toBe('¿Descartar los cambios sin guardar de tu horario?');
      void dialog.accept();
    });
    await tools.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(tools.getByRole('button', { name: 'Editar horario' })).toBeFocused();
    expect(api.calls.filter(({ path, method }) => !path.startsWith('/api/auth/') && method !== 'GET')).toEqual([]);
  });
}
