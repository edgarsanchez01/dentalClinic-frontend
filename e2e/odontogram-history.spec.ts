import { expect, test, type Page } from '@playwright/test';
import { dentalAttention, dentalCurrent, dentalEvent, dentalInstant } from '../src/test/odontogramFixtures';

/** All API and actuator requests are fulfilled locally; unknown contracts fail, never continue. */
async function isolate(page: Page, role: 'OWNER' | 'DENTIST' | 'PATIENT' | 'RECEPTIONIST') {
  const calls: Array<{ path: string; method: string; body: unknown; query: Record<string, string> }> = [];
  const unexpected: string[] = [];
  let current = dentalCurrent();
  let version = 1;
  let conflict = true;
  const appointment = () => ({ id: 7, patientId: 42, patientFirstName: 'Paciente', patientLastName: 'Sintético', dentistId: 3,
    dentistFirstName: 'Profesional', dentistLastName: 'Sintético', status: 'SCHEDULED', occurrenceVersion: version,
    startAt: version === 1 ? '2026-10-13T10:00:00Z' : '2026-10-13T11:00:00Z', endAt: '2026-10-13T12:00:00Z',
    durationMinutes: 60, createdByUserId: 10, createdAt: '2026-10-12T10:00:00Z' });
  await page.route((url) => /^\/(api|actuator)\//.test(url.pathname), async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    calls.push({ path, method, body: request.postData() ? request.postDataJSON() : null, query: Object.fromEntries(url.searchParams) });
    let body: unknown, status = 200;
    if (path === '/api/auth/refresh') body = { accessToken: 'E3-intercepted-session' };
    else if (path === '/api/auth/me') body = { id: 10, role, dentistId: role === 'PATIENT' ? undefined : 3,
      patientId: role === 'PATIENT' ? 42 : undefined, email: 'synthetic@dc.test', active: true, createdAt: '2026-01-01T00:00:00Z' };
    else if (path === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (path === '/api/notifications/unread-count') body = { unread: 0 };
    else if (path === '/actuator/health') body = { status: 'UP' };
    else if (path === '/api/public/schedule') body = { timezone: 'UTC', days: [], exceptions: [], dentists: [] };
    else if (path === '/api/patients/42') body = { id: 42, firstName: 'Paciente', lastName: 'Sintético', active: true };
    else if (path === '/api/appointments/7') body = appointment();
    else if (path === '/api/appointments/7/events') body = [];
    else if (path === '/api/charges' && method === 'GET' && role === 'DENTIST') body = { content: [], page: 0, size: 10, totalElements: 0, totalPages: 0 };
    else if (path === '/api/patients/42/clinical') body = { patientId: 42, medicalBackground: null, allergies: null };
    else if (path === '/api/patients/42/clinical/notes') body = [];
    else if (path === '/api/patients/42/clinical/medical-intake/declarations' && method === 'GET' && (role === 'OWNER' || role === 'DENTIST')) body = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
    else if (path === '/api/patients/42/clinical/treatments') body = [{ id: 9, patientId: 42, description: 'Tratamiento sintético', status: 'PLANNED', toothFdis: [21], createdAt: '2026-10-12T10:00:00Z' }];
    else if (path === '/api/patients/42/clinical/appointments/7/trace') body = { context: dentalAttention().reference.occurrence,
      availableSections: ['NOTES', 'EVOLUTIONS'], section: url.searchParams.get('section'),
      results: { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 } };
    else if (path === '/api/patients/42/odontogram') body = role === 'PATIENT' ? [{ toothFdi: 21, dentition: 'PERMANENT', condition: current.condition }] : [current];
    else if (path === '/api/patients/42/odontogram/21/surfaces') body = [];
    else if (path === '/api/patients/42/odontogram/history') body = { content: [dentalEvent()], page: 0, size: 20, totalElements: 1, totalPages: 1 };
    else if (path === '/api/patients/42/odontogram/at') {
      if (url.searchParams.has('at')) body = dentalInstant(url.searchParams.get('at')!);
      else {
        const data = dentalAttention();
        data.reference.occurrence.currentOccurrenceVersion = version;
        data.reference.occurrence.occurrenceVersion = Number(url.searchParams.get('occurrenceVersion'));
        data.currentState.teeth = [current];
        body = data;
      }
    } else if (path === '/api/patients/42/odontogram/21' && method === 'PUT') {
      const input = request.postDataJSON() as { condition: typeof current.condition; notes: string; appointmentContext?: { occurrenceVersion: number } | null };
      if (input.appointmentContext && conflict) { conflict = false; version = 2; status = 409; body = { message: 'La cita cambió mientras escribías.' }; }
      else { current = { ...current, condition: input.condition, notes: input.notes }; body = current; }
    } else {
      unexpected.push(`${method} ${path}`);
      await route.fulfill({ status: 404, json: { message: 'Sin contrato de mock; no se permite passthrough.' } });
      return;
    }
    await route.fulfill({ status, json: body });
  });
  return { calls, unexpected, verified: true };
}

for (const [role, width] of [['DENTIST', 1280], ['OWNER', 320]] as const) {
  test(`E3 ${role} consulta UTC y separa los tres estados (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const isolation = await isolate(page, role);
    expect(isolation.verified).toBe(true); // Registered catch-all before navigation or clinical actions.
    await page.goto('/patients/42');
    const section = page.getByRole('region', { name: 'Odontograma', exact: true });
    await section.getByRole('button', { name: 'Consulta histórica', exact: true }).click();
    // Native datetime-local canonicalizes a zero-second value to YYYY-MM-DDTHH:mm.
    await section.getByLabel('Fecha y hora (UTC)').fill('2026-10-13T11:05');
    await section.getByRole('button', { name: 'Consultar estado histórico' }).click();
    const point = section.getByRole('region', { name: 'Estado histórico por instante' });
    await expect(point.getByRole('button', { name: /Pieza 21.*Caries/ })).toBeVisible();
    await point.getByRole('button', { name: /Pieza 21.*Caries/ }).click();
    await expect(point.getByText('Parcial: el conjunto completo no es reconstruible.')).toBeVisible();
    await expect(point.getByText('Vínculos conocidos: #9.')).toBeVisible();
    await section.getByLabel('Consultar por').selectOption('attention');
    await section.getByLabel('Número de cita').fill('7');
    await section.getByLabel('Ocurrencia dental a consultar').fill('1');
    await section.getByRole('button', { name: 'Consultar estado histórico' }).click();
    await expect(section.getByRole('region', { name: 'Estado en la captura' })).toBeVisible();
    await expect(section.getByRole('region', { name: 'Cambios atribuidos a la atención' })).toBeVisible();
    await expect(section.getByRole('region', { name: 'Estado actual del paciente' })).toBeVisible();
    await expect(section.getByText(/No representa el final de la cita/)).toBeVisible();
    expect(isolation.calls.some((call) => call.query.at === '2026-10-13T11:05:00Z')).toBe(true);
    expect(isolation.unexpected).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`odontogram-${role}-${width}.png`), fullPage: true });
  });
}

test('E3 atención: conserva borrador ante 409, confirma nueva ocurrencia y permite general explícito', async ({ page }) => {
  const isolation = await isolate(page, 'DENTIST');
  expect(isolation.verified).toBe(true);
  await page.goto('/appointments/7');
  await page.getByRole('tab', { name: 'Odontograma', exact: true }).click();
  const section = page.getByRole('region', { name: 'Odontograma', exact: true });
  await expect(section.getByRole('heading', { name: 'Estado del odontograma en esta atención' })).toBeVisible();
  await section.getByRole('button', { name: 'Estado actual', exact: true }).click();
  await section.getByRole('button', { name: /Pieza 21.*Restauración/ }).click();
  const notes = section.getByLabel('Observaciones (opcional)', { exact: true });
  await notes.fill('Borrador sintético conservado');
  await section.getByRole('button', { name: 'Actualizar pieza', exact: true }).click();
  await expect(notes).toHaveValue('Borrador sintético conservado');
  await section.getByRole('button', { name: 'Usar la ocurrencia actual #2' }).click();
  await section.getByRole('button', { name: 'Actualizar pieza', exact: true }).click();
  await expect(section.getByText('Pieza 21 guardada.')).toBeVisible();
  await section.getByLabel('Guardar como registro general, sin cita').check();
  await notes.fill('Registro general sintético');
  await section.getByRole('button', { name: 'Actualizar pieza', exact: true }).click();
  await expect.poll(() => isolation.calls.filter((call) => call.method === 'PUT')).toHaveLength(3);
  const writes = isolation.calls.filter((call) => call.method === 'PUT').map((call) => call.body as { appointmentContext: unknown });
  expect(writes.map((input) => input.appointmentContext)).toEqual([
    { appointmentId: 7, occurrenceVersion: 1 }, { appointmentId: 7, occurrenceVersion: 2 }, null,
  ]);
  expect(isolation.calls.some((call) => call.path.includes('/appointments/6'))).toBe(false);
  expect(isolation.unexpected).toEqual([]);
  const storage = await page.evaluate(() => `${JSON.stringify(localStorage)} ${JSON.stringify(sessionStorage)}`);
  expect(storage).not.toContain('Borrador sintético');
  expect(storage).not.toContain('Registro general sintético');
});

for (const role of ['PATIENT', 'RECEPTIONIST'] as const) {
  test(`E3 ${role} no solicita historia dental restringida`, async ({ page }) => {
    const isolation = await isolate(page, role);
    await page.goto(role === 'PATIENT' ? '/patients/42' : '/appointments/7');
    await expect(page.getByRole('heading', { name: role === 'PATIENT' ? 'Mis datos' : 'Cita #7', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Consulta histórica', exact: true })).toHaveCount(0);
    expect(isolation.calls.some((call) => /\/odontogram\/(history|at)/.test(call.path))).toBe(false);
    if (role === 'RECEPTIONIST') expect(isolation.calls.some((call) => /\/clinical|\/odontogram/.test(call.path))).toBe(false);
    expect(isolation.unexpected).toEqual([]);
  });
}
