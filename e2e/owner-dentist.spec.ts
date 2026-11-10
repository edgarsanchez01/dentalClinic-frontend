import { expect, test, type Page } from '@playwright/test';

// SPA/browser coverage with intercepted APIs, not a backend-integrated E2E.
const NOW = '2026-10-26T07:00:00Z';
const days = Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, open: true, startTime: '09:00:00', endTime: '17:00:00', breaks: [] }));
const service = { id: 1, name: 'Consulta de prueba', durationMinutes: 60, referencePrice: 100, active: true };
const visit = { id: 20, patientId: 4, patientUserId: 10, patientFirstName: 'Paciente', patientLastName: 'Propio', dentistId: 7,
  dentistFirstName: 'Ana', dentistLastName: 'Propietaria', startAt: '2026-10-26T09:00:00Z', endAt: '2026-10-26T10:00:00Z',
  durationMinutes: 60, status: 'SCHEDULED', occurrenceVersion: 1, createdByUserId: 1, createdAt: NOW, service };
const empty = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
async function fixture(page: Page, patient = false, missing = false) {
  await page.clock.setFixedTime(new Date(NOW));
  const calls: { url: URL; method: string; body: Record<string, unknown> | null }[] = [];
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const input = request.postData() ? request.postDataJSON() : null;
    calls.push({ url, method, body: input });
    let body: unknown;
    if (path === '/api/auth/refresh') body = { accessToken: 'owner-dentist-browser-fixture' };
    else if (path === '/api/auth/me') body = { id: patient ? 10 : 1, email: 'synthetic@example.test', role: patient ? 'PATIENT' : 'OWNER', active: true,
      createdAt: NOW, ...(patient ? { patientId: 4, medicalOnboarding: { requirement: 'EXEMPT_EXISTING', progress: 'NOT_STARTED', pending: false } } : missing ? {} : { dentistId: 7 }) };
    else if (path === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (path === '/api/notifications/unread-count') body = { unread: 0 };
    else if (path === '/api/notifications') body = empty;
    else if (path === '/api/clinic') body = { name: 'Clínica de prueba', timezone: 'UTC' };
    else if (path === '/api/availability/policy') body = { timezone: 'UTC', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 };
    else if (path === '/api/public/schedule') body = { timezone: 'UTC', days, exceptions: [], dentists: [
      { dentistId: 8, firstName: 'Otro', lastName: 'Profesional', days }, { dentistId: 7, firstName: 'Ana', lastName: 'Propietaria', days },
    ] };
    else if (path === '/api/schedules/clinic') body = { timezone: 'UTC', days };
    else if (/\/schedules\/dentist\/\d+$/.test(path)) body = { dentistId: Number(path.split('/').at(-1)), timezone: 'UTC', days };
    else if (path.endsWith('/exceptions') || path.endsWith('/time-off') || path === '/api/users' || path.endsWith('/events') || path.endsWith('/notes') || path.endsWith('/treatments') || path.endsWith('/odontogram')) body = [];
    else if (path.endsWith('/clinical')) body = { patientId: 4, allergies: 'Sin alergias registradas' };
    else if (path.endsWith('/odontogram/at')) body = { teeth: [], context: null };
    else if (path === '/api/services' || path === '/api/public/services') body = [service];
    else if (path === '/api/availability') body = { dentistId: Number(url.searchParams.get('dentistId')), durationMinutes: 60, timezone: 'UTC', slots: [
      { startDate: '2026-10-26', startTime: '11:00:00', endTime: '12:00:00', start: '2026-10-26T11:00:00Z', end: '2026-10-26T12:00:00Z' },
    ] };
    else if (path === '/api/appointments' && method === 'POST') { await route.fulfill({ status: 201, json: { ...visit, ...input } }); return; }
    else if (path === '/api/appointments') {
      const personal = url.searchParams.get('dentistId') === '7';
      const content = personal ? [visit] : [visit, { ...visit, id: 21, dentistId: 8, patientFirstName: 'Paciente', patientLastName: 'Del equipo' }];
      body = { ...empty, size: Number(url.searchParams.get('size') ?? 20), content: content.slice(0, Number(url.searchParams.get('size') ?? 20)), totalElements: content.length, totalPages: Math.ceil(content.length / Number(url.searchParams.get('size') ?? 20)) };
    } else if (path === '/api/appointments/20') body = visit;
    else if (path === '/api/feedback') body = { ...empty, count: 0, average: null };
    else if (path === '/api/financial/reports/portfolio') body = { pendingBalance: '0.00', statusCounts: { pendiente: 0, parcial: 0, pagado: 0, anulado: 0 } };
    else if (path === '/api/financial/reports/cash-flow') body = { grossAmount: '0.00', netAmount: '0.00', reversalAmount: '0.00' };
    else if (path.includes('/medical-intake/declarations/latest')) { await route.fulfill({ status: 204 }); return; }
    else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ json: body });
  });
  return calls;
}

async function capture(page: Page, name: string) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}
for (const width of [1440, 390]) {
  test(`OWNER Inicio y Citas personal/general ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 }); const calls = await fixture(page);
    await page.goto('/'); await expect(page.getByRole('heading', { name: 'Resumen de la clínica' })).toBeVisible();
    const scope = page.getByRole('navigation', { name: 'Ámbito de trabajo' });
    await scope.getByRole('link', { name: 'Mi actividad clínica' }).click();
    await expect(page.getByRole('heading', { name: 'Mi jornada clínica' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Próxima cita propia' }).getByText('Paciente Propio')).toBeVisible();
    await capture(page, `owner-personal-home-${width}`);
    await page.getByRole('main').getByRole('link', { name: 'Consultar mi agenda', exact: true }).click();
    await expect(page.getByRole('button', { name: /Abrir cita de Paciente Propio/ })).toBeVisible();
    await expect(page.getByText('Paciente Del equipo', { exact: true })).toHaveCount(0);
    await capture(page, `owner-personal-agenda-${width}`);
    await page.getByRole('button', { name: /Abrir cita de Paciente Propio/ }).click();
    await expect(page.getByRole('button', { name: 'Finalizar atención' })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('clinical')).toBe('1');
    await page.getByRole('link', { name: 'Volver a Agenda' }).click();
    await expect(scope.getByRole('link', { name: 'Mi actividad clínica' })).toHaveAttribute('aria-current', 'page');
    await scope.getByRole('link', { name: 'Clínica', exact: true }).click();
    await expect(page.getByLabel('Filtrar por dentista')).toBeEnabled();
    expect(calls.some(c => c.url.pathname === '/api/appointments' && !c.url.searchParams.has('dentistId'))).toBe(true);
  });

  test(`OWNER Mi horario reutiliza gestión y conserva ámbito al enfocar editor ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 }); const calls = await fixture(page);
    await page.goto('/scheduling?scope=mine');
    await expect(page.getByRole('button', { name: 'Editar horario' })).toBeEnabled();
    await page.getByRole('link', { name: 'Gestionar mi horario' }).click();
    expect(new URL(page.url()).searchParams.get('scope')).toBe('mine');
    await page.getByRole('tab', { name: 'Ausencias', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Nueva ausencia' })).toBeVisible();
    await capture(page, `owner-personal-schedule-${width}`);
    expect(calls.filter(c => /\/schedules\/dentist\//.test(c.url.pathname)).every(c => c.url.pathname.startsWith('/api/schedules/dentist/7'))).toBe(true);
    await page.getByRole('navigation', { name: 'Ámbito de trabajo' }).getByRole('link', { name: 'Clínica y equipo' }).click();
    await expect(page.getByRole('heading', { name: 'Horario de dentistas' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Política de reservas' })).toBeVisible();
  });
}

test('PATIENT selecciona al OWNER existente y reserva únicamente un intervalo recibido', async ({ page }) => {
  const calls = await fixture(page, true); await page.goto('/appointments?create=1');
  await page.getByRole('radio', { name: /Consulta de prueba/ }).check();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Dentista', { exact: true }).selectOption('7');
  await page.getByRole('button', { name: '11:00–12:00', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar solicitud' }).click();
  await expect(page.getByRole('heading', { name: 'Tu cita está reservada' })).toBeVisible();
  expect(calls.find(c => c.url.pathname === '/api/appointments' && c.method === 'POST')?.body).toMatchObject({ dentistId: 7, patientId: 4, serviceId: 1, startAt: '2026-10-26T11:00:00Z', endAt: '2026-10-26T12:00:00Z' });
  await expect(page.getByRole('navigation', { name: 'Ámbito de trabajo' })).toHaveCount(0);
});

test('OWNER sin perfil personal no consulta la agenda global', async ({ page }) => {
  const calls = await fixture(page, false, true); await page.goto('/appointments?scope=mine&dentistId=8');
  await expect(page.getByRole('alert')).toContainText('Tu cuenta no tiene un perfil profesional vinculado');
  expect(calls.some(c => c.url.pathname === '/api/appointments')).toBe(false);
});
