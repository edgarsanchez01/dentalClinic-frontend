import { expect, test, type Page } from '@playwright/test';
import { intakeDeclaration, intakeDefinition, intakeDraft } from '../src/test/intakeFixtures';
import type { IntakeDraft } from '../src/api/medicalIntake';

const NOW = '2026-10-17T10:00:00Z';
const empty = { content: [], totalPages: 0, totalElements: 0, page: 0, size: 10 };
const days = Array.from({ length: 7 }, (_, index) => ({ dayOfWeek: index + 1, open: true, startTime: '09:00:00', endTime: '17:00:00', breaks: [] }));
type Options = { role?: 'OWNER' | 'DENTIST' | 'RECEPTIONIST' | 'PATIENT'; anonymous?: boolean; complete?: boolean; exempt?: boolean; conflict?: boolean; timeout?: boolean; minor?: boolean; meError?: boolean; expired?: boolean };
/** Entire API is intercepted; proxy points at port 9. No backend, SQL or external service. */
async function fixture(page: Page, options: Options = {}) {
  await page.clock.setFixedTime(new Date(NOW));
  let draft: IntakeDraft = intakeDraft(options.complete);
  if (options.minor) draft.personal.birthDate = '2015-03-10';
  if (options.exempt) draft.status = { requirement: 'EXEMPT_EXISTING', progress: 'NOT_STARTED', pending: false, version: 0 };
  let authenticated = !options.anonymous, conflict = options.conflict, timeout = options.timeout, meError = options.meError;
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const user = () => ({ id: 9, patientId: 5, dentistId: 7, email: 'patient@intake.test', role: options.role ?? 'PATIENT', active: true, createdAt: NOW,
    ...(options.role && options.role !== 'PATIENT' ? {} : { medicalOnboarding: draft.status }) });
  const declarations: ReturnType<typeof intakeDeclaration>[] = [];
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method(), body = request.postData() ? request.postDataJSON() as Record<string, unknown> : {};
    calls.push({ path, method, body });
    const ok = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (path === '/api/auth/refresh') return ok({ accessToken: 'intake-browser-mock' }, authenticated ? 200 : 401);
    if (path === '/api/auth/register') { authenticated = true; return ok({ user: user(), accessToken: 'intake-browser-mock' }, 201); }
    if (path === '/api/auth/login') { authenticated = true; return ok({ user: user(), accessToken: 'intake-browser-mock' }); }
    if (path === '/api/auth/logout') { authenticated = false; return route.fulfill({ status: 204 }); }
    if (path === '/api/auth/me') { if (meError) return ok({}, 503); return ok(user()); }
    if (path.endsWith('/medical-intake/definition')) return ok(intakeDefinition);
    if (path.endsWith('/medical-intake/status')) return ok(draft.status);
    if (path.endsWith('/medical-intake/draft')) return ok(draft);
    if (path.endsWith('/declarations/latest')) return declarations[0] ? ok(declarations[0]) : route.fulfill({ status: 204 });
    if (path.endsWith('/medical-intake/declarations')) {
      expect(options.role).not.toBe('RECEPTIONIST'); return ok({ number: 0, size: 10, content: declarations, totalPages: declarations.length ? 1 : 0, totalElements: declarations.length });
    }
    if (path.includes('/medical-intake/') && (method === 'PUT' || path.endsWith('/privacy-acknowledgements'))) {
      if (options.expired) { authenticated = false; return ok({}, 401); }
      if (conflict) { conflict = false; draft = { ...draft, status: { ...draft.status, version: 8 }, personal: { ...draft.personal, firstName: 'Otra pestaña' } }; return ok({ code: 'INTAKE_VERSION_CONFLICT' }, 409); }
      expect(body.expectedVersion).toBe(draft.status.version);
      draft = { ...draft, status: { ...draft.status, version: draft.status.version + 1, progress: draft.status.progress === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS' } };
      if (path.endsWith('/personal')) draft.personal = body.personal as IntakeDraft['personal'];
      if (path.endsWith('/medical')) { expect(draft.privacy?.processingAccepted).toBe(true); draft.medical = body.medical as NonNullable<IntakeDraft['medical']>; }
      if (path.endsWith('/dental')) { expect(draft.privacy?.processingAccepted).toBe(true); draft.dental = body.dental as NonNullable<IntakeDraft['dental']>; }
      if (path.endsWith('/privacy-acknowledgements')) draft.privacy = { id: 1, noticeVersion: intakeDefinition.noticeVersion, noticeText: intakeDefinition.noticeText, noticeHash: intakeDefinition.noticeHash, acknowledged: true, processingAccepted: true, actorUserId: 9, acceptedAt: NOW };
      return ok(draft);
    }
    if (path.endsWith('/complete') || path.endsWith('/revisions')) {
      const prior = calls.slice(0, -1).find(call => call.path === path && call.body.operationId === body.operationId);
      if (!prior) { draft = { ...draft, status: { ...draft.status, pending: false, progress: 'COMPLETED', version: draft.status.version + 1 } }; declarations.unshift(intakeDeclaration(draft, declarations.length + 1)); }
      if (timeout) { timeout = false; return route.abort('failed'); }
      return ok({ version: Number(body.expectedVersion) + 1, medicalOnboarding: draft.status, declaration: declarations[0] });
    }
    if (path === '/api/onboarding/status') return ok({ status: 'COMPLETED', clinicConfigured: true });
    if (path === '/api/public/schedule' || path === '/api/schedules/clinic') return ok({ timezone: 'UTC', days, exceptions: [], dentists: [{ dentistId: 7, firstName: 'Profesional', lastName: 'Sintético', days }] });
    if (path === '/api/availability/policy') return ok({ timezone: 'UTC', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 });
    if (path === '/api/public/services' || path === '/api/services') return ok([]);
    if (path === '/api/appointments') return ok({ ...empty, size: Number(url.searchParams.get('size') ?? 10) });
    if (path === '/api/notifications' || path === '/api/users' || path === '/api/patients') return ok(empty);
    if (path.endsWith('/unread-count')) return ok({ unread: 0 });
    if (path === '/api/clinic') return ok({ timezone: 'UTC' });
    if (path === '/api/patients/5') return ok({ id: 5, userId: 9, ...draft.personal, active: true, createdAt: NOW });
    if (path.endsWith('/clinical')) return ok({ patientId: 5 });
    if (path.endsWith('/notes') || path.endsWith('/treatments') || path.includes('/odontogram')) return ok([]);
    return ok({}, 404);
  });
  return { calls, draft: () => draft, allowMe: () => { meError = false; } };
}
async function next(page: Page) { await page.getByRole('button', { name: 'Siguiente', exact: true }).click(); }
async function continueAfterSuccess(page: Page) {
  await expect(page.getByRole('heading', { name: 'Tu información está lista' })).toBeVisible();
  await page.getByRole('button', { name: /^(Continuar a la reserva|Ir a mi inicio|Ver mi información|Continuar)$/ }).click();
}
async function privacy(page: Page) {
  await expect(page.getByRole('heading', { name: 'Antes de guardar antecedentes' })).toBeVisible();
  const button = page.getByRole('button', { name: 'Registrar aceptación y continuar' }); await expect(button).toBeDisabled();
  await page.getByLabel('He leído el aviso de privacidad mostrado.').focus(); await page.keyboard.press('Space'); await expect(button).toBeDisabled();
  await page.getByLabel('Acepto el guardado y uso de mis respuestas según este aviso demostrativo.').focus(); await page.keyboard.press('Space');
  await button.focus(); await page.keyboard.press('Enter');
}
async function answer(page: Page, label: string) {
  for (const radio of await page.getByRole('radio', { name: label, exact: true }).all()) await radio.check();
}
async function finishSteps(page: Page, options: { privacyNeeded?: boolean; screenshot?: number } = {}) {
  await next(page);
  if (options.privacyNeeded !== false) await privacy(page);
  await expect(page.getByRole('group', { name: 'Alergias y reacciones' })).toBeVisible();
  if (options.privacyNeeded !== false) {
    await next(page); await expect(page.getByText('Revisa los campos indicados antes de continuar.')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Alergias y reacciones' }).getByRole('radio', { name: 'Sí', exact: true })).toBeFocused();
  }
  await answer(page, 'No');
  await page.getByRole('group', { name: 'Alergias y reacciones' }).getByRole('radio', { name: 'Sí', exact: true }).check();
  await page.getByLabel('Detalles de alergias y reacciones (opcional)').fill('Respuesta sintética de prueba');
  if (options.screenshot) await page.screenshot({ path: test.info().outputPath(`intake-medical-${options.screenshot}.png`), fullPage: true });
  await next(page); await expect(page.getByRole('group', { name: 'Condiciones médicas relevantes' })).toBeVisible();
  await answer(page, 'No'); await next(page); await expect(page.getByRole('group', { name: 'Reacciones a anestesia' })).toBeVisible();
  await answer(page, 'No'); await next(page); await expect(page.getByRole('group', { name: 'Tratamientos anteriores' })).toBeVisible();
  await answer(page, 'Prefiero hablarlo en consulta'); await next(page); await expect(page.getByLabel('Motivo de consulta')).toBeVisible();
  await answer(page, 'Prefiero hablarlo en consulta'); await page.getByLabel('Motivo de consulta').fill('Consulta sintética de prueba'); await next(page);
  await expect(page.getByRole('heading', { name: 'Revisión y confirmación' })).toBeFocused();
  if (options.screenshot) await page.screenshot({ path: test.info().outputPath(`intake-review-${options.screenshot}.png`), fullPage: true });
  await page.getByLabel('Confirmo la declaración mostrada y he revisado mis respuestas.').check();
}

for (const width of [320, 768, 1280]) test(`9D.3 cuatro pasos accesibles, menor y responsive ${width}px (API simulada)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const api = await fixture(page, { minor: true }); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/appointments?create=1'); await expect(page).toHaveURL(/patient-onboarding.*returnTo=/);
  await expect(page.getByRole('heading', { name: 'Tu atención dental' })).toHaveCount(0);
  await page.getByLabel('Nombre del adulto responsable').fill('Adulto sintético');
  await page.getByLabel('Parentesco del responsable').selectOption('LEGAL_GUARDIAN'); await page.getByLabel('Teléfono del responsable').fill('5550123');
  const nextButton = page.getByRole('button', { name: 'Siguiente', exact: true }); await nextButton.focus();
  expect(await nextButton.evaluate(element => getComputedStyle(element).outlineStyle === 'none' && getComputedStyle(element).boxShadow === 'none')).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const contrasts = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    const lum = (color: string) => { ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); const c = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }); return c[0]! * .2126 + c[1]! * .7152 + c[2]! * .0722; };
    return [...document.querySelectorAll('main p, main label, main legend, main button:not(:disabled)')].map(el => {
      let bg: Element | null = el; while (bg && getComputedStyle(bg).backgroundColor === 'rgba(0, 0, 0, 0)') bg = bg.parentElement;
      const a = lum(getComputedStyle(el).color), b = lum(bg ? getComputedStyle(bg).backgroundColor : 'white'); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
  });
  for (const ratio of contrasts) expect(ratio).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: test.info().outputPath(`intake-personal-${width}.png`), fullPage: true });
  await finishSteps(page, { screenshot: width });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const action of await page.getByRole('button').all()) { const box = await action.boundingBox(); if (box) expect(box.height).toBeGreaterThanOrEqual(44); }
  await page.getByRole('button', { name: 'Confirmar y continuar' }).click(); await continueAfterSuccess(page); await expect(page).toHaveURL(/\/appointments\?create=1$/);
  expect(api.calls.find(call => call.path.endsWith('/complete'))?.body.confirmedBy).toBe('RESPONSIBLE_ADULT');
  const storage = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(JSON.stringify(storage)).not.toMatch(/Respuesta sintética|Consulta sintética|Adulto sintético/); expect(errors).toEqual([]);
});

test('9D.6A landing → registro con sesión automática → onboarding → reserva, sin login manual', async ({ page }) => {
  const api = await fixture(page, { anonymous: true }); await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: 'Reservar cita' }).click();
  await page.getByRole('link', { name: 'Regístrate como paciente' }).click();
  await expect(page.getByRole('heading', { name: 'Crear cuenta de paciente' })).toBeVisible();
  await page.getByLabel('Correo electrónico').fill('patient@intake.test'); await page.getByLabel('Contraseña', { exact: true }).fill('Synthetic-Password-2026');
  await page.getByLabel('Repite la contraseña', { exact: true }).fill('Synthetic-Password-2026'); await page.getByLabel('Nombre', { exact: true }).fill('Paciente'); await page.getByLabel('Apellidos').fill('Sintético');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await expect(page).toHaveURL(/patient-onboarding.*returnTo=/); await page.reload();
  await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Paciente'); await finishSteps(page);
  await page.getByRole('button', { name: 'Confirmar y continuar' }).click();
  await continueAfterSuccess(page);
  await expect(page.getByRole('heading', { name: 'Tu atención dental', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link', { name: 'Reservar un horario', exact: true }).click();
  await expect(page).toHaveURL(/\/appointments\?create=1$/);
  expect(api.calls.find(call => call.path === '/api/auth/register')?.body).not.toHaveProperty('role');
  expect(api.calls.filter(call => call.path === '/api/auth/register')).toHaveLength(1);
  expect(api.calls.filter(call => call.path === '/api/auth/login')).toHaveLength(0);
});

test('9D.6A /me no disponible tras registro permite recuperar sesión sin crear otra cuenta', async ({ page }) => {
  const api = await fixture(page, { anonymous: true, meError: true });
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Crear cuenta de paciente' })).toBeVisible();
  await page.getByLabel('Correo electrónico').fill('patient@intake.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('Synthetic-Password-2026');
  await page.getByLabel('Repite la contraseña', { exact: true }).fill('Synthetic-Password-2026');
  await page.getByLabel('Nombre', { exact: true }).fill('Paciente'); await page.getByLabel('Apellidos').fill('Sintético');
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reintentar sesión' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear cuenta', exact: true })).toHaveCount(0);
  api.allowMe(); await page.getByRole('button', { name: 'Reintentar sesión' }).click();
  await expect(page).toHaveURL(/patient-onboarding/);
  await expect(page.getByLabel('Nombre', { exact: true })).toBeVisible();
  expect(api.calls.filter(call => call.path === '/api/auth/register')).toHaveLength(1);
  expect(api.calls.filter(call => call.path === '/api/auth/login')).toHaveLength(0);
});

test('9D.3 protección de cambios, guardar/salir y reanudar desde servidor', async ({ page }) => {
  await fixture(page); await page.goto('/patient-onboarding'); await page.getByLabel('Nombre', { exact: true }).fill('Cambio sintético');
  await page.getByRole('link', { name: 'Consultar o cancelar mis citas' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tienes cambios sin guardar' }); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Seguir aquí' })).toBeFocused(); await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Guardar y salir' }).click(); await expect(page).toHaveURL(/\/appointments$/);
  await page.goto('/'); await expect(page).toHaveURL(/patient-onboarding/); await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Cambio sintético');
});

test('9D.3 conflicto entre pestañas no hace PUT automático y permite comparar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const api = await fixture(page, { conflict: true }); await page.goto('/patient-onboarding');
  await page.getByLabel('Nombre', { exact: true }).fill('Local sintético'); await next(page);
  const region = page.getByRole('region', { name: 'Resolver conflicto' }); await expect(region).toBeVisible();
  expect(api.calls.filter(call => call.method === 'PUT')).toHaveLength(1);
  await region.getByText('Ver versión del servidor', { exact: true }).click(); await expect(region.getByText('Otra pestaña', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/opencode/ux02/evidence/conflict-390.png', fullPage: true });
  await page.getByRole('button', { name: 'Conservar mis cambios para revisión manual' }).click();
  expect(api.calls.filter(call => call.method === 'PUT')).toHaveLength(1); await next(page); await expect(page.getByText('Antes de guardar antecedentes')).toBeVisible();
  expect(api.calls.filter(call => call.method === 'PUT').at(-1)?.body.expectedVersion).toBe(8);
});

test('9D.3 confirmación incierta y revisión append-only, mismo UUID/payload en replay', async ({ page }) => {
  const api = await fixture(page, { timeout: true }); await page.goto('/patient-onboarding'); await finishSteps(page);
  await page.getByRole('button', { name: 'Confirmar y continuar' }).click();
  await expect(page.getByText('No se pudo confirmar el resultado. Comprueba la conexión y vuelve a intentarlo.')).toBeVisible();
  await page.getByRole('button', { name: 'Reintentar la misma confirmación' }).click(); await continueAfterSuccess(page); await expect(page.getByRole('heading', { name: 'Tu atención dental', exact: true })).toBeVisible();
  const confirmations = api.calls.filter(call => call.path.endsWith('/complete')); expect(confirmations).toHaveLength(2); expect(confirmations[1]?.body).toEqual(confirmations[0]?.body);
  await page.goto('/patient-profile'); await expect(page.getByRole('heading', { name: 'Última declaración' })).toBeVisible();
  await page.getByRole('link', { name: 'Actualizar datos y antecedentes' }).click(); await finishSteps(page, { privacyNeeded: false });
  await page.getByRole('button', { name: 'Confirmar nueva revisión' }).click(); await continueAfterSuccess(page); await expect(page).toHaveURL(/\/patient-profile$/);
  expect(api.calls.filter(call => call.path.endsWith('/revisions'))).toHaveLength(1);
  await expect(page.getByRole('heading', { name: 'Última declaración' }).locator('..').getByText('Declaración confirmada · Revisión 2', { exact: true })).toBeVisible();
  await expect(page.getByText('Revisión 1 · Confirmada', { exact: false })).toBeVisible();
});

for (const role of ['OWNER', 'DENTIST', 'RECEPTIONIST'] as const) test(`9D.3 ${role} sin bloqueo ni acceso médico de recepción`, async ({ page }) => {
  const api = await fixture(page, { role }); await page.goto('/appointments?create=1'); await expect(page.getByRole('heading', { name: 'Nueva cita' })).toBeVisible();
  await page.goto('/patient-onboarding'); await expect(page).not.toHaveURL(/patient-onboarding/);
  expect(api.calls.some(call => call.path.includes('/medical-intake'))).toBe(false);
  // UX-04E.1: la ficha de RECEPTIONIST muestra el nombre en orden natural
  // («Nombre Apellidos»). OWNER/DENTIST conservan «Apellidos, Nombre».
  if (role === 'RECEPTIONIST') { await page.goto('/patients/5'); await expect(page.getByRole('heading', { name: 'Paciente Sintético' })).toBeVisible(); expect(api.calls.some(call => call.path.includes('/medical-intake'))).toBe(false); }
});

test('9D.3 histórico exento y completado no repiten onboarding', async ({ page }) => {
  const api = await fixture(page, { exempt: true }); await page.goto('/'); await expect(page.getByRole('heading', { name: 'Tu atención dental', exact: true })).toBeVisible();
  await page.goto('/appointments?create=1'); await expect(page.getByRole('heading', { name: 'Solicitar cita' })).toBeVisible(); expect(api.calls.some(call => call.path.includes('/medical-intake'))).toBe(false);
});

test('9D.3 fallo de restauración ofrece reintento sin asumir cuestionario completado', async ({ page }) => {
  const api = await fixture(page, { meError: true }); await page.goto('/appointments?create=1');
  await expect(page.getByRole('button', { name: 'Reintentar sesión' })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Nueva cita' })).toHaveCount(0);
  api.allowMe(); await page.getByRole('button', { name: 'Reintentar sesión' }).click(); await expect(page).toHaveURL(/patient-onboarding/);
});

test('9D.3 sesión expirada retira el formulario y conserva retorno seguro a reserva', async ({ page }) => {
  await fixture(page, { expired: true }); await page.goto('/patient-onboarding?returnTo=%2Fappointments%3Fcreate%3D1');
  await page.getByLabel('Nombre', { exact: true }).fill('Cambio sintético'); await next(page);
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.getByLabel('Nombre', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => history.state.usr.from)).toBe('/appointments?create=1');
});
