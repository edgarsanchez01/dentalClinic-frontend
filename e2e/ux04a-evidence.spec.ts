import { expect, test, type Page } from '@playwright/test';

const NOW = '2026-10-18T12:00:00Z';
const empty = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
const service = { id: 1, name: 'Consulta de valoración', description: 'Revisión general y orientación para tu atención.', durationMinutes: 30, referencePrice: 850 };
const appointment = { id: 7, patientId: 4, patientUserId: 10, patientFirstName: 'Mariana', patientLastName: 'Paciente sintética', dentistId: 3, dentistFirstName: 'Elena', dentistLastName: 'Profesional sintética', startAt: '2026-10-20T15:00:00Z', endAt: '2026-10-20T15:30:00Z', durationMinutes: 30, service, status: 'SCHEDULED', occurrenceVersion: 1, createdAt: NOW, createdByUserId: 10 };

async function fixture(page: Page, emptyMode = false) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path === '/api/auth/refresh') return route.fulfill({ status: 200, json: { accessToken: 'ux04a' } });
    if (path === '/api/auth/logout') return route.fulfill({ status: 204 });
    let body: unknown;
    if (path === '/api/auth/me') body = { id: 10, patientId: 4, role: 'PATIENT', email: 'mariana@example.test', active: true, createdAt: NOW, medicalOnboarding: { requirement: 'EXEMPT_EXISTING', progress: 'NOT_STARTED', pending: false } };
    else if (path === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (path === '/api/availability/policy') body = { timezone: 'America/Mexico_City', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 };
    else if (path === '/api/public/services') body = [service];
    else if (path === '/api/public/schedule') body = { timezone: 'America/Mexico_City', days: [], exceptions: [], dentists: [{ dentistId: 3, firstName: 'Elena', lastName: 'Profesional sintética', days: [] }] };
    else if (path === '/api/availability') { const day = url.searchParams.get('from'); const duration = 30; body = { dentistId: Number(url.searchParams.get('dentistId')), durationMinutes: duration, timezone: 'America/Mexico_City', slots: [9, 11, 16].map(hour => ({ startDate: day, startTime: `${hour}:00:00`, endTime: `${hour}:30:00`, start: `${day}T${String(hour + 6).padStart(2, '0')}:00:00Z`, end: `${day}T${String(hour + 6).padStart(2, '0')}:30:00Z` })) }; }
    else if (path === '/api/appointments') { const size = Number(url.searchParams.get('size') ?? 20); body = { ...empty, size, content: emptyMode ? [] : [appointment], totalElements: emptyMode ? 0 : 1, totalPages: emptyMode ? 0 : 1 }; }
    else if (path === '/api/notifications/unread-count') body = { unread: 0 };
    else if (path === '/api/notifications') body = { ...empty, size: 5 };
    else return route.fulfill({ status: 404, json: {} });
    await route.fulfill({ json: body });
  });
}

const dir = '/tmp/opencode/ux04/evidence';

test('UX04A inicio y agenda con citas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page);
  await page.goto('/');
  await page.getByRole('heading', { name: 'Tu atención dental' }).waitFor();
  await page.getByRole('heading', { name: 'Mi agenda' }).waitFor();
  await page.screenshot({ path: `${dir}/ux04a-inicio-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 960 });
  await page.screenshot({ path: `${dir}/ux04a-inicio-390.png`, fullPage: true });
  await page.locator('.patient-agenda-section').screenshot({ path: `${dir}/ux04a-agenda-citas.png` });
  await page.setViewportSize({ width: 320, height: 960 });
  await page.screenshot({ path: `${dir}/ux04a-inicio-320.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('UX04A agenda sin citas', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page, true);
  await page.goto('/');
  await page.getByRole('heading', { name: 'Mi agenda' }).waitFor();
  await page.locator('.patient-agenda-section').screenshot({ path: `${dir}/ux04a-agenda-sin-citas.png` });
});

test('UX04A horarios agrupados', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page);
  await page.goto('/appointments?create=1');
  await page.getByRole('radio', { name: /Consulta de valoración/ }).check();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Dentista', { exact: true }).selectOption('3');
  await page.getByLabel('Día', { exact: true }).fill('20/10/2026');
  await page.getByRole('button', { name: '09:00–09:30' }).waitFor();
  await expect(page.getByRole('heading', { name: 'Mañana', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tarde', exact: true })).toBeVisible();
  await page.locator('.patient-time-picker').screenshot({ path: `${dir}/ux04a-horarios-390.png` });
});
