import { expect, test, type Page } from '@playwright/test';
import { dentalAttention, dentalCurrent } from '../src/test/odontogramFixtures';
import { selectDentalPiece } from './dentalInteraction';

// Real SPA/browser; every API request is intercepted. No database or live backend is used.
const a = { id: 7, patientId: 1, patientFirstName: 'Ana', patientLastName: 'Paciente de prueba', dentistId: 3,
  dentistFirstName: 'Olivia', dentistLastName: 'Profesional de prueba', startAt: '2026-10-22T16:00:00Z', endAt: '2026-10-22T17:00:00Z',
  durationMinutes: 60, occurrenceVersion: 1, status: 'SCHEDULED', reason: 'Revisión de prueba', createdAt: '2026-10-21T12:00:00Z', createdByUserId: 2,
  service: { id: 1, name: 'Consulta de valoración', description: 'Servicio sintético', durationMinutes: 60, referencePrice: 500 } };
const empty = { content: [], page: 0, size: 20, totalPages: 0, totalElements: 0 };
const days = Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, open: true, startTime: '08:00:00', endTime: '20:00:00', breaks: [] }));
type Options = { role?: string; status?: string; denied?: number; failRecord?: boolean; failNote?: boolean; failZone?: boolean };

async function fixture(page: Page, options: Options = {}) {
  await page.clock.setFixedTime(new Date('2026-10-22T15:00:00Z'));
  const calls: { path: string; method: string; body: unknown }[] = [];
  const notes: { id: number; content: string; authorName: string; authorDentistId: number; createdAt: string; appointmentContext: unknown }[] = [];
  let recordFailed = options.failRecord;
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    const method = request.method(); calls.push({ path, method, body: request.postDataJSON() });
    const send = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (path === '/api/auth/refresh') return send({ accessToken: 'stage4-mock' });
    if (path === '/api/auth/me') return send({ id: 2, role: options.role ?? 'DENTIST', dentistId: 3, patientId: 1, email: 'actor@stage4.test', active: true, createdAt: a.createdAt });
    if (path === '/api/onboarding/status') return send({ status: 'COMPLETED', clinicConfigured: true });
    if (path === '/api/public/schedule') return options.failZone ? send({ message: 'Zona no disponible' }, 503) : send({ timezone: 'America/Mexico_City', days, exceptions: [], dentists: [{ dentistId: 3, firstName: 'Olivia', lastName: 'Prueba', days }] });
    if (path === '/api/notifications/unread-count') return send({ unread: 0 });
    if (path === '/api/notifications') return send(empty);
    if (path === '/api/schedules/clinic' || path === '/api/schedules/dentists/3') return send({ timezone: 'America/Mexico_City', days });
    if (path.includes('/exceptions') || path.includes('/time-off')) return send([]);
    if (path === '/api/appointments') return send({ ...empty, content: [{ ...a, status: options.status ?? a.status }], totalElements: 1, totalPages: 1 });
    if (path === '/api/appointments/7') return options.denied ? send({ message: 'Cita no disponible' }, options.denied) : send({ ...a, status: options.status ?? a.status });
    if (path === '/api/appointments/7/events') return send([]);
    if (path === '/api/patients/1/clinical') {
      if (recordFailed) { recordFailed = false; return send({ message: 'Fallo temporal' }, 503); }
      return send({ patientId: 1, allergies: 'Penicilina (dato sintético)', medicalBackground: 'Antecedentes de prueba revisados.' });
    }
    if (path.endsWith('/trace')) {
      const linked = url.searchParams.get('section') === 'NOTES' ? notes : [];
      return send({ context: { appointmentId: 7, occurrenceVersion: 1, currentOccurrenceVersion: 1, currentStatus: options.status ?? a.status, kind: 'CURRENT_UNFROZEN', timezone: 'America/Mexico_City' },
        availableSections: ['NOTES', 'EVOLUTIONS'], section: url.searchParams.get('section'), results: { ...empty, content: linked.map(n => ({ recordId: n.id, originalEntry: n, currentEntry: n, corrections: [] })), totalElements: linked.length, totalPages: linked.length ? 1 : 0 } });
    }
    if (path.endsWith('/notes')) {
      if (method === 'POST') {
        if (options.failNote) return send({ message: 'No se confirmó el guardado.' }, 500);
        const body = request.postDataJSON(); const n = { ...body, id: notes.length + 1, authorName: 'Olivia Prueba', authorDentistId: 3, createdAt: a.startAt }; notes.push(n); return send(n);
      }
      return send(notes);
    }
    if (path.endsWith('/treatments')) return send([]);
    if (path.endsWith('/medical-intake/declarations')) return send(empty);
    if (path === '/api/patients/1/odontogram') return send([dentalCurrent({ patientId: 1 })]);
    if (path.includes('/odontogram/at')) return send(dentalAttention());
    if (path.includes('/odontogram/history')) return send(empty);
    // Unknown APIs fail closed, including all checkout/complete/financial writers.
    return send({ message: `API no contemplada en esta etapa: ${path}` }, 404);
  });
  return calls;
}

for (const width of [1440, 390]) test(`agenda → atención → guardado → retorno con filtros (${width}px)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 });
  const calls = await fixture(page);
  const agenda = '/appointments?view=day&date=2026-10-22&status=SCHEDULED';
  await page.goto(agenda);
  await page.getByRole('button', { name: /Abrir cita de Ana/ }).click();
  await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nota de la consulta', exact: true })).toBeVisible();
  await expect(page.locator('.dc-patient-context').getByText(/Penicilina/)).toBeVisible();
  await page.getByLabel('Contenido de la nota', { exact: true }).fill('Observación clínica sintética');
  await expect(page.getByRole('region', { name: 'Tratamientos del paciente' })).toBeVisible();
  await expect(page.getByText('Todavía no hay tratamientos registrados.')).toBeVisible();
  await expect(page.getByLabel('Contenido de la nota')).toHaveValue('Observación clínica sintética');
  await page.getByRole('link', { name: 'Volver a Agenda', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeVisible();
  await page.getByRole('button', { name: 'Seguir aquí', exact: true }).click();
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
  await expect(page.getByRole('heading', { name: 'Ana Paciente de prueba', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/opencode/ux05b1-stage4-${width >= 1024 ? 'desktop' : 'mobile'}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Guardar nota', exact: true }).click();
  await expect(page.getByText(/Nota clínica guardada. Consulta su vínculo/)).toBeVisible();
  await page.getByRole('button', { name: 'Registros de esta atención', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Notas de esta atención', exact: true }).getByText('Observación clínica sintética', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a Agenda', exact: true }).click();
  await expect(page).toHaveURL(agenda);
  expect(calls.filter(c => c.method !== 'GET' && c.path !== '/api/auth/refresh')).toEqual([{ path: '/api/patients/1/clinical/notes', method: 'POST', body: { content: 'Observación clínica sintética', appointmentContext: { appointmentId: 7, occurrenceVersion: 1 } } }]);
  expect(calls.some(c => /checkout|complete|charges|financial-context/.test(c.path))).toBe(false);
});

test('error de guardado conserva el borrador y no reintenta automáticamente', async ({ page }) => {
  const calls = await fixture(page, { failNote: true }); await page.goto('/appointments/7?clinical=1');
  await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  await page.getByLabel('Contenido de la nota').fill('Conservar ante fallo');
  await page.getByRole('button', { name: 'Guardar nota', exact: true }).click();
  await expect(page.getByText('No se confirmó el guardado.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Contenido de la nota')).toHaveValue('Conservar ante fallo');
  await expect(page.getByRole('button', { name: 'Guardar nota', exact: true })).toBeDisabled();
  expect(calls.filter(c => c.method === 'POST' && c.path.endsWith('/notes'))).toHaveLength(1);
});

test('error de antecedentes es recuperable sin bloquear las notas', async ({ page }) => {
  await fixture(page, { failRecord: true }); await page.goto('/appointments/7?clinical=1');
  await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  await expect(page.getByLabel('Contenido de la nota')).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar antecedentes' }).click();
  await expect(page.getByText(/Penicilina/)).toBeVisible();
});

test('fallo de zona permite clínica con UTC explícito, no reprogramación aproximada', async ({ page }) => {
  const calls = await fixture(page, { failZone: true }); await page.goto('/appointments/7?clinical=1');
  await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  await page.getByLabel('Contenido de la nota').fill('Clínica sin horario local verificado');
  await expect(page.getByText(/Los instantes se muestran explícitamente en UTC/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar nota', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Datos de la cita', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reprogramar', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Datos de la cita', exact: true }).click();
  await expect(page.getByLabel('Contenido de la nota')).toHaveValue('Clínica sin horario local verificado');
  expect(calls.some(c => c.method !== 'GET' && c.path !== '/api/auth/refresh')).toBe(false);
});

for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW']) test(`${status}: consulta disponible, sin cierre ni acciones incompatibles`, async ({ page }) => {
  const calls = await fixture(page, { status }); await page.goto('/appointments/7?clinical=1');
  await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  await page.getByLabel('Contenido de la nota').fill('Borrador');
  if (status !== 'COMPLETED') await expect(page.getByRole('button', { name: 'Guardar nota', exact: true })).toBeDisabled();
  else await expect(page.getByRole('button', { name: 'Guardar nota', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Completar|Registrar pago|Reprogramar|Cancelar cita/ })).toHaveCount(0);
  expect(calls.some(c => /checkout|complete|charges/.test(c.path))).toBe(false);
});

for (const denied of [403, 404]) test(`cita ${denied}: no se solicitan datos clínicos`, async ({ page }) => {
  const calls = await fixture(page, { denied }); await page.goto('/appointments/7?clinical=1');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Contenido de la nota')).toHaveCount(0);
  expect(calls.some(c => c.path.includes('/clinical') || c.path.includes('/odontogram'))).toBe(false);
});

test('OWNER reutiliza el espacio clínico sin migrar su detalle administrativo', async ({ page }) => {
  await fixture(page, { role: 'OWNER' }); await page.goto('/appointments/7');
  await page.getByRole('link', { name: 'Abrir atención clínica', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nota de la consulta', exact: true })).toBeVisible();
  await expect(page.getByLabel('Contenido de la nota')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Volver al detalle administrativo' })).toHaveAttribute('href', '/appointments/7');
  await expect(page.getByRole('button', { name: /Completar|Registrar pago/ })).toHaveCount(0);
});

test('odontograma reutilizado y teclado: sin pérdida de nota ni desbordamiento', async ({ page }) => {
  await fixture(page); await page.goto('/appointments/7?clinical=1');
  await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  await page.getByLabel('Contenido de la nota').fill('Borrador entre módulos');
  await page.getByRole('button', { name: 'Explorar odontograma', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Odontograma', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Volver a consulta', exact: true }).click();
  await selectDentalPiece(page, 21);
  await page.getByRole('button', { name: 'Explorar odontograma', exact: true }).click();
  await expect(page.getByLabel('Condición de la pieza')).toBeVisible();
  await page.getByLabel('Observaciones (opcional)', { exact: true }).fill('Borrador dental conservado');
  for (const width of [1440, 1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 960 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1440 || width === 390) await page.screenshot({ path: `/tmp/opencode/ux05d-odontogram-${width}.png`, fullPage: true, animations: 'disabled' });
  }
  await page.getByRole('button', { name: 'Volver a consulta', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Explorar odontograma', exact: true })).toBeFocused();
  await expect(page.getByLabel('Contenido de la nota')).toHaveValue('Borrador entre módulos');
  await page.getByRole('button', { name: 'Explorar odontograma', exact: true }).click();
  await expect(page.getByLabel('Observaciones (opcional)', { exact: true })).toHaveValue('Borrador dental conservado');
});

test('Atrás del navegador y recarga protegen cambios pendientes', async ({ page }) => {
  await fixture(page); await page.goto('/appointments?view=day&date=2026-10-22');
  await page.getByRole('button', { name: /Abrir cita de Ana/ }).click();
  await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  await page.getByLabel('Contenido de la nota').fill('No descartar sin confirmar');
  await page.goBack();
  await page.getByRole('button', { name: 'Seguir aquí', exact: true }).click();
  await expect(page.getByLabel('Contenido de la nota')).toHaveValue('No descartar sin confirmar');
  const dialog = page.waitForEvent('dialog');
  // Dismissed reload has no load event; bound the driver's wait instead of timing out the test.
  const reload = page.reload({ timeout: 2000 }).catch(error => { expect(String(error)).toMatch(/Timeout|ERR_ABORTED|aborted/i); });
  const warning = await dialog; expect(warning.type()).toBe('beforeunload'); await warning.dismiss();
  await reload;
  await expect(page.getByLabel('Contenido de la nota')).toHaveValue('No descartar sin confirmar');
});
