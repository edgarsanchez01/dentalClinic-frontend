import { expect, test, type Page } from '@playwright/test';

/**
 * UX-05A — Inicio del DENTIST (identidad Clinical Editorial).
 *
 * Ejercita el SPA real con `/api/**` interceptada (mocks), igual que `care-dashboards.spec.ts`.
 * Genera capturas desktop y móvil de los cuatro estados pedidos: con citas, sin citas, carga y error.
 * Las capturas provienen de mocks: NO acreditan integración con backend real ni aprobación visual humana.
 */

const NOW = '2026-11-01T01:00:00Z';
const empty = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
const appointment = { id: 7, patientId: 4, patientUserId: 10, patientFirstName: 'Ana', patientLastName: 'Paciente de prueba',
  dentistId: 3, dentistFirstName: 'Olivia', dentistLastName: 'Profesional de prueba', startAt: '2026-11-01T02:00:00Z',
  endAt: '2026-11-01T03:00:00Z', durationMinutes: 60, status: 'SCHEDULED', occurrenceVersion: 2,
  createdByUserId: 10, createdAt: NOW, service: { id: 1, name: 'Servicio de prueba autorizado', description: 'Descripción', durationMinutes: 60, referencePrice: 100 } };
const days = [1, 2, 3, 4, 5, 6, 7].map(dayOfWeek => ({ dayOfWeek, open: true, startTime: '08:00:00', endTime: '22:00:00', breaks: [] }));

interface Options { empty?: boolean; fail?: string; loading?: string; zone?: string }
async function fixture(page: Page, options: Options = {}) {
  await page.clock.setFixedTime(new Date(NOW));
  const calls: URL[] = [];
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const url = new URL(route.request().url()), path = url.pathname; calls.push(url);
    if (path === options.loading) { await new Promise(() => {}); return; }
    if (path === options.fail) { await route.fulfill({ status: 503, json: {} }); return; }
    if (path === '/api/auth/refresh') { await route.fulfill({ status: 200, json: { accessToken: 'ux05a-browser-mock' } }); return; }
    let body: unknown;
    if (path === '/api/auth/me') body = { id: 10, role: 'DENTIST', dentistId: 3, email: 'actor@ux05a.test', active: true, createdAt: NOW };
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
      body = { ...empty, page: currentPage, size, content: options.empty ? [] : content,
        totalElements: options.empty ? 0 : 107, totalPages: options.empty ? 0 : Math.ceil(107 / size) };
    } else if (path === '/api/notifications/unread-count') body = { unread: 1 };
    else if (path === '/api/notifications') body = { ...empty, size: Number(url.searchParams.get('size')), content: options.empty ? [] : [{
      id: 1, title: 'Recordatorio de cita', body: 'Tienes una cita programada próximamente.', read: false, priority: 'NORMAL', createdAt: NOW,
    }], totalElements: options.empty ? 0 : 1, totalPages: options.empty ? 0 : 1 };
    else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ status: 200, json: body });
  });
  return calls;
}

for (const width of [1280, 390]) {
  const label = width >= 1024 ? 'desktop' : 'mobile';
  test(`UX-05A DENTIST ${label} con citas: destacado, agenda y notificaciones con identidad editorial`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page); await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Mi jornada clínica', exact: true })).toBeVisible();
    const root = page.locator('.dentist-shell'); await expect(root).toHaveCount(1);
    const next = page.getByRole('region', { name: 'Próxima cita propia' });
    await expect(next.getByText('Ana Paciente de prueba')).toBeVisible();
    await expect(next.locator('time').first()).toContainText('20:00');
    await expect(next.getByRole('link', { name: 'Abrir expediente' })).toBeVisible();
    const day = page.getByRole('region', { name: 'Mi agenda de hoy' });
    await expect(day.getByText('107', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Tus notificaciones' }).getByText('Recordatorio de cita')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const primary = page.getByRole('main').getByRole('link', { name: 'Consultar mi agenda', exact: true });
    const box = (await primary.boundingBox())!; expect(box.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: test.info().outputPath(`ux05a-dentist-${label}-con-citas.png`), fullPage: true });
  });

  test(`UX-05A DENTIST ${label} sin citas: vacío útil sin confundir cero con disponibilidad`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, { empty: true }); await page.goto('/');
    await expect(page.getByText('No tienes próximas citas programadas. Las citas cuya hora ya pasó siguen en tu agenda del día.')).toBeVisible();
    await expect(page.getByText('No tienes citas para hoy')).toBeVisible();
    await expect(page.getByText('No tienes notificaciones todavía.')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`ux05a-dentist-${label}-sin-citas.png`), fullPage: true });
  });

  test(`UX-05A DENTIST ${label} carga: esqueleto por bloque sin spinner genérico`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, { loading: '/api/appointments' }); await page.goto('/');
    await expect(page.getByRole('status', { name: 'Cargando próximas citas' })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Cargando agenda de hoy' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`ux05a-dentist-${label}-carga.png`), fullPage: true });
  });

  test(`UX-05A DENTIST ${label} error: alerta accionable con reintento por bloque`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, { fail: '/api/appointments' }); await page.goto('/');
    const next = page.getByRole('region', { name: 'Próxima cita propia' });
    await expect(next.getByRole('alert')).toBeVisible();
    await expect(next.getByRole('button', { name: /Reintentar/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Tus notificaciones' }).getByText('Recordatorio de cita')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`ux05a-dentist-${label}-error.png`), fullPage: true });
  });
}

test('UX-05A DENTIST: mantiene el h1 y el CTA exigidos por la navegación', async ({ page }) => {
  await fixture(page); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Mi jornada clínica', exact: true })).toBeVisible();
  const agenda = page.getByRole('main').getByRole('link', { name: 'Consultar mi agenda', exact: true });
  await expect(agenda).toHaveAttribute('href', '/appointments?view=day&date=2026-10-31&dentistId=3');
});

test('UX-05A DENTIST: zona inválida suspende consultas temporales sin inventar fechas', async ({ page }) => {
  const calls = await fixture(page, { zone: 'bad/zone' }); await page.goto('/');
  await expect(page.getByText(/No mostraremos fechas con una zona distinta/)).toBeVisible();
  expect(calls.some(url => url.pathname === '/api/appointments')).toBe(false);
});
