import { expect, test, type Page } from '@playwright/test';

const NOW = '2026-11-01T01:00:00Z';
const empty = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
const appointment = { id: 7, patientId: 4, patientUserId: 10, patientFirstName: 'Ana', patientLastName: 'Paciente de prueba',
  dentistId: 3, dentistFirstName: 'Olivia', dentistLastName: 'Profesional de prueba', startAt: '2026-11-01T02:00:00Z',
  endAt: '2026-11-01T03:00:00Z', durationMinutes: 60, status: 'SCHEDULED', occurrenceVersion: 2,
  createdByUserId: 10, createdAt: NOW, service: { id: 1, name: 'Servicio de prueba autorizado', description: 'Descripción', durationMinutes: 60, referencePrice: 100 } };
const days = [1, 2, 3, 4, 5, 6, 7].map(dayOfWeek => ({ dayOfWeek, open: true, startTime: '08:00:00', endTime: '22:00:00', breaks: [] }));
type Role = 'DENTIST' | 'PATIENT';
async function fixture(page: Page, role: Role, options: { empty?: boolean; fail?: string; zone?: string; missing?: boolean; wrongScope?: boolean } = {}) {
  await page.clock.setFixedTime(new Date(NOW));
  const calls: URL[] = [];
  let authenticated = true;
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const url = new URL(route.request().url()), path = url.pathname; calls.push(url);
    if (path === options.fail) { await route.fulfill({ status: 503, json: {} }); return; }
    if (path === '/api/auth/refresh') { await route.fulfill({ status: authenticated ? 200 : 401, json: { accessToken: 'care-browser-mock' } }); return; }
    if (path === '/api/auth/logout') { authenticated = false; await route.fulfill({ status: 204 }); return; }
    let body: unknown;
    if (path === '/api/auth/me') body = { id: 10, role, email: 'actor@care.test', active: true, createdAt: NOW,
      ...(role === 'PATIENT' ? { medicalOnboarding: { requirement: 'EXEMPT_EXISTING', progress: 'NOT_STARTED', pending: false } } : {}),
      ...(options.missing ? {} : { dentistId: 3, patientId: 4 }) };
    else if (path === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (path === '/api/availability/policy') body = { timezone: options.zone ?? 'America/Mexico_City', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 };
    else if (path === '/api/public/schedule') body = { timezone: 'America/Mexico_City', days, exceptions: [], dentists: [{ dentistId: 3, firstName: 'Olivia', lastName: 'Prueba', days }] };
    else if (path === '/api/schedules/clinic') body = { timezone: 'America/Mexico_City', days };
    else if (path === '/api/appointments') {
      const size = Number(url.searchParams.get('size') ?? 20), currentPage = Number(url.searchParams.get('page') ?? 0);
      const isDay = url.searchParams.has('to');
      const content = isDay && size === 5 ? ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map((status, index) => ({
        ...appointment, id: 20 + index, patientFirstName: `Paciente ${currentPage}-${index}`, status,
        startAt: `2026-10-31T${13 + index}:00:00Z`, endAt: `2026-10-31T${14 + index}:00:00Z`,
      })) : [appointment];
      if (options.wrongScope) content[0] = { ...content[0]!, patientId: 999, dentistId: 999, patientFirstName: 'AJENO' };
      body = { ...empty, page: currentPage, size, content: options.empty ? [] : content,
        totalElements: options.empty ? 0 : 107, totalPages: options.empty ? 0 : Math.ceil(107 / size) };
    } else if (path === '/api/appointments/7') body = appointment;
    else if (path.endsWith('/events')) body = [];
    else if (path === '/api/services' || path === '/api/public/services') body = [];
    else if (path === '/api/patients/4') body = { id: 4, userId: 10, firstName: 'Ana', lastName: 'Paciente de prueba', active: true, createdAt: NOW };
    else if (path === '/api/patients/4/clinical') body = { patientId: 4 };
    else if (path.endsWith('/notes') || path.endsWith('/treatments') || path.endsWith('/summary')) body = [];
    else if (path.endsWith('/trace')) body = { context: { appointmentId: 7, occurrenceVersion: 2, currentOccurrenceVersion: 2,
      currentStatus: 'SCHEDULED', kind: 'CURRENT_UNFROZEN', timezone: 'America/Mexico_City' },
      availableSections: ['NOTES', 'EVOLUTIONS'], section: url.searchParams.get('section'), results: empty };
    else if (path === '/api/notifications/unread-count') body = { unread: 1 };
    else if (path === '/api/notifications') body = { ...empty, size: Number(url.searchParams.get('size')), content: options.empty ? [] : [{
      id: 1, title: 'TITULO SENSIBLE', body: 'CUERPO SENSIBLE', read: false, priority: 'NORMAL', createdAt: NOW,
    }], totalElements: options.empty ? 0 : 1, totalPages: options.empty ? 0 : 1 };
    else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ status: 200, json: body });
  });
  return calls;
}

for (const role of ['DENTIST', 'PATIENT'] as const) {
  for (const width of [320, 768, 1280]) {
    test(`9B ${role}: permisos, contenido, teclado y responsive ${width}px (API interceptada)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      // Intentionally different from the clinic's zone and calendar date.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const calls = await fixture(page, role);
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto('/');
      await expect(page.getByRole('heading', { name: role === 'DENTIST' ? 'Mi jornada clínica' : 'Tu atención dental', exact: true })).toBeVisible();
      const next = page.getByRole('region', { name: role === 'DENTIST' ? 'Próxima cita propia' : 'Tu próxima cita' });
      await expect(next.getByText(role === 'PATIENT' ? 'Servicio de prueba autorizado' : 'Servicio de prueba autorizado', { exact: true })).toBeVisible();
      if (role === 'DENTIST') {
        await expect(next.getByText('Paciente de prueba', { exact: false })).toBeVisible();
        await expect(next.locator('time')).toContainText('20:00');
      } else {
        await expect(next.locator('time')).toContainText('31 de octubre de 2026');
        await expect(next.locator('time')).toContainText('20:00 – 21:00');
      }
      await expect(page.getByText('TITULO SENSIBLE', { exact: true })).toBeVisible();
      await expect(page.getByText('CUERPO SENSIBLE', { exact: true })).toBeVisible();
      expect(calls.some(url => /clinical|financial|charges|users|feedback|\/clinic$/.test(url.pathname))).toBe(false);
      const appointmentCalls = calls.filter(url => url.pathname === '/api/appointments');
      expect(appointmentCalls).toHaveLength(role === 'DENTIST' ? 3 : 2);
      if (role === 'DENTIST') {
        expect(appointmentCalls.every(url => url.searchParams.get('dentistId') === '3')).toBe(true);
        const day = page.getByRole('region', { name: 'Mi agenda de hoy' });
        await expect(day.getByText('107', { exact: true })).toBeVisible();
        for (const state of ['Programada', 'Completada', 'Cancelada', 'No asistió']) await expect(day.getByText(state, { exact: true }).first()).toBeVisible();
        await day.getByRole('button', { name: 'Siguiente', exact: true }).click();
        await expect(day.getByText('Paciente 1-0 Paciente de prueba', { exact: true })).toBeVisible();
        expect(calls.find(url => url.searchParams.get('page') === '1')!.searchParams.get('size')).toBe('5');
      } else {
        expect(appointmentCalls.every(url => url.searchParams.has('patientId'))).toBe(false);
        await expect(next.getByText('Odontólogo: Olivia Profesional de prueba')).toBeVisible();
        await expect(next.getByRole('link', { name: 'Abrir expediente' })).toHaveCount(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const main = page.getByRole('main');
      for (const action of await main.getByRole('link').all()) {
        const box = (await action.boundingBox())!; expect(box.height).toBeGreaterThanOrEqual(44);
      }
      const primary = main.getByRole('link', { name: role === 'DENTIST' ? 'Consultar mi agenda' : 'Agendar una cita', exact: true });
      await page.keyboard.press('Tab');
      await primary.focus(); await expect(primary).toBeFocused();
      await expect(primary).toHaveCSS('outline-color', 'rgb(25, 63, 67)');
      const focus = await primary.evaluate(element => { const style = getComputedStyle(element); return { width: parseFloat(style.outlineWidth), style: style.outlineStyle, color: style.outlineColor }; });
      expect(focus.width).toBeGreaterThanOrEqual(2); expect(focus.style).toBe('solid'); expect(focus.color).toBe('rgb(25, 63, 67)');
      const contrast = await page.evaluate(() => {
        const context = document.createElement('canvas').getContext('2d')!;
        const rgba = (color: string) => {
          context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        const luminance = (color: string) => {
          const rgb = rgba(color).slice(0, 3).map(channel => { const c = channel / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
          return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
        };
        return [...document.querySelectorAll('main section h2, main section p, main section time, main section a, main section span.inline-flex, main header a')].map(element => {
          const style = getComputedStyle(element);
          let parent: Element | null = element;
          while (parent && rgba(getComputedStyle(parent).backgroundColor)[3] === 0) parent = parent.parentElement;
          const a = luminance(style.color), b = luminance(parent ? getComputedStyle(parent).backgroundColor : 'white');
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        });
      });
      for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({ path: test.info().outputPath(`care-${role}-${width}.png`), fullPage: true });
      await page.keyboard.press('Enter');
      if (role === 'DENTIST') {
        await expect(page).toHaveURL(/date=2026-10-31&dentistId=3$/);
        await expect(page.getByRole('heading', { name: 'Citas', exact: true })).toBeVisible();
      } else {
        await expect(page).toHaveURL(/\/appointments\?create=1$/);
        await expect(page.getByRole('heading', { name: 'Solicitar cita', exact: true })).toBeVisible();
      }
      await page.goBack(); await expect(next).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}

test('9B DENTIST: cita, expediente contextual y protección de borrador mantienen Back/Forward', async ({ page }) => {
  await fixture(page, 'DENTIST'); await page.goto('/');
  const next = page.getByRole('region', { name: 'Próxima cita propia' });
  await next.getByRole('link', { name: 'Abrir cita', exact: true }).click();
  await expect(page).toHaveURL(/\/appointments\/7$/);
  // The current shared console opens a consultation in place; the historical tab was retired.
  await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  await page.getByLabel('Contenido de la nota').fill('Borrador desde dashboard');
  await page.goBack();
  const confirm = page.getByRole('dialog', { name: 'Tienes cambios sin guardar' });
  await confirm.getByRole('button', { name: 'Seguir aquí' }).click();
  await expect(page.getByLabel('Contenido de la nota')).toHaveValue('Borrador desde dashboard');
  await page.goBack(); await confirm.getByRole('button', { name: 'Salir sin guardar' }).click();
  await expect(next).toBeVisible();
  await next.getByRole('link', { name: 'Abrir expediente', exact: true }).click();
  await expect(page).toHaveURL(/\/patients\/4\?appointmentId=7&occurrenceVersion=2$/);
  await expect(page.getByText('Desde la cita #7')).toBeVisible();
  await page.goBack(); await expect(next).toBeVisible();
  await page.goForward(); await expect(page).toHaveURL(/\/patients\/4\?/);
});

test('9B PATIENT: datos propios, historial y notificaciones por rutas reales, sin clínica interna', async ({ page }) => {
  const calls = await fixture(page, 'PATIENT'); await page.goto('/');
  await page.getByRole('link', { name: 'Consultar mis datos', exact: true }).click();
  await expect(page).toHaveURL(/\/patients\/4$/); await expect(page.getByRole('heading', { name: 'Mis datos', exact: true })).toBeVisible();
  expect(calls.some(url => url.pathname.includes('/clinical') || url.pathname.includes('financial'))).toBe(false);
  await page.goBack();
  await page.getByRole('link', { name: 'Consultar mis citas e historial', exact: true }).click();
  await expect(page).toHaveURL(/\/appointments$/);
  await page.goBack(); await page.getByRole('link', { name: 'Consultar mis notificaciones', exact: true }).click();
  await expect(page).toHaveURL(/\/notifications$/); await expect(page.getByRole('heading', { name: 'Notificaciones', exact: true })).toBeVisible();
});

test('9B PATIENT: vacío útil y error independiente con reintento', async ({ page }) => {
  const calls = await fixture(page, 'PATIENT', { empty: true, fail: '/api/notifications' }); await page.goto('/');
  await expect(page.getByText(/Aún no tienes próximas citas/)).toBeVisible();
  const notifications = page.getByRole('region', { name: 'Notificaciones personales' });
  await expect(notifications.getByRole('alert')).toBeVisible();
  await notifications.getByRole('button', { name: /Reintentar/ }).click();
  await expect.poll(() => calls.filter(url => url.pathname === '/api/notifications').length).toBeGreaterThan(1);
  await page.getByRole('link', { name: 'Reservar un horario' }).click(); await expect(page).toHaveURL(/create=1$/);
});

for (const role of ['DENTIST', 'PATIENT'] as const) {
  test(`9B ${role}: perfil ausente no produce consulta global`, async ({ page }) => {
    const calls = await fixture(page, role, { missing: true }); await page.goto('/');
    await expect(page.getByRole('region', { name: 'Perfil vinculado' }).getByRole('alert')).toBeVisible();
    await expect(page.getByText('TITULO SENSIBLE', { exact: true })).toBeVisible();
    expect(calls.some(url => url.pathname === '/api/appointments')).toBe(false);
  });
  test(`9B ${role}: respuesta de alcance ajeno no expone filas`, async ({ page }) => {
    await fixture(page, role, { wrongScope: true }); await page.goto('/');
    await expect(page.getByRole('region', { name: role === 'DENTIST' ? 'Próxima cita propia' : 'Tu próxima cita' }).getByRole('alert')).toBeVisible();
    await expect(page.getByText(/AJENO/)).toHaveCount(0);
  });
}

test('9B zona inválida mantiene acciones sin fechas inventadas y logout elimina el dashboard', async ({ page }) => {
  const calls = await fixture(page, 'PATIENT', { zone: 'bad/zone' }); await page.goto('/');
  await expect(page.getByText(/No mostraremos fechas con una zona distinta/)).toBeVisible();
  expect(calls.some(url => url.pathname === '/api/appointments')).toBe(false);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('heading', { name: /Tu sonrisa,.*nuestra prioridad/ })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.goBack(); await expect(page.getByRole('heading', { name: 'Tu atención dental' })).toHaveCount(0);
});
