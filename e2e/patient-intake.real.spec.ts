import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { IntakeConfirmation, IntakeDeclaration, IntakeDraft } from '../src/api/medicalIntake';

// No route.fulfill, mocked API, real patient data, or persistent database access.
const fixturePath = process.env.DENTALCLINIC_INTAKE_FIXTURE;
const container = process.env.DENTALCLINIC_INTAKE_PG_CONTAINER;
const enabled = process.env.DENTALCLINIC_INTAKE_REAL === '1';
test.skip(!enabled, 'Requires the opt-in isolated 9D.6A environment.');
if (enabled && (!fixturePath || !container?.startsWith('dc-9d6a-'))) {
  throw new Error('Run only with the explicit isolated 9D.6A configuration.');
}
const f = (enabled ? JSON.parse(readFileSync(fixturePath!, 'utf8')) : {}) as {
  api: string; web: string; database: string; password: string; ownerEmail: string;
  dentistEmail: string; receptionEmail: string; exemptEmail: string;
  dentistId: number; serviceId: number; date: string;
};
if (enabled) {
  if (f.database !== 'dentalclinic_9d6a' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(f.api) || f.web !== 'http://127.0.0.1:15196') throw new Error('Unsafe test target');
  const inspected = JSON.parse(execFileSync('docker', ['inspect', container!], { encoding: 'utf8' }))[0];
  if (inspected.Config.Labels['dentalclinic.phase'] !== '9d6a-test' || inspected.Mounts.some((m: { Type: string }) => m.Type !== 'tmpfs')
      || inspected.NetworkSettings.Ports['5432/tcp'].some((p: { HostPort: string }) => p.HostPort === '5434')) throw new Error('Isolation not verified');
}
const BASE = '/api/patients/me/medical-intake';
const runId = Date.now();
const MARKER = `Antecedente-sintetico-${runId}`;
const REASON = `Consulta-ficticia-${runId}`;
const adultEmail = `adult-${runId}@9d5b.test`;
let adultToken = '', adultId = 0;

function sql(query: string): string {
  return execFileSync('docker', ['exec', '-i', container!, 'psql', '-X', '-qAt', '-U', 'verify_9d6a', '-d', 'dentalclinic_9d6a', '-v', 'ON_ERROR_STOP=1'], {
    input: `BEGIN READ ONLY; ${query}; COMMIT;`, encoding: 'utf8',
  }).trim();
}
async function api(request: APIRequestContext, method: string, path: string, token: string, data?: unknown, status = 200) {
  const response = await request.fetch(f.api + path, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Idempotency-Key': randomUUID() },
    ...(data === undefined ? {} : { data }),
  });
  expect(response.status(), `${method} ${path}`).toBe(status);
  return response;
}
async function loginApi(request: APIRequestContext, email: string) {
  const response = await api(request, 'POST', '/api/auth/login', '', { email, password: f.password });
  return (await response.json() as { accessToken: string }).accessToken;
}
async function loginUI(page: Page, email: string) {
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(f.password);
  const pending = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  return (await response.json() as { accessToken: string }).accessToken;
}
async function registerUI(page: Page, email: string) {
  const loginRequests: string[] = [];
  const watch = (request: import('@playwright/test').Request) => { if (request.url().endsWith('/api/auth/login')) loginRequests.push(request.url()); };
  page.on('request', watch);
  await page.goto('/');
  await page.getByRole('link', { name: 'Crear cuenta de paciente', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Crear cuenta de paciente' })).toBeVisible();
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(f.password);
  await page.getByLabel('Repite la contraseña', { exact: true }).fill(f.password);
  await page.getByLabel('Nombre', { exact: true }).fill('Paciente');
  await page.getByLabel('Apellidos').fill('Sintetico');
  await expect(page.getByLabel('Correo electrónico')).toHaveValue(email);
  const registration = page.waitForResponse(r => r.url().endsWith('/api/auth/register') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  const response = await registration;
  expect(response.status()).toBe(201);
  expect(response.headers()['cache-control']).toBe('no-store');
  const payload = await response.json();
  expect(payload.refreshToken).toBeUndefined();
  const token = payload.accessToken as string;
  await expect(page).toHaveURL(/patient-onboarding/);
  await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Paciente');
  expect(loginRequests).toEqual([]);
  page.off('request', watch);
  const cookie = (await page.context().cookies()).find(c => c.name === 'dentalclinic_refresh')!;
  expect(cookie.httpOnly).toBe(true); expect(cookie.path).toBe('/api/auth'); expect(cookie.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('dentalclinic_refresh');
  return token;
}
async function personal(page: Page, minor = false) {
  await page.getByLabel('Fecha de nacimiento').fill(minor ? '10/03/2015' : '10/03/1995');
  await page.getByLabel('No puedo proporcionar teléfono', { exact: true }).check();
  await page.getByLabel('Nombre del contacto de emergencia').fill('Contacto ficticio');
  await page.getByLabel('Relación con el contacto de emergencia').fill('Amistad');
  await page.getByLabel('Teléfono del contacto de emergencia').fill('5550102');
  if (minor) {
    await page.getByLabel('Nombre del adulto responsable').fill('Responsable ficticio');
    await page.getByLabel('Parentesco del responsable').selectOption('LEGAL_GUARDIAN');
    await page.getByLabel('Teléfono del responsable').fill('5550103');
  }
}
async function next(page: Page) { await page.getByRole('button', { name: 'Siguiente', exact: true }).click(); }
async function continueAfterSuccess(page: Page) {
  await expect(page.getByRole('heading', { name: 'Tu información está lista' })).toBeVisible();
  await page.getByRole('button', { name: /^(Continuar a la reserva|Ir a mi inicio|Ver mi información|Continuar)$/ }).click();
}
async function acceptPrivacy(page: Page) {
  const button = page.getByRole('button', { name: 'Registrar aceptación y continuar' });
  await expect(page.getByRole('heading', { name: 'Antes de guardar antecedentes' })).toBeVisible();
  await expect(button).toBeDisabled();
  await page.getByLabel('He leído el aviso de privacidad mostrado.').check();
  await expect(button).toBeDisabled();
  await page.getByLabel('Acepto el guardado y uso de mis respuestas según este aviso demostrativo.').check();
  await button.click();
  await expect(page.getByRole('group', { name: 'Alergias y reacciones' })).toBeVisible();
}
async function medical(page: Page) {
  await expect(page.getByRole('group', { name: 'Alergias y reacciones' })).toBeVisible();
  for (const radio of await page.getByRole('radio', { name: 'No', exact: true }).all()) await radio.check();
  await page.getByRole('group', { name: 'Alergias y reacciones' }).getByRole('radio', { name: 'Sí', exact: true }).check();
  await page.getByLabel('Detalles de alergias y reacciones (opcional)').fill(MARKER);
  await page.getByRole('group', { name: 'Medicamentos actuales' }).getByRole('radio', { name: 'No lo sé', exact: true }).check();
  await next(page); await expect(page.getByRole('group', { name: 'Condiciones médicas relevantes' })).toBeVisible();
  for (const radio of await page.getByRole('radio', { name: 'No', exact: true }).all()) await radio.check();
  await page.getByRole('group', { name: 'Condiciones médicas relevantes' }).getByRole('radio', { name: 'Prefiero hablarlo en consulta', exact: true }).check();
  await next(page); await expect(page.getByRole('group', { name: 'Reacciones a anestesia' })).toBeVisible();
  for (const radio of await page.getByRole('radio', { name: 'No', exact: true }).all()) await radio.check();
}
async function dental(page: Page) {
  await expect(page.getByRole('group', { name: 'Tratamientos anteriores' })).toBeVisible();
  for (const radio of await page.getByRole('radio', { name: 'Prefiero hablarlo en consulta', exact: true }).all()) await radio.check();
  await next(page);
  await expect(page.getByLabel('Motivo de consulta')).toBeVisible();
  for (const radio of await page.getByRole('radio', { name: 'Prefiero hablarlo en consulta', exact: true }).all()) await radio.check();
  await page.getByLabel('Motivo de consulta').fill(REASON);
}
async function noBrowserPersistence(page: Page) {
  const values = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const records: unknown[] = [];
    for (const entry of databases) {
      if (!entry.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(entry.name!); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        for (const name of db.objectStoreNames) records.push(await new Promise<unknown>((resolve, reject) => {
          const request = db.transaction(name, 'readonly').objectStore(name).getAll();
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        }));
      } finally { db.close(); }
    }
    return { local: { ...localStorage }, session: { ...sessionStorage }, indexed: records, url: location.href, history: history.state };
  });
  const serialized = JSON.stringify(values);
  expect(serialized.includes(MARKER)).toBe(false);
  expect(serialized.includes(REASON)).toBe(false);
  expect(serialized).not.toMatch(/medicalConditions|anesthesiaReactions|responsibleAdultName/);
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ request }) => {
  expect(sql('SELECT current_database()')).toBe('dentalclinic_9d6a');
  expect((await api(request, 'GET', '/actuator/health', '')).status()).toBe(200);
});
test.beforeEach(async ({ page }) => {
  page.on('request', request => {
    const url = decodeURIComponent(request.url());
    expect(url.includes(MARKER)).toBe(false);
    expect(url.includes(REASON)).toBe(false);
  });
});

test('adulto: landing, registro, privacidad, borrador, sesión, confirmación/replay, reserva y revisión reales', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  adultToken = await registerUI(page, adultEmail);
  const initialCookie = (await page.context().cookies()).find(c => c.name === 'dentalclinic_refresh')!.value;
  await page.reload(); await expect(page).toHaveURL(/patient-onboarding/);
  await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Paciente');
  expect((await page.context().cookies()).find(c => c.name === 'dentalclinic_refresh')!.value).not.toBe(initialCookie);
  const me = await (await api(page.request, 'GET', '/api/auth/me', adultToken)).json(); adultId = me.patientId;
  expect(me.medicalOnboarding).toEqual({ requirement: 'REQUIRED', progress: 'NOT_STARTED', pending: true });
  const effects = () => sql("SELECT json_build_object('appointments',(SELECT count(*) FROM appointment),'events',(SELECT count(*) FROM appointment_event),'communications',(SELECT count(*) FROM communication),'notifications',(SELECT count(*) FROM notification),'idempotency',(SELECT count(*) FROM http_idempotency))");
  const before = effects();
  const blocked = await api(page.request, 'POST', '/api/appointments', adultToken, {
    patientId: adultId, dentistId: f.dentistId, serviceId: f.serviceId, startAt: `${f.date}T10:00:00Z`, endAt: `${f.date}T10:30:00Z`,
  }, 409);
  expect((await blocked.json()).code).toBe('MEDICAL_ONBOARDING_REQUIRED'); expect(effects()).toBe(before);
  const privacyDenied = await api(page.request, 'PUT', BASE + '/draft/medical', adultToken, { expectedVersion: 0, medical: { allergies: { answer: 'YES', details: MARKER } } }, 409);
  expect((await privacyDenied.json()).code).toBe('INTAKE_PRIVACY_REQUIRED');
  expect(sql(`SELECT count(*) FROM patient_intake_draft WHERE patient_id=${adultId}`)).toBe('0');
  await next(page); await expect(page.getByText('Revisa los campos indicados antes de continuar.')).toBeVisible();
  await personal(page); await next(page); await acceptPrivacy(page);
  await next(page); await expect(page.getByText('Revisa los campos indicados antes de continuar.')).toBeVisible();
  await medical(page); await page.getByRole('button', { name: 'Guardar y salir' }).click();
  await expect(page).toHaveURL(/\/appointments$/);
  let refreshes = 0; page.on('response', r => { if (r.url().endsWith('/api/auth/refresh') && r.status() === 200) refreshes++; });
  await page.reload(); await expect(page.getByRole('heading', { name: 'Mis citas', exact: true })).toBeVisible();
  expect(refreshes).toBeGreaterThan(0);
  const logout = page.waitForResponse(r => r.url().endsWith('/api/auth/logout'));
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  expect((await logout).status()).toBe(204);
  await expect(page.getByRole('heading', { name: /Tu sonrisa,.*nuestra prioridad/ })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect((await page.context().cookies()).find(c => c.name === 'dentalclinic_refresh')).toBeUndefined();
  await page.getByRole('banner').getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
  adultToken = await loginUI(page, adultEmail);
  await expect(page).toHaveURL(/patient-onboarding/);
  await page.goto('/appointments?create=1'); await expect(page).toHaveURL(/patient-onboarding/);
  await page.goto('/patient-onboarding');
  await expect(page.getByLabel('Fecha de nacimiento')).toHaveValue('10/03/1995');
  await next(page); await expect(page.getByLabel('Detalles de alergias y reacciones (opcional)')).toHaveValue(MARKER);
  await noBrowserPersistence(page); await next(page); await next(page); await next(page); await dental(page); await next(page);
  await expect(page.getByRole('heading', { name: 'Revisión y confirmación' })).toBeVisible();
  let command: IntakeConfirmation | undefined;
  page.on('request', r => { if (r.url().endsWith(BASE + '/complete') && r.method() === 'POST') command = r.postDataJSON() as IntakeConfirmation; });
  const confirmed = page.waitForResponse(r => r.url().endsWith(BASE + '/complete') && r.status() === 200);
  await page.getByLabel('Confirmo la declaración mostrada y he revisado mis respuestas.').check();
  await page.getByRole('button', { name: 'Confirmar y continuar' }).click();
  const first = await (await confirmed).json();
  await continueAfterSuccess(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Tu atención dental', exact: true })).toBeVisible();
  expect(first.medicalOnboarding.progress).toBe('COMPLETED');
  const replay = await api(page.request, 'POST', BASE + '/complete', adultToken, command);
  expect(await replay.json()).toEqual(first);
  const mismatch = await api(page.request, 'POST', BASE + '/complete', adultToken, { ...command, confirmedBy: 'RESPONSIBLE_ADULT' }, 409);
  expect((await mismatch.json()).code).toBe('INTAKE_IDEMPOTENCY_CONFLICT');
  expect(sql(`SELECT count(*) FROM patient_intake_declaration WHERE patient_id=${adultId}`)).toBe('1');
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Tu atención dental', exact: true })).toBeVisible();
  await page.goto('/appointments?create=1');
  const servicesResponse = await page.request.get(f.api + '/api/public/services');
  expect(servicesResponse.ok()).toBe(true);
  const services = await servicesResponse.json() as Array<{ id: number; name: string }>;
  const service = services.find(item => item.id === f.serviceId);
  expect(service).toBeDefined();
  await page.getByRole('radio', { name: service!.name, exact: true }).check();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('combobox', { name: 'Dentista', exact: true }).selectOption(String(f.dentistId));
  await page.getByLabel('Día', { exact: true }).fill(`${f.date.slice(8, 10)}/${f.date.slice(5, 7)}/${f.date.slice(0, 4)}`);
  await page.getByRole('group', { name: 'Huecos disponibles' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  const booking = page.waitForResponse(r => r.url().endsWith('/api/appointments') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Confirmar solicitud' }).click(); expect((await booking).status()).toBe(201);
  expect(sql(`SELECT count(*) FROM appointment WHERE patient_id=${adultId}`)).toBe('1');
  await page.goto('/patient-profile'); await expect(page.getByRole('heading', { name: 'Última declaración' })).toBeVisible();
  await page.getByRole('link', { name: 'Actualizar datos y antecedentes' }).click();
  await next(page); await page.getByRole('group', { name: 'Alergias y reacciones' }).getByRole('radio', { name: 'No', exact: true }).check();
  for (let i = 0; i < 5; i++) await next(page);
  await page.getByLabel('Confirmo la declaración mostrada y he revisado mis respuestas.').check();
  await page.getByRole('button', { name: 'Confirmar nueva revisión' }).click(); await continueAfterSuccess(page); await expect(page).toHaveURL(/\/patient-profile$/);
  const history = await (await api(page.request, 'GET', BASE + '/declarations', adultToken)).json() as { content: IntakeDeclaration[] };
  expect(history.content.map(d => d.revision)).toEqual([2, 1]); expect(history.content[1]).toEqual(first.declaration);
  expect(history.content[0]!.medical.allergies!.answer).toBe('NO');
  await noBrowserPersistence(page); expect(errors).toEqual([]);
});

test('menor: responsable obligatorio y confirmación por adulto, cuatro respuestas y ficha propias', async ({ page }) => {
  const token = await registerUI(page, `minor-${runId}@9d5b.test`);
  await personal(page, true);
  await page.getByLabel('Nombre del adulto responsable').fill(''); await next(page);
  await expect(page.getByText('Revisa los campos indicados antes de continuar.')).toBeVisible();
  await page.getByLabel('Nombre del adulto responsable').fill('Responsable ficticio');
  await next(page); await acceptPrivacy(page); await medical(page); await next(page); await dental(page); await next(page);
  const draft = await (await api(page.request, 'GET', BASE + '/draft', token)).json() as IntakeDraft;
  const bad = await api(page.request, 'POST', BASE + '/complete', token, {
    expectedVersion: draft.status.version, operationId: randomUUID(), questionnaireVersion: 'dental-intake-demo-v1',
    declarationVersion: 'intake-declaration-demo-v1', declarationConfirmed: true, confirmedBy: 'PATIENT',
  }, 400); expect((await bad.json()).code).toBe('INTAKE_VALIDATION_FAILED');
  const result = page.waitForResponse(r => r.url().endsWith(BASE + '/complete') && r.status() === 200);
  await page.getByLabel('Confirmo la declaración mostrada y he revisado mis respuestas.').check();
  await page.getByRole('button', { name: 'Confirmar y continuar' }).click();
  const declaration = (await (await result).json()).declaration as IntakeDeclaration;
  expect(declaration.confirmedBy).toBe('RESPONSIBLE_ADULT');
  expect(declaration.personal.responsibleAdultName).toBe('Responsable ficticio');
  expect(declaration.medical.medications!.answer).toBe('UNKNOWN');
  expect(declaration.medical.medicalConditions!.answer).toBe('DISCUSS_IN_CONSULTATION');
  expect(declaration.medical.surgeriesOrHospitalizations!.answer).toBe('NO');
  expect(declaration.medical.allergies!.answer).toBe('YES');
  await page.goto('/patient-profile'); await expect(page.getByRole('heading', { name: 'Última declaración' })).toBeVisible();
  await noBrowserPersistence(page);
});

test('409 real entre editores: comparación y resolución explícita sin sobrescritura automática', async ({ page }) => {
  const token = await registerUI(page, `conflict-${runId}@9d5b.test`); await personal(page);
  await api(page.request, 'PUT', BASE + '/draft/personal', token, { expectedVersion: 0, personal: {
    firstName: 'Servidor ficticio', lastName: 'Sintetico', birthDate: '1995-03-10', canProvidePhone: false,
    emergencyContactName: 'Contacto ficticio', emergencyContactRelationship: 'Amistad', emergencyContactPhone: '5550102',
  } });
  await page.getByLabel('Nombre', { exact: true }).fill('Local ficticio'); await next(page);
  const region = page.getByRole('region', { name: 'Resolver conflicto' }); await expect(region).toBeVisible();
  await region.getByText('Ver versión del servidor', { exact: true }).click(); await expect(region.getByText('Servidor ficticio', { exact: true })).toBeVisible();
  let writes = 0; page.on('request', r => { if (r.method() === 'PUT' && r.url().includes(BASE)) writes++; });
  await page.getByRole('button', { name: 'Conservar mis cambios para revisión manual' }).click(); expect(writes).toBe(0);
  expect((await (await api(page.request, 'GET', BASE + '/draft', token)).json()).personal.firstName).toBe('Servidor ficticio');
  await next(page); await expect(page.getByRole('heading', { name: 'Antes de guardar antecedentes' })).toBeVisible();
  const current = await (await api(page.request, 'GET', BASE + '/draft', token)).json();
  expect(current.personal.firstName).toBe('Local ficticio'); expect(current.status.version).toBe(2);
  await noBrowserPersistence(page);
});

test('permisos reales: OWNER/DENTIST leen; RECEPTIONIST/PATIENT no acceden a declaración ajena ni editan notas', async ({ page }) => {
  const owner = await loginApi(page.request, f.ownerEmail), dentist = await loginApi(page.request, f.dentistEmail);
  const reception = await loginApi(page.request, f.receptionEmail), other = await loginApi(page.request, f.exemptEmail);
  const path = `/api/patients/${adultId}/clinical/medical-intake/declarations`;
  for (const token of [owner, dentist]) {
    const response = await api(page.request, 'GET', path, token); expect(response.headers()['cache-control']).toBe('no-store');
    expect((await response.json()).totalElements).toBe(2);
    await api(page.request, 'POST', path, token, {}, 403);
  }
  for (const token of [reception, adultToken, other]) await api(page.request, 'GET', path, token, undefined, 403);
  for (const token of [owner, dentist, reception]) await api(page.request, 'GET', BASE + '/draft', token, undefined, 403);
  for (const token of [adultToken, other]) {
    await api(page.request, 'PUT', `/api/patients/${adultId}/clinical`, token, { medicalBackground: 'Nunca autorizado' }, 403);
    await api(page.request, 'POST', `/api/patients/${adultId}/clinical/notes`, token, { text: 'Nunca autorizado' }, 403);
  }
  const administrative = await (await api(page.request, 'GET', `/api/patients/${adultId}`, reception)).text();
  expect(administrative).not.toMatch(/medicalOnboarding|responsibleAdult|medicalBackground/); expect(administrative.includes(MARKER)).toBe(false);
  const receptionMedicalRequests: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/') && path.includes('/medical-intake')) receptionMedicalRequests.push(path);
  });
  await page.context().clearCookies();
  await page.goto('/login'); await loginUI(page, f.receptionEmail); await page.goto(`/patients/${adultId}`);
  await expect(page.getByRole('heading', { name: 'Sintetico, Paciente' })).toBeVisible();
  await expect(page.getByText(MARKER, { exact: true })).toHaveCount(0);
  await page.goto('/patient-onboarding'); await expect(page).not.toHaveURL(/patient-onboarding/);
  expect(receptionMedicalRequests).toEqual([]);
});

test('histórico ficticio EXEMPT_EXISTING, latest 204 y rutas/sesión protegidas', async ({ page }) => {
  await page.goto('/patient-profile'); await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  const token = await loginUI(page, f.exemptEmail);
  const me = await (await api(page.request, 'GET', '/api/auth/me', token)).json();
  expect(me.medicalOnboarding).toEqual({ requirement: 'EXEMPT_EXISTING', progress: 'NOT_STARTED', pending: false });
  await api(page.request, 'GET', BASE + '/declarations/latest', token, undefined, 204);
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Tu atención dental', exact: true })).toBeVisible();
  await page.goto('/appointments?create=1'); await expect(page.getByRole('heading', { name: 'Solicitar cita', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/appointments');
  await page.context().clearCookies(); await page.reload(); await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await noBrowserPersistence(page);
});
