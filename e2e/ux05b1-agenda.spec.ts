import { expect, test, type Page } from '@playwright/test';
import { checkoutAppointment as a } from '../src/test/checkoutFixtures';

async function fixture(page: Page, role = 'DENTIST', failZone = false, failList = false) {
  await page.clock.setFixedTime(new Date('2026-10-22T17:00:00Z'));
  const requests: URL[] = [];
  const entries = Array.from({ length: 5 }, (_, i) => ({ ...a, id: 7 + i,
    startAt: `2026-10-22T${16 + i}:00:00Z`, endAt: `2026-10-22T${17 + i}:00:00Z`,
    status: (['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'SCHEDULED'] as const)[i],
  }));
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const url = new URL(route.request().url()); const path = url.pathname; requests.push(url);
    const send = (json: unknown, status = 200) => route.fulfill({ json, status });
    const empty = { content: [], page: 0, size: 100, totalPages: 0, totalElements: 0 };
    if (path === '/api/auth/refresh') return send({ accessToken: 'mock' });
    if (path === '/api/auth/me') return send({ id: 2, role, dentistId: 3, active: true, email: 'synthetic@agenda.test', createdAt: a.createdAt });
    if (path === '/api/onboarding/status') return send({ status: 'COMPLETED', clinicConfigured: true });
    if (path === '/api/public/schedule') {
      if (failZone) { failZone = false; return send({ message: 'Zona no disponible' }, 503); }
      return send({ timezone: 'America/Mexico_City', days: [], exceptions: [], dentists: [{ dentistId: 3, firstName: 'Olivia', lastName: 'Profesional' }] });
    }
    if (path === '/api/appointments') {
      if (failList) return send({ message: 'Agenda temporalmente no disponible' }, 503);
      const content = entries.filter(item => (!url.searchParams.get('status') || item.status === url.searchParams.get('status')) &&
        item.startAt >= url.searchParams.get('from')! && item.startAt < url.searchParams.get('to')!);
      return send({ ...empty, content, totalElements: content.length, totalPages: content.length ? 1 : 0 });
    }
    if (/\/api\/appointments\/\d+$/.test(path)) return send(entries.find(item => item.id === Number(path.split('/').at(-1))));
    if (path === '/api/notifications/unread-count') return send({ unread: 0 });
    if (path.endsWith('/clinical')) return send({ patientId: 1 });
    if (path.includes('/exceptions') || path.includes('/time-off') || path.endsWith('/events') || path.endsWith('/notes') || path === '/api/services') return send([]);
    if (path.includes('/schedules/')) return send({ timezone: 'America/Mexico_City', days: [] });
    return send(empty);
  });
  return Object.assign(requests, { recoverList: () => { failList = false; } });
}
for (const view of ['day', 'week', 'month']) test(`DENTIST ${view}: abrir/volver conserva fecha, vista y filtros`, async ({ page }) => {
  await fixture(page);
  const agenda = `/appointments?view=${view}&date=2026-10-22&status=SCHEDULED&patientId=1&dentistId=3`;
  await page.goto(agenda);
  await page.getByRole('button', { name: /Abrir cita de Ana.*10:00/ }).click();
  await page.getByRole('link', { name: 'Volver a Agenda', exact: true }).click();
  await expect(page).toHaveURL(agenda);
  await expect(page.getByRole('button', { name: /Abrir cita de Ana.*10:00/ })).toHaveCount(1);
});
test('valores implícitos se fijan al abrir para no perder el día original', async ({ page }) => {
  await fixture(page); await page.goto('/appointments');
  await page.getByRole('button', { name: /Abrir cita de Ana.*10:00/ }).click();
  await expect(page.getByRole('link', { name: 'Volver a Agenda' })).toHaveAttribute('href', '/appointments?date=2026-10-22&view=day');
});
for (const view of ['week', 'month']) test(`${view}: navegación de período y múltiples citas → día sin perder filtros`, async ({ page }) => {
  const calls = await fixture(page);
  await page.goto(`/appointments?view=${view}&date=2026-10-22&patientId=1`);
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`date=${view === 'week' ? '2026-10-26' : '2026-11-01'}`));
  await page.getByRole('button', { name: 'Anterior', exact: true }).click();
  await page.getByRole('button', { name: /Ver 2 más/ }).click();
  await expect(page).toHaveURL(/view=day/); await expect(page).toHaveURL(/date=2026-10-22/);
  await expect(page).toHaveURL(/patientId=1/);
  await expect(page.getByRole('region', { name: 'Agenda del día' }).getByRole('button', { name: /Abrir cita de/ })).toHaveCount(5);
  const day = calls.filter(url => url.pathname === '/api/appointments').at(-1)!;
  expect(day.searchParams.get('from')).toBe('2026-10-22T06:00:00.000Z');
  expect(day.searchParams.get('to')).toBe('2026-10-23T06:00:00.000Z');
});
for (const [view, width] of [['week', 1440], ['month', 1440], ['week', 768], ['month', 768], ['month', 320]] as const) test(`${view} ${width}px: teclado, estados y layout`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await fixture(page);
  await page.goto(`/appointments?view=${view}&date=2026-10-22`);
  const dayButton = width === 768 && view === 'month' ? page.getByRole('button', { name: /Ver 5 citas del/ }) : page.getByRole('button', { name: /Abrir cita de Ana.*10:00/ });
  await expect(dayButton).toBeVisible(); await dayButton.focus(); await expect(dayButton).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/opencode/ux05b1-stage6-${view}-${width}.png`, fullPage: true });
  await dayButton.press('Enter');
  if (width === 768 && view === 'month') {
    await expect(page).toHaveURL(/view=day/);
    await page.getByRole('button', { name: /Abrir cita de Ana.*10:00/ }).click();
  }
  await expect(page.getByRole('heading', { name: /Ana/ })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a Agenda' }).click();
  if (width === 320) await expect(page.getByText(/Vista Día en móvil/)).toBeVisible();
  else await expect(page.getByRole('button', { name: width === 768 && view === 'month' ? 'Día' : view === 'week' ? 'Semana' : 'Mes', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
test('zona y agenda fallidas permiten reintento; fecha sin citas no inventa disponibilidad', async ({ page }) => {
  const calls = await fixture(page, 'DENTIST', true, true); await page.goto('/appointments?date=2026-10-22');
  await page.getByRole('button', { name: 'Reintentar zona horaria' }).click();
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
  calls.recoverList(); await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.getByRole('button', { name: /Abrir cita de Ana.*10:00/ })).toBeVisible();
  await page.getByLabel('Fecha', { exact: true }).fill('2026-10-23');
  await expect(page.getByText(/No hay citas para este día/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Reservar \d/ })).toHaveCount(0);
});
for (const role of ['OWNER', 'RECEPTIONIST']) test(`${role}: semana → detalle administrativo → contexto original`, async ({ page }) => {
  await fixture(page, role);
  const agenda = '/appointments?view=week&date=2026-10-22&status=SCHEDULED&patientId=1';
  await page.goto(agenda);
  await page.getByRole('link', { name: /Cita con Ana/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Cita #7', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a Citas' }).click(); await expect(page).toHaveURL(agenda);
});
