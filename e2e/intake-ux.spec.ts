import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IntakeDefinition, IntakeDraft } from '../src/api/medicalIntake';
import { intakeDefinition, intakeDraft, intakeDeclaration } from '../src/test/intakeFixtures';

/** Backend simulado en memoria del test, nunca storage del navegador. */
async function fixture(page: Page, definition: IntakeDefinition = intakeDefinition) {
  let draft = intakeDraft();
  let authenticated = true;
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  await page.clock.setFixedTime(new Date('2026-10-18T12:00:00Z'));
  const user = () => ({ id: 9, email: 'ux02@example.test', role: 'PATIENT', active: true, patientId: 5, createdAt: '2026-10-18', medicalOnboarding: draft.status });
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : {};
    calls.push({ path, method, body });
    const ok = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (path === '/api/auth/refresh') return ok({ accessToken: 'ux02-synthetic' }, authenticated ? 200 : 401);
    if (path === '/api/auth/login') { authenticated = true; return ok({ accessToken: 'ux02-synthetic', user: user() }); }
    if (path === '/api/auth/logout') { authenticated = false; return route.fulfill({ status: 204 }); }
    if (path === '/api/auth/me') return ok(user());
    if (path === '/api/public/schedule') return ok({ timezone: 'America/Mexico_City', days: [], exceptions: [], dentists: [] });
    if (path.endsWith('/definition')) return ok(definition);
    if (path.endsWith('/status')) return ok(draft.status);
    if (path.endsWith('/draft')) return ok(draft);
    if (method === 'PUT' || path.endsWith('/privacy-acknowledgements')) {
      expect(body.expectedVersion).toBe(draft.status.version);
      if (path.endsWith('/medical') || path.endsWith('/dental')) expect(draft.privacy?.processingAccepted).toBe(true);
      draft = { ...draft, status: { ...draft.status, version: draft.status.version + 1, progress: 'IN_PROGRESS' } };
      if (path.endsWith('/personal')) draft.personal = body.personal as IntakeDraft['personal'];
      if (path.endsWith('/medical')) draft.medical = body.medical as IntakeDraft['medical'];
      if (path.endsWith('/dental')) draft.dental = body.dental as IntakeDraft['dental'];
      if (path.endsWith('/privacy-acknowledgements')) draft.privacy = { id: 1, noticeVersion: definition.noticeVersion, noticeText: definition.noticeText, noticeHash: definition.noticeHash, acknowledged: true, processingAccepted: true, actorUserId: 9, acceptedAt: '2026-10-18T12:00:00Z' };
      return ok(draft);
    }
    if (path.endsWith('/complete')) {
      draft = { ...draft, status: { ...draft.status, progress: 'COMPLETED', pending: false, version: draft.status.version + 1 } };
      return ok({ version: draft.status.version, medicalOnboarding: draft.status, declaration: intakeDeclaration(draft) });
    }
    return ok({}, 404);
  });
  return { calls, draft: () => draft };
}
async function next(page: Page) { await page.getByRole('button', { name: 'Siguiente', exact: true }).click(); }
async function accept(page: Page) {
  await page.getByLabel('He leído el aviso de privacidad mostrado.').check();
  await page.getByLabel('Acepto el guardado y uso de mis respuestas según este aviso demostrativo.').check();
  await page.getByRole('button', { name: 'Registrar aceptación y continuar' }).click();
  await expect(page.getByRole('group', { name: 'Alergias y reacciones' })).toBeVisible();
}
async function all(page: Page, answer: string) { for (const radio of await page.getByRole('radio', { name: answer, exact: true }).all()) await radio.check(); }

for (const width of [320, 390, 768, 1280, 1440]) test(`UX-02 cuatro etapas y lectura guiada ${width}px`, async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/patient-onboarding?returnTo=%2Fappointments%3Fcreate%3D1');
  await expect(page.getByLabel('Nombre', { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const evidence = async (name: string) => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `/tmp/opencode/ux02/evidence/${name}-${width}.png`, fullPage: true });
  };
  await evidence('personal');
  await next(page); await expect(page.getByRole('heading', { name: 'Antes de guardar antecedentes' })).toBeVisible();
  await evidence('privacy'); await accept(page);
  await expect(page.getByText('Grupo 1 de 3', { exact: true })).toBeVisible();
  expect(await page.getByRole('radio', { checked: true }).count()).toBe(0);
  expect(await page.getByRole('radio').count()).toBe(8);
  await page.getByRole('group', { name: 'Alergias y reacciones' }).getByRole('radio', { name: 'Sí', exact: true }).check();
  await page.getByLabel('Detalles de alergias y reacciones (opcional)').fill('Información sintética para revisión');
  await page.getByRole('group', { name: 'Medicamentos actuales' }).getByRole('radio', { name: 'No lo sé', exact: true }).check();
  await evidence('medical');
  await next(page); await expect(page.getByRole('group', { name: 'Condiciones médicas relevantes' })).toBeVisible();
  await all(page, 'No'); await next(page); await expect(page.getByRole('group', { name: 'Reacciones a anestesia' })).toBeVisible();
  await all(page, 'Prefiero hablarlo en consulta'); await next(page);
  await expect(page.getByRole('group', { name: 'Tratamientos anteriores' })).toBeVisible();
  await all(page, 'No'); await next(page); await expect(page.getByLabel('Motivo de consulta')).toBeVisible();
  await all(page, 'Prefiero hablarlo en consulta'); await page.getByLabel('Motivo de consulta').fill('Revisión sintética de prueba');
  await evidence('dental'); await next(page);
  await expect(page.getByRole('heading', { name: 'Revisión y confirmación' })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Resumen de antecedentes médicos' })).toContainText('No lo sé');
  await expect(page.getByRole('region', { name: 'Resumen de antecedentes dentales' })).toContainText('Prefiero hablarlo en consulta');
  await evidence('review');
  await expect(page.locator('main')).not.toContainText('America/Mexico_City');
  for (const control of await page.locator('main button:visible').all()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Editar datos personales', exact: true }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Editado sintético');
  await page.getByRole('button', { name: 'Volver a la revisión' }).click();
  await expect(page.getByRole('region', { name: 'Resumen de datos personales' })).toContainText('Editado sintético');
  await page.getByLabel('Confirmo la declaración mostrada y he revisado mis respuestas.').check();
  await page.getByRole('button', { name: 'Confirmar y continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Tu información está lista' })).toBeVisible();
  await evidence('success');
  await expect(page.getByRole('button', { name: 'Continuar a la reserva' })).toBeVisible();
});

test('UX-02 guardado acumulado entre grupos, atrás, recarga y reanudación de sesión', async ({ page }) => {
  const api = await fixture(page); await page.goto('/patient-onboarding'); await next(page);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await page.getByText('Leer el aviso de privacidad completo', { exact: true }).click();
  await expect(page.getByText(intakeDefinition.noticeText, { exact: true })).toBeVisible();
  expect(api.calls.some(call => /\/draft\/(medical|dental)$/.test(call.path) && call.method === 'PUT')).toBe(false);
  await accept(page); await all(page, 'No lo sé'); await next(page);
  await expect(page.getByRole('group', { name: 'Condiciones médicas relevantes' })).toBeVisible();
  await all(page, 'Prefiero hablarlo en consulta');
  await page.getByRole('button', { name: 'Anterior', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Alergias y reacciones' }).getByRole('radio', { name: 'No lo sé', exact: true })).toBeChecked();
  expect(Object.keys(api.draft().medical!)).toHaveLength(4);
  await page.reload(); await next(page);
  await expect(page.getByRole('group', { name: 'Medicamentos actuales' }).getByRole('radio', { name: 'No lo sé', exact: true })).toBeChecked();
  await next(page); await expect(page.getByRole('group', { name: 'Condiciones médicas relevantes' }).getByRole('radio', { name: 'Prefiero hablarlo en consulta', exact: true })).toBeChecked();
  const medicalCalls = api.calls.filter(call => call.path.endsWith('/draft/medical') && call.method === 'PUT');
  expect(medicalCalls[0]!.body.medical).toHaveProperty('allergies.answer', 'UNKNOWN');
  expect(medicalCalls[1]!.body.medical).toHaveProperty('allergies.answer', 'UNKNOWN');
  expect(medicalCalls[1]!.body.medical).toHaveProperty('medicalConditions.answer', 'DISCUSS_IN_CONSULTATION');
  await page.getByRole('button', { name: 'Guardar y salir' }).click(); await expect(page).toHaveURL(/\/appointments$/);
  await page.goto('/patient-onboarding'); await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await page.getByLabel('Correo electrónico', { exact: true }).fill('ux02@example.test'); await page.getByLabel('Contraseña', { exact: true }).fill('prueba');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click(); await expect(page).toHaveURL(/patient-onboarding/);
  await next(page); await expect(page.getByRole('group', { name: 'Alergias y reacciones' }).getByRole('radio', { name: 'No lo sé', exact: true })).toBeChecked();
  const persisted = await page.evaluate(async () => ({ local: { ...localStorage }, session: { ...sessionStorage }, databases: await indexedDB.databases(), url: location.href, history: history.state }));
  expect(JSON.stringify(persisted)).not.toMatch(/UNKNOWN|DISCUSS_IN_CONSULTATION|ux02-synthetic/);
  expect(persisted.databases).toEqual([]);
});

test('UX-02 primer error enfocable, teclado radio y texto ampliado a 320px', async ({ page }) => {
  await fixture(page); await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/patient-onboarding'); await page.getByLabel('Fecha de nacimiento').fill(''); await next(page);
  await expect(page.getByLabel('Fecha de nacimiento')).toBeFocused();
  await expect(page.getByLabel('Fecha de nacimiento')).toHaveAttribute('aria-describedby', 'birthDate-help birthDate-error');
  await page.screenshot({ path: '/tmp/opencode/ux02/evidence/validation-320.png', fullPage: true });
  await page.getByLabel('Fecha de nacimiento').fill('10/04/1990'); await next(page); await accept(page); await next(page);
  const radio = page.getByRole('group', { name: 'Alergias y reacciones' }).getByRole('radio', { name: 'Sí', exact: true });
  await expect(radio).toBeFocused(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('group', { name: 'Alergias y reacciones' }).getByRole('radio', { name: 'No', exact: true })).toBeChecked();
  expect(await page.getByRole('radio', { name: 'No', exact: true }).first().evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.addStyleTag({ content: '.intake-surface { font-size: 200%; } .intake-surface :is(p, label, legend, button, input, textarea) { font-size: 1em !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Guardar y salir' }).scrollIntoViewIfNeeded(); await expect(page.getByRole('button', { name: 'Guardar y salir' })).toBeVisible();
});

test('UX-02 un envío lento sigue bloqueado aunque se intente enviar dos veces', async ({ page }) => {
  await fixture(page); await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/patient-onboarding'); await next(page); await accept(page); await all(page, 'No');
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  await page.route(url => url.pathname.endsWith('/medical-intake/draft/medical'), async route => {
    writes++; await waiting; await route.fallback();
  });
  await next(page);
  await expect(page.getByRole('button', { name: 'Siguiente', exact: true })).toBeDisabled();
  await page.locator('form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await expect(page.getByRole('button', { name: 'Siguiente', exact: true })).toBeDisabled();
  expect(writes).toBe(1);
  await expect(page.getByRole('status')).toContainText('Guardando…');
  await page.screenshot({ path: '/tmp/opencode/ux02/evidence/saving-390.png', fullPage: true });
  release();
  await expect(page.getByRole('group', { name: 'Condiciones médicas relevantes' })).toBeVisible();
  expect(writes).toBe(1);
});

/** Evidencia de textos reales sin iniciar backend: lectura estricta del archivo fuente autorizado. */
function definitionFromBackendSource(): IntakeDefinition {
  const source = readFileSync(new URL('../../backend/src/main/java/com/dentalclinic/medicalintake/application/IntakeDefinition.java', import.meta.url), 'utf8');
  const block = (name: string) => {
    const match = source.match(new RegExp(`public static final String ${name} = """([\\s\\S]*?)"""\\.strip\\(\\);`));
    if (!match) throw new Error(`No se localizó el texto canónico ${name}`);
    const lines = match[1]!.split('\n');
    const indentation = Math.min(...lines.filter(line => line.trim()).map(line => line.length - line.trimStart().length));
    return lines.map(line => line.slice(indentation)).join('\n').trim();
  };
  const noticeText = block('NOTICE_TEXT');
  return { ...intakeDefinition, noticeText, noticeHash: createHash('sha256').update(noticeText).digest('hex'), declarationText: block('DECLARATION_TEXT') };
}

for (const width of [390, 1440]) test(`UX-02 aviso y declaración canónicos completos ${width}px`, async ({ page }) => {
  const definition = definitionFromBackendSource();
  expect(definition.noticeText.length).toBeGreaterThan(intakeDefinition.noticeText.length);
  expect(definition.declarationText.length).toBeGreaterThan(intakeDefinition.declarationText.length);
  await fixture(page, definition); await page.setViewportSize({ width, height: 900 });
  await page.goto('/patient-onboarding'); await next(page);
  await page.getByText('Leer el aviso de privacidad completo', { exact: true }).click();
  await expect(page.locator('.intake-document')).toHaveText(definition.noticeText);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `/tmp/opencode/ux02/evidence/privacy-full-${width}.png`, fullPage: true });
  await accept(page);
  for (const name of ['Alergias y reacciones', 'Condiciones médicas relevantes', 'Reacciones a anestesia', 'Tratamientos anteriores']) {
    await expect(page.getByRole('group', { name })).toBeVisible(); await all(page, 'No lo sé'); await next(page);
  }
  await expect(page.getByLabel('Motivo de consulta')).toBeVisible(); await all(page, 'Prefiero hablarlo en consulta');
  await page.getByLabel('Motivo de consulta').fill('Revisión sintética con textos completos'); await next(page);
  await expect(page.locator('.intake-declaration > p').first()).toHaveText(definition.declarationText);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `/tmp/opencode/ux02/evidence/review-full-${width}.png`, fullPage: true });
});
