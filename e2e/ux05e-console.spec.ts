import { expect, test, type Page } from '@playwright/test';
import { dentalAttention, dentalCurrent, dentalEvent } from '../src/test/odontogramFixtures';
import type { ToothRecordDto } from '../src/api/odontogram';
import { selectDentalPiece } from './dentalInteraction';

const a = { id: 7, patientId: 1, patientFirstName: 'Ana', patientLastName: 'Paciente de prueba', dentistId: 3,
  dentistFirstName: 'Olivia', dentistLastName: 'Profesional de prueba', startAt: '2026-10-22T16:00:00Z', endAt: '2026-10-22T17:00:00Z',
  durationMinutes: 60, occurrenceVersion: 1, status: 'SCHEDULED', createdAt: '2026-10-21T12:00:00Z', createdByUserId: 2,
  service: { id: 1, name: 'Consulta de valoración', description: 'Servicio sintético', durationMinutes: 60, referencePrice: 500 } };
const empty = { content: [], page: 0, size: 20, totalPages: 0, totalElements: 0 };
type Entry = { id: number; content: string; authorName: string; authorDentistId: number; createdAt: string; appointmentContext: unknown };
async function fixture(page: Page, options: { temporary?: boolean; lostDental?: boolean; treatmentCount?: number; savedNote?: boolean } = {}) {
  const calls: { path: string; method: string; body: Record<string, unknown> | null }[] = [];
  const notes: Entry[] = [], evolutions: Entry[] = [];
  if (options.savedNote) notes.push({ id: 1, content: 'Nota previa de prueba', authorName: 'Olivia · Profesional de prueba', authorDentistId: 3,
    createdAt: a.startAt, appointmentContext: { appointmentId: 7, occurrenceVersion: 1, statusAtRegistration: 'SCHEDULED' } });
  const tooth = options.temporary ? 55 : 16;
  let records: ToothRecordDto[] = [dentalCurrent({ toothFdi: tooth, patientId: 1, dentition: options.temporary ? 'TEMPORARY' : 'PERMANENT', condition: 'CARIES', notes: 'Hallazgo dental sintético', treatmentIds: [9] })];
  let lost = false;
  const treatment = { id: 9, patientId: 1, appointmentId: 7, description: 'Restauración planificada', diagnosis: 'Diagnóstico textual de prueba', status: 'PLANNED', notes: '', toothFdis: [tooth], createdAt: a.createdAt };
  const treatments = Array.from({ length: options.treatmentCount ?? 1 }, (_, index) => ({ ...treatment, id: treatment.id + index,
    description: index === 0 ? treatment.description : `Tratamiento planificado ${index + 1}` }));
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method(), body = req.postDataJSON();
    calls.push({ path, method, body });
    const send = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (path === '/api/auth/refresh') return send({ accessToken: 'console-synthetic' });
    if (path === '/api/auth/me') return send({ id: 2, role: 'DENTIST', dentistId: 3, active: true, email: 'synthetic@console.test', createdAt: a.createdAt });
    if (path === '/api/onboarding/status') return send({ status: 'COMPLETED', clinicConfigured: true });
    if (path === '/api/public/schedule') return send({ timezone: 'America/Mexico_City', days: [], dentists: [], exceptions: [] });
    if (path === '/api/notifications/unread-count') return send({ unread: 0 });
    if (path === '/api/notifications' || path.endsWith('/medical-intake/declarations')) return send(empty);
    if (path === '/api/appointments/7') return send(a);
    if (path.endsWith('/complete')) return send({ ...a, status: 'COMPLETED', completedAt: a.endAt });
    if (path === '/api/appointments' || path === '/api/patients') return send(empty);
    if (path.endsWith('/clinical')) return send({ patientId: 1, allergies: 'Penicilina (información sintética)', medicalBackground: 'Antecedentes de prueba. No son datos de una persona real.' });
    if (path.endsWith('/notes') || path.endsWith('/evolution')) {
      const rows = path.endsWith('/notes') ? notes : evolutions;
      if (method === 'POST') { const entry = { ...body, id: rows.length + 1, authorName: 'Olivia · Profesional de prueba', authorDentistId: 3, createdAt: a.startAt,
        appointmentContext: body.appointmentContext ? { ...body.appointmentContext, statusAtRegistration: a.status } : undefined }; rows.push(entry); return send(entry, 201); }
      return send(rows);
    }
    if (path.endsWith('/trace')) {
      const rows = url.searchParams.get('section') === 'NOTES' ? notes : evolutions;
      return send({ context: { appointmentId: 7, occurrenceVersion: 1, currentOccurrenceVersion: 1, currentStatus: 'SCHEDULED', kind: 'CURRENT_UNFROZEN', timezone: 'America/Mexico_City' }, availableSections: ['NOTES', 'EVOLUTIONS'], section: url.searchParams.get('section'), results: { ...empty, content: rows.map(entry => ({ recordId: entry.id, originalEntry: entry, currentEntry: entry, corrections: [] })), totalElements: rows.length, totalPages: rows.length ? 1 : 0 } });
    }
    if (path.endsWith('/treatments')) return send(treatments);
    if (path.endsWith('/odontogram/at')) return send(dentalAttention({ currentState: { teeth: records } }));
    if (path.endsWith('/odontogram/history')) return send({ ...empty, content: [dentalEvent({ toothFdi: tooth })], totalElements: 1, totalPages: 1 });
    if (path.endsWith('/odontogram') && method === 'GET') return send(records);
    if (path.endsWith(`/odontogram/${tooth}`) && method === 'PUT') {
      records = records.map(r => r.toothFdi === tooth ? { ...r, ...body } : r);
      if (options.lostDental && !lost) { lost = true; return route.abort('failed'); }
      return send(records[0]);
    }
    if (path.endsWith(`/odontogram/${tooth}/surfaces`) && method === 'POST') {
      const surface = { ...body, id: 601, toothRecordId: 501, createdAt: a.startAt, history: [] };
      records = records.map(r => ({ ...r, surfaces: [...r.surfaces, surface] })); return send(surface, 201);
    }
    if (path.endsWith('/events') || path.endsWith('/exceptions') || path.endsWith('/time-off')) return send([]);
    if (path.includes('/schedules/')) return send({ timezone: 'America/Mexico_City', days: [] });
    return send({ message: `API no contemplada: ${path}` }, 404);
  });
  return calls;
}
async function open(page: Page) {
  await page.goto('/appointments/7?returnTo=%2Fappointments%3Fview%3Dweek%26date%3D2026-10-22');
  await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Guardar nota', exact: true })).toBeVisible();
}
async function capture(page: Page, name: string, width: number) {
  await page.evaluate(async () => { await document.fonts.ready; document.querySelector('main')?.scrollTo(0, 0); window.scrollTo(0, 0); });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/opencode/ux05f-regression-evidence/${name}-${width}.png`, fullPage: true, animations: 'disabled' });
}

for (const width of [390, 767, 768, 1440]) for (const count of [0, 1, 2, 3]) {
  test(`DC-CLIN-02A: ${count} tratamientos, acceso y borradores (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const calls = await fixture(page, { treatmentCount: count });
    await open(page);
    const section = page.getByRole('region', { name: 'Tratamientos del paciente', exact: true });
    await expect(section.getByText('Cargando tratamientos…')).toHaveCount(0);
    await expect(section.locator('.dc-compact-treatments > ol > li:visible')).toHaveCount(Math.min(count, 2));
    await expect(section.getByText('Todavía no hay tratamientos registrados.')).toHaveCount(count === 0 ? 1 : 0);
    await expect(section.getByRole('button', { name: /Ver todos los tratamientos/ })).toHaveCount(count > 2 ? 1 : 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    if (count === 2) {
      const second = section.getByRole('article', { name: 'Tratamiento Tratamiento planificado 2', exact: true });
      await expect(second).toBeVisible();
      await page.evaluate(async () => { await document.fonts.ready; });
      await section.screenshot({ path: `/tmp/opencode/dc-clin-02a/treatments-2-${width}.png`, animations: 'disabled' });
      await second.getByRole('button', { name: 'Ver detalle y evolución', exact: true }).click();
      await expect(second.getByText('Diagnóstico textual de prueba')).toBeVisible();
      await second.getByRole('button', { name: 'Evolución', exact: true }).click();
      const evolution = second.getByLabel('Nueva nota de evolución');
      await evolution.fill('Borrador de evolución del segundo tratamiento');
      await second.getByRole('button', { name: 'Ocultar detalle', exact: true }).click();
      await second.getByRole('button', { name: 'Ver detalle y evolución', exact: true }).click();
      await expect(evolution).toHaveValue('Borrador de evolución del segundo tratamiento');
      await second.getByRole('button', { name: 'Editar Tratamiento planificado 2', exact: true }).click();
      const description = section.getByLabel('Descripción', { exact: true });
      await expect(description).toHaveValue('Tratamiento planificado 2');
      await description.fill('Edición pendiente del segundo tratamiento');
      await section.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Cambios sin guardar en el tratamiento' })).toBeVisible();
      await page.getByRole('button', { name: 'Seguir editando', exact: true }).click();
      await page.getByRole('link', { name: 'Volver a Agenda', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeVisible();
      await page.getByRole('button', { name: 'Seguir aquí', exact: true }).click();
      await expect(description).toHaveValue('Edición pendiente del segundo tratamiento');
      await expect(evolution).toHaveValue('Borrador de evolución del segundo tratamiento');
      await page.getByRole('button', { name: 'Finalizar atención', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Confirmar finalización', exact: true })).toBeDisabled();
    }

    if (count > 2) {
      await section.getByRole('button', { name: `Ver todos los tratamientos (${count})`, exact: true }).click();
      await expect(section.locator('.dc-compact-treatments > ol > li:visible')).toHaveCount(count);
      const third = section.getByRole('article', { name: 'Tratamiento Tratamiento planificado 3', exact: true });
      await third.getByRole('button', { name: 'Ver detalle y evolución', exact: true }).click();
      await third.getByRole('button', { name: 'Evolución', exact: true }).click();
      await third.getByLabel('Nueva nota de evolución').fill('Borrador conservado al contraer');
      await section.getByRole('button', { name: 'Mostrar resumen de tratamientos', exact: true }).click();
      await expect(section.locator('.dc-compact-treatments > ol > li:visible')).toHaveCount(2);
      await expect(third).toBeHidden();
      await section.getByRole('button', { name: `Ver todos los tratamientos (${count})`, exact: true }).click();
      await expect(third.getByLabel('Nueva nota de evolución')).toHaveValue('Borrador conservado al contraer');
    }
    expect(calls.filter(call => call.method !== 'GET' && call.path !== '/api/auth/refresh')).toHaveLength(0);
  });
}

for (const width of [390, 767, 768, 1440]) test(`DC-CLIN-02B: paneles próximos, teclado y cinco destinos de borradores (${width}px)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const calls = await fixture(page, { treatmentCount: 3, savedNote: true });
  await open(page);
  const navigation = page.getByRole('navigation', { name: 'Consulta contextual', exact: true });
  const workspace = page.locator('.dc-console-work');
  const panels = [
    { trigger: page.getByRole('button', { name: 'Consultar expediente', exact: true }), name: 'Expediente del paciente' },
    { trigger: navigation.getByRole('button', { name: 'Registros de esta atención', exact: true }), name: 'Registros guardados de esta atención' },
    { trigger: navigation.getByRole('button', { name: /^Borradores pendientes/ }), name: 'Borradores pendientes' },
    { trigger: navigation.getByRole('button', { name: 'Historial del paciente', exact: true }), name: 'Historial del paciente' },
  ];
  const snapshot = async (name: string) => {
    await page.evaluate(async () => { await document.fonts.ready; document.querySelector('main')?.scrollTo(0, 0); window.scrollTo(0, 0); });
    await page.screenshot({ path: `/tmp/opencode/dc-clin-02b/${name}-${width}.png`, animations: 'disabled' });
  };
  const navBox = await navigation.boundingBox(), workBox = await workspace.boundingBox();
  expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(workBox!.y);
  await expect(page.getByRole('region', { name: 'Contexto del paciente' })).toContainText('Penicilina');
  await snapshot('01-accesos');
  for (const { trigger, name } of panels) {
    await trigger.focus();
    await trigger.press('Enter');
    const region = page.getByRole('region', { name, exact: true });
    await expect(region.getByRole('heading', { name, exact: true })).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(trigger).toHaveAttribute('aria-controls', await region.getAttribute('id') ?? '');
    const nav = await navigation.boundingBox(), panel = await region.boundingBox(), work = await workspace.boundingBox();
    expect(panel!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height);
    expect(panel!.y - (nav!.y + nav!.height)).toBeLessThanOrEqual(24);
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(work!.y);
    if (name === 'Expediente del paciente') await snapshot('02-expediente');
    await region.getByRole('button', { name: 'Volver a consulta', exact: true }).press('Enter');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(region).toBeHidden();
  }

  const note = page.getByLabel('Contenido de la nota');
  await note.fill('Borrador de nota entre paneles');
  await selectDentalPiece(page, 16);
  const dental = page.getByLabel('Observaciones (opcional)', { exact: true });
  await dental.fill('Borrador dental entre paneles');
  const treatments = page.getByRole('region', { name: 'Tratamientos del paciente', exact: true });
  await treatments.getByRole('button', { name: 'Ver todos los tratamientos (3)', exact: true }).click();
  const third = treatments.getByRole('article', { name: 'Tratamiento Tratamiento planificado 3', exact: true });
  await third.getByRole('button', { name: 'Ver detalle y evolución', exact: true }).click();
  await third.getByRole('button', { name: 'Evolución', exact: true }).click();
  const evolution = third.getByLabel('Nueva nota de evolución');
  await evolution.fill('Evolución pendiente entre paneles');
  await third.getByRole('button', { name: 'Evolución', exact: true }).click();
  await third.getByRole('button', { name: 'Ocultar detalle', exact: true }).click();
  await treatments.getByRole('button', { name: 'Mostrar resumen de tratamientos', exact: true }).click();
  await panels[0].trigger.click();
  const record = page.getByRole('region', { name: 'Expediente del paciente', exact: true });
  await record.getByLabel('Alergias', { exact: true }).fill('Expediente pendiente entre paneles');
  await panels[3].trigger.click();
  const history = page.getByRole('region', { name: 'Historial del paciente', exact: true });
  await history.getByRole('button', { name: 'Corregir', exact: true }).click();
  const correction = history.getByLabel('Contenido corregido');
  await correction.fill('Corrección pendiente entre paneles');
  await history.getByLabel('Motivo de la corrección').fill('Motivo de prueba');
  await panels[1].trigger.click();
  const pending = navigation.getByRole('button', { name: 'Borradores pendientes · 5', exact: true });
  await pending.click();
  await snapshot('03-pendientes');
  const destinations = [
    { name: 'nota', target: note, value: 'Borrador de nota entre paneles' },
    { name: 'odontograma', target: dental, value: 'Borrador dental entre paneles' },
    { name: 'tratamientos y evolución', target: evolution, value: 'Evolución pendiente entre paneles' },
    { name: 'expediente', target: record.getByLabel('Antecedentes médicos', { exact: true }) },
    { name: 'corrección de nota', target: correction, value: 'Corrección pendiente entre paneles' },
  ];
  for (const { name, target, value } of destinations) {
    if (await pending.getAttribute('aria-expanded') !== 'true') await pending.click();
    await page.getByRole('button', { name: `Ir al borrador de ${name}`, exact: true }).click();
    await expect(target).toBeFocused();
    if (value) await expect(target).toHaveValue(value);
    const box = await target.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(1000);
  }
  await panels[0].trigger.click();
  await expect(record.getByLabel('Alergias', { exact: true })).toHaveValue('Expediente pendiente entre paneles');
  await expect(page.locator('#clinical-note textarea')).toHaveValue('Borrador de nota entre paneles');
  await expect(page.locator('#clinical-dental textarea').first()).toHaveValue('Borrador dental entre paneles');
  await expect(page.locator('#clinical-history textarea')).toHaveValue('Corrección pendiente entre paneles');
  await expect(pending).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Finalizar atención', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirmar finalización', exact: true })).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('link', { name: 'Volver a Agenda', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeVisible();
  await page.getByRole('button', { name: 'Seguir aquí', exact: true }).click();
  await expect(record.getByLabel('Alergias', { exact: true })).toHaveValue('Expediente pendiente entre paneles');
  expect(calls.filter(call => call.method !== 'GET' && call.path !== '/api/auth/refresh')).toHaveLength(0);
});

for (const width of [1440, 390]) test(`UX-05E: consola, registro, arcadas, pieza, superficies, evolución y confirmación (${width})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); const calls = await fixture(page); await open(page);
  await expect(page.getByRole('region', { name: 'Nota de la consulta', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Área dental' })).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  expect(calls.filter(c => c.method !== 'GET' && c.path !== '/api/auth/refresh')).toHaveLength(0);
  if (width === 1440) {
    const dental = await page.locator('.dc-console-dental').boundingBox(), note = await page.locator('.dc-console-note').boundingBox();
    // UX-05G gives the dental map/editor the full row rather than squeezing a third column.
    expect(note!.y).toBeGreaterThanOrEqual(dental!.y + dental!.height);
    expect(note!.width).toBeGreaterThanOrEqual(600);
  }
  await capture(page, '01-consola-inicial', width);
  await page.getByLabel('Contenido de la nota').fill('Se documentan los hallazgos y las indicaciones de esta consulta sintética. El tratamiento permanece planificado.');
  await page.getByRole('button', { name: 'Guardar nota', exact: true }).click();
  await expect(page.getByText(/Nota clínica guardada/)).toBeVisible();
  await page.getByRole('button', { name: 'Registros de esta atención', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Notas de esta atención' }).getByText(/Se documentan los hallazgos/)).toBeVisible();
  await capture(page, '02-nota-registros', width);
  await page.getByRole('button', { name: 'Volver a consulta', exact: true }).click();
  await page.getByRole('button', { name: 'Explorar odontograma', exact: true }).click();
  await expect(page.locator('.dc-tooth-symbol[data-family="molar"]').first()).toBeAttached();
  if (width === 1440) {
    const boxes = await page.locator('.dc-full-arcades:visible .dc-dental-piece').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    expect(boxes).toHaveLength(32);
    expect(boxes.every(r => r.width >= 44 && r.height >= 44)).toBe(true);
    expect(boxes.some((a, i) => boxes.slice(i + 1).some(b => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)))).toBe(false);
  }
  await capture(page, '03-odontograma-completo', width);
  if (width === 390) await page.getByLabel('Cuadrante', { exact: true }).selectOption('0');
  await page.getByRole('button', { name: /Pieza 16 Superior derecho Permanente/ }).click();
  await expect(page.getByLabel('Condición de la pieza')).toHaveValue('CARIES');
  await page.getByLabel('Observaciones (opcional)', { exact: true }).fill('Hallazgo revisado en pieza 16. Información sintética.');
  await capture(page, '04-pieza-editor', width);
  await page.getByRole('button', { name: 'Volver a consulta', exact: true }).click();
  await expect(page.locator('[data-dental-renderer="shared"]')).toBeVisible();
  await expect(page.getByLabel('Condición de la pieza')).toBeVisible();
  await page.getByLabel('Contenido de la nota').fill('Borrador simultáneo conservado');
  await page.getByRole('button', { name: 'Explorar odontograma', exact: true }).click();
  await expect(page.getByLabel('Observaciones (opcional)', { exact: true })).toHaveValue('Hallazgo revisado en pieza 16. Información sintética.');
  await page.getByRole('button', { name: 'Guardar pieza', exact: true }).click();
  await expect(page.getByText('Pieza 16 guardada.', { exact: true })).toBeVisible();
  await page.getByText('Superficies de la pieza', { exact: true }).click();
  await page.getByLabel('Condición de la superficie Oclusal').selectOption('CARIES');
  await page.getByLabel('Observaciones de Oclusal').fill('Registro de superficie sintético');
  await capture(page, '05-superficies', width);
  await page.getByRole('button', { name: 'Guardar superficie oclusal', exact: true }).click();
  await expect(page.getByText('Superficie Oclusal guardada.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Volver a consulta', exact: true }).click();
  await expect(page.getByLabel('Contenido de la nota')).toHaveValue('Borrador simultáneo conservado');
  await page.getByRole('button', { name: 'Descartar borrador de nota' }).click();
  await page.getByRole('button', { name: 'Ver detalle y evolución' }).click();
  await page.getByRole('button', { name: 'Evolución', exact: true }).click();
  await page.getByLabel('Nueva nota de evolución').fill('Seguimiento explícito. No se marca el tratamiento como realizado.');
  await page.getByRole('button', { name: 'Evolución', exact: true }).click();
  await page.getByRole('button', { name: 'Ocultar detalle', exact: true }).click();
  await page.getByRole('button', { name: 'Borradores pendientes · 1', exact: true }).click();
  await page.getByRole('button', { name: 'Ir al borrador de tratamientos y evolución', exact: true }).click();
  await expect(page.getByLabel('Nueva nota de evolución')).toHaveValue('Seguimiento explícito. No se marca el tratamiento como realizado.');
  await expect(page.getByLabel('Nueva nota de evolución')).toBeFocused();
  await capture(page, '06-tratamiento-evolucion', width);
  await page.getByRole('button', { name: 'Guardar evolución', exact: true }).click();
  await expect(page.getByLabel('Nueva nota de evolución')).toHaveValue('');
  await expect(page.getByText(/Estado al registrar: undefined/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Finalizar atención', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirmar finalización' })).toBeEnabled();
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveCount(0);
  await capture(page, '07-confirmacion', width);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Finalizar atención', exact: true })).toBeFocused();
  expect(calls.some(c => /checkout|financial-context|collection|charges/.test(c.path))).toBe(false);
  expect(calls.filter(c => c.path.endsWith('/notes') && c.method === 'POST')).toHaveLength(1);
  expect(calls.find(c => c.path.endsWith('/odontogram/16') && c.method === 'PUT')?.body).not.toHaveProperty('surfaces');
  expect(calls.find(c => c.path.endsWith('/surfaces') && c.method === 'POST')?.body).not.toHaveProperty('treatmentIds');
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] });
});

test('UX-05E: cambio de pieza y dentición protege solo el borrador dental', async ({ page }) => {
  await fixture(page, { temporary: true }); await open(page);
  await page.getByLabel('Contenido de la nota').fill('Nota independiente');
  await selectDentalPiece(page, 55);
  await page.getByLabel('Observaciones (opcional)', { exact: true }).fill('Borrador temporal');
  await selectDentalPiece(page, 54);
  await expect(page.getByRole('dialog', { name: 'Cambios sin guardar en la pieza 55' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Observaciones (opcional)', { exact: true })).toHaveValue('Borrador temporal');
  await page.getByRole('button', { name: 'Explorar odontograma' }).click();
  await page.getByRole('button', { name: 'Permanente', exact: true }).click();
  await page.getByRole('button', { name: 'Descartar estos cambios y continuar' }).click();
  await page.getByRole('button', { name: 'Volver a consulta', exact: true }).click();
  await expect(page.getByLabel('Contenido de la nota')).toHaveValue('Nota independiente');
  await page.getByRole('button', { name: 'Finalizar atención', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirmar finalización' })).toBeDisabled();
});

test('UX-05E: cambio dental incierto exige revisión sin replay ficticio', async ({ page }) => {
  const calls = await fixture(page, { lostDental: true }); await open(page);
  await selectDentalPiece(page, 16);
  await page.getByLabel('Observaciones (opcional)', { exact: true }).fill('Respuesta perdida');
  await page.getByRole('button', { name: 'Guardar pieza', exact: true }).click();
  await expect(page.getByText(/No sabemos si el cambio dental se guardó/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar pieza', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Consultar estado dental antes de repetir' }).click();
  await expect(page.getByRole('button', { name: 'He revisado el estado; permitir otro envío' })).toBeVisible();
  expect(calls.filter(c => c.path.endsWith('/odontogram/16') && c.method === 'PUT')).toHaveLength(1);
});

for (const width of [320, 768, 1280]) test(`UX-05E: responsive y lectura por lista (${width})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await fixture(page); await open(page);
  await page.getByRole('button', { name: 'Explorar odontograma' }).click();
  await page.getByRole('button', { name: 'Lista', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /Registrar pieza 48/ }).click();
  await expect(page.getByLabel('Condición de la pieza')).toHaveValue('');
});
