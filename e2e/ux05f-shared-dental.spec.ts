import { expect, test, type Locator, type Page } from '@playwright/test';
import { dentalAttention, dentalCurrent, dentalHistorical } from '../src/test/odontogramFixtures';
import { selectDentalPiece } from './dentalInteraction';
import { CONDITION_ORDER } from '../src/components/odontogram/odontogramUi';

type Role = 'OWNER' | 'DENTIST' | 'RECEPTIONIST' | 'PATIENT';
const empty = { content: [], page: 0, size: 20, totalPages: 0, totalElements: 0 };
// Preserve historical UX-05F evidence when checking a later, scoped presentation adjustment.
const evidenceDirectory = process.env['DENTALCLINIC_DENTAL_EVIDENCE'] ?? '../docs/ux/ux05f-evidence';
const appointment = { id: 7, patientId: 1, patientFirstName: 'Ana', patientLastName: 'Paciente sintética', dentistId: 3,
  dentistFirstName: 'Olivia', dentistLastName: 'Profesional sintética', startAt: '2026-10-22T16:00:00Z', endAt: '2026-10-22T17:00:00Z',
  durationMinutes: 60, occurrenceVersion: 1, status: 'SCHEDULED', createdAt: '2026-10-21T12:00:00Z', createdByUserId: 2,
  service: { id: 1, name: 'Consulta de valoración', description: 'Servicio sintético', durationMinutes: 60, referencePrice: 500 } };

async function fixture(page: Page, role: Role, options: { temporary?: boolean; summaryError?: boolean; silhouetteSample?: boolean; clinicalSample?: boolean } = {}) {
  const calls: { path: string; method: string }[] = [];
  const fdi = options.temporary ? 55 : 16;
  const record = dentalCurrent({ patientId: 1, toothFdi: fdi, dentition: options.temporary ? 'TEMPORARY' : 'PERMANENT',
    condition: 'CARIES', notes: 'Observación profesional sintética', treatmentIds: [], surfaces: [
      { id: 601, toothRecordId: 501, surface: 'MESIAL', condition: 'RESTORED', notes: 'Observación de superficie privada', history: [], createdAt: appointment.createdAt }] });
  const records = [record, ...(options.silhouetteSample && !options.temporary ? [
    dentalCurrent({ id: 511, patientId: 1, toothFdi: 11, condition: 'HEALTHY', treatmentIds: [], notes: '' }),
    dentalCurrent({ id: 514, patientId: 1, toothFdi: 14, condition: 'RESTORED', treatmentIds: [], notes: '' }),
    dentalCurrent({ id: 526, patientId: 1, toothFdi: 26, condition: 'FRACTURED', treatmentIds: [], notes: '' }),
  ] : []), ...(options.clinicalSample ? ([
    [15, 'ROOT_CANAL'], [17, 'CROWN'], [18, 'IMPLANT'], [21, 'MISSING'],
    [22, 'EXTRACTED'], [24, 'SEALED'], [25, 'OTHER'],
  ] as const).map(([toothFdi, condition]) => dentalCurrent({ id: 500 + toothFdi, patientId: 1, toothFdi, condition, notes: '', treatmentIds: [] })) : [])];
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    calls.push({ path, method });
    const send = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (path === '/api/auth/refresh') return send({ accessToken: 'synthetic-ux05f' });
    if (path === '/api/auth/me') return send({ id: 2, role, dentistId: role === 'OWNER' || role === 'DENTIST' ? 3 : undefined,
      patientId: role === 'PATIENT' ? 1 : undefined, email: 'synthetic@ux05f.test', active: true, createdAt: appointment.createdAt,
      medicalOnboarding: role === 'PATIENT' ? { requirement: 'EXEMPT_EXISTING', progress: 'NOT_STARTED', pending: false } : undefined });
    if (path === '/api/onboarding/status') return send({ status: 'COMPLETED', clinicConfigured: true });
    if (path === '/api/public/schedule') return send({ timezone: 'America/Mexico_City', days: [], dentists: [], exceptions: [] });
    if (path === '/api/notifications/unread-count') return send({ unread: 0 });
    if (path === '/api/notifications' || path.endsWith('/medical-intake/declarations')) return send(empty);
    if (path === '/api/appointments/7') return send(appointment);
    if (path === '/api/appointments' || path === '/api/patients') return send(empty);
    if (path === '/api/patients/1') return send({ id: 1, firstName: 'Ana', lastName: 'Paciente sintética', active: true, createdAt: appointment.createdAt });
    if (path === `/api/patients/1/odontogram/${fdi}` && method === 'PUT' && (role === 'OWNER' || role === 'DENTIST')) {
      Object.assign(record, request.postDataJSON());
      return send(record);
    }
    if (path.endsWith('/odontogram/reception-summary')) return role !== 'RECEPTIONIST' ? send({}, 403) : options.summaryError ? send({}, 503)
      : send([{ toothFdi: fdi, dentition: record.dentition, condition: record.condition, surfaces: [{ surface: 'MESIAL', condition: 'RESTORED' }] }]);
    if (role === 'RECEPTIONIST' && (/\/clinical|\/odontogram/.test(path))) return send({ message: 'No autorizado' }, 403);
    if (path.endsWith('/odontogram') && method === 'GET') return role === 'PATIENT'
      ? send([{ toothFdi: fdi, dentition: record.dentition, condition: record.condition }]) : send(records);
    if (path.endsWith('/surfaces') && method === 'GET' && role === 'PATIENT') return send([{ surface: 'MESIAL', condition: 'RESTORED' }]);
    if (role === 'PATIENT' && (/\/clinical|\/history|\/at(?:$|\?)/.test(path))) return send({}, 403);
    if (path.endsWith('/odontogram/at')) {
      if (url.searchParams.has('at')) return send({ reference: { mode: 'INSTANT', at: url.searchParams.get('at') }, reconstructionAvailable: true,
        teeth: [dentalHistorical({ toothFdi: fdi, dentition: record.dentition })], completeness: { status: 'PARTIAL', reasons: ['NOTES_UNKNOWN'] } });
      return send(dentalAttention({ currentState: { teeth: [record] } }));
    }
    if (path.endsWith('/odontogram/history')) return send(empty);
    if (path.endsWith('/clinical')) return send({ patientId: 1, allergies: 'Información sintética' });
    if (path.endsWith('/treatments') || path.endsWith('/notes') || path.endsWith('/evolution')) return send([]);
    if (path.endsWith('/trace')) return send({ context: { appointmentId: 7, occurrenceVersion: 1, currentOccurrenceVersion: 1,
      currentStatus: 'SCHEDULED', kind: 'CURRENT_UNFROZEN', timezone: 'America/Mexico_City' }, availableSections: ['NOTES', 'EVOLUTIONS'],
      section: url.searchParams.get('section'), results: empty });
    if (path.endsWith('/events') || path.endsWith('/exceptions') || path.endsWith('/time-off')) return send([]);
    if (path.includes('/schedules/')) return send({ timezone: 'America/Mexico_City', days: [] });
    return send({ message: `Ruta no prevista: ${path}` }, 404);
  });
  return { calls, fdi };
}

const contexts = [
  { name: 'consulta', role: 'DENTIST', url: '/appointments/7' },
  { name: 'expediente', role: 'DENTIST', url: '/patients/1' },
  { name: 'owner', role: 'OWNER', url: '/appointments/7' },
  { name: 'recepcion', role: 'RECEPTIONIST', url: '/patients/1' },
  { name: 'patient', role: 'PATIENT', url: '/patients/1' },
  { name: 'historia', role: 'DENTIST', url: '/patients/1' },
] as const;

for (const width of [1440, 390]) for (const context of contexts) test(`UX-05F ${context.name}: representación y selección ${width}`, async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', message => { if (message.type() === 'error' && /same key|unique.*key|Uncaught/.test(message.text())) consoleErrors.push(message.text()); });
  await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  const { calls } = await fixture(page, context.role); await page.goto(context.url);
  if (context.name === 'consulta') await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  if (context.name === 'owner') {
    await page.getByRole('button', { name: 'Odontograma', exact: true }).click();
    await page.getByRole('button', { name: 'Estado actual', exact: true }).click();
  }
  const dental = page.getByRole('region', { name: 'Odontograma', exact: true });
  if (context.name === 'historia') {
    await dental.getByRole('button', { name: 'Consulta histórica', exact: true }).click();
    await dental.getByLabel('Fecha y hora (UTC)', { exact: true }).fill('2026-10-13T11:05');
    await dental.getByRole('button', { name: 'Consultar estado histórico', exact: true }).click();
  }
  const chart = dental.locator('.dc-dental-chart:visible');
  await expect(chart.locator('[data-dental-renderer="shared"]')).toBeVisible();
  expect(await chart.locator('.dc-tooth-symbol [data-anatomy="ux05m"]').count()).toBeGreaterThan(0);
  const buttons = chart.locator('.dc-dental-piece:visible');
  const boxes = await buttons.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  expect(boxes.length).toBeGreaterThanOrEqual(8);
  expect(boxes.every(r => r.w >= 44 && r.h >= 44)).toBe(true);
  expect(boxes.some((a, i) => boxes.slice(i + 1).some(b => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y)))).toBe(false);
  const symbol = chart.locator('.dc-tooth-symbol:visible').first();
  expect((await symbol.boundingBox())!.width).toBeGreaterThanOrEqual(32);
  await selectDentalPiece(chart, 16);
  await expect(chart.locator('[data-fdi="16"]')).toHaveAttribute('aria-pressed', 'true');
  const editable = context.role === 'OWNER' || context.role === 'DENTIST' && context.name !== 'historia';
  if (editable) {
    await expect(chart.getByLabel('Condición de la pieza')).toHaveValue('CARIES');
    await expect(chart.getByRole('button', { name: 'Guardar pieza', exact: true })).toBeEnabled();
  } else {
    await expect(chart.getByRole('heading', { name: /Pieza 16/ })).toBeFocused();
    await expect(chart.getByLabel('Condición de la pieza')).toHaveCount(0);
    await expect(chart.getByRole('button', { name: /Guardar|Registrar|Actualizar/ })).toHaveCount(0);
  }
  await chart.getByRole('button', { name: context.name === 'historia' ? 'Cerrar detalle histórico' : editable ? 'Cerrar edición de la pieza 16' : 'Cerrar', exact: true }).click();
  await expect(chart.locator('[data-fdi="16"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(chart.getByRole('heading', { name: /Pieza 16/ })).toBeFocused();
  const focusedVisible = await chart.getByRole('heading', { name: /Pieza 16/ }).evaluate(node => {
    const r = node.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  });
  expect(focusedVisible).toBe(true);
  await page.evaluate(async () => { await document.fonts.ready; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const shot = context.name === 'consulta' ? page.locator('.dc-console-work') : chart;
  // Element captures omit fixed chrome only during capture, avoiding a misleading stitched overlay.
  await shot.screenshot({ path: `${evidenceDirectory}/${context.name}-${width}.png`, animations: 'disabled',
    style: 'nav[aria-label="Navegación rápida"] { visibility: hidden !important; }' });
  if (width === 390) {
    await chart.getByRole('heading', { name: /Pieza 16/ }).evaluate(node => node.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${evidenceDirectory}/${context.name}-390-viewport.png`, animations: 'disabled' });
    if (editable) {
      const save = chart.getByRole('button', { name: 'Guardar pieza', exact: true });
      await save.focus();
      await save.evaluate(node => node.scrollIntoView({ block: 'center' }));
      expect(await save.evaluate(node => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
    }
  }
  expect(consoleErrors).toEqual([]);
  if (context.role === 'RECEPTIONIST' || context.role === 'PATIENT') {
    await expect(chart).not.toContainText('Observación profesional sintética');
    await expect(chart).not.toContainText('Observación de superficie privada');
    expect(calls.some(call => /\/clinical|\/history|\/at$/.test(call.path))).toBe(false);
    expect(calls.filter(call => call.path.includes('/odontogram') && call.method !== 'GET')).toHaveLength(0);
    if (context.role === 'RECEPTIONIST') expect(calls.filter(call => call.path.includes('/odontogram')).map(call => call.path))
      .toEqual(['/api/patients/1/odontogram/reception-summary']);
    await selectDentalPiece(chart, 17);
    await expect(chart.getByRole('heading', { name: 'Pieza 17', exact: true })).toBeVisible();
    await expect(chart.locator('.dc-dental-detail')).toContainText('Sin registro');
    expect(calls.some(call => call.path.includes('/17/surfaces'))).toBe(false);
  }
});

for (const role of ['OWNER', 'DENTIST', 'RECEPTIONIST', 'PATIENT'] as const) test(`UX-05F temporal sin premolares: ${role}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 }); const { calls } = await fixture(page, role, { temporary: true });
  await page.goto('/patients/1');
  const dental = page.getByRole('region', { name: 'Odontograma', exact: true });
  await dental.getByRole('button', { name: 'Temporal', exact: true }).click();
  await selectDentalPiece(dental, 55);
  await expect(dental.locator('[data-fdi="55"] svg')).toHaveAttribute('data-family', 'molar');
  await expect(dental.locator('svg[data-family="premolar"]')).toHaveCount(0);
  expect(calls.filter(call => call.path.includes('/odontogram') && call.method !== 'GET')).toHaveLength(0);
});

test('UX-05F recepción: fallo de resumen no activa rutas clínicas ni presume piezas sanas', async ({ page }) => {
  const { calls } = await fixture(page, 'RECEPTIONIST', { summaryError: true }); await page.goto('/patients/1');
  await expect(page.getByRole('button', { name: 'Reintentar resumen dental' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pieza 16/ })).toHaveCount(0);
  expect(calls.filter(call => call.path.includes('/odontogram')).map(call => call.path)).toEqual(['/api/patients/1/odontogram/reception-summary']);
});

test('UX-05F PATIENT: ficha ajena no monta ni solicita odontograma', async ({ page }) => {
  const { calls } = await fixture(page, 'PATIENT'); await page.goto('/patients/99');
  await expect(page.getByText(/No se encontró tu ficha/)).toBeVisible();
  expect(calls.some(call => call.path.includes('/odontogram'))).toBe(false);
});

test('UX-05F selección directa, teclado, lista y resize preservan una instancia del editor y nota', async ({ page }) => {
  await fixture(page, 'DENTIST'); await page.goto('/appointments/7'); await page.getByRole('button', { name: 'Abrir consulta' }).click();
  await page.getByLabel('Contenido de la nota').fill('Borrador independiente');
  await selectDentalPiece(page, 16); await page.getByLabel('Observaciones (opcional)', { exact: true }).fill('Borrador de pieza');
  for (const width of [320, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByLabel('Observaciones (opcional)', { exact: true })).toHaveValue('Borrador de pieza');
    await expect(page.locator('.dc-piece-editor')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: 'Lista', exact: true }).click();
  await expect(page.getByLabel('Contenido de la nota')).toHaveValue('Borrador independiente');
  await page.getByRole('button', { name: 'Gráfico', exact: true }).click();
  await page.getByRole('button', { name: 'Explorar odontograma' }).click();
  await page.getByRole('button', { name: 'Volver a consulta', exact: true }).click();
  await expect(page.getByLabel('Observaciones (opcional)', { exact: true })).toHaveValue('Borrador de pieza');
  await selectDentalPiece(page, 17);
  await expect(page.getByRole('dialog', { name: 'Cambios sin guardar en la pieza 16' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Observaciones (opcional)', { exact: true })).toHaveValue('Borrador de pieza');
  await page.getByRole('button', { name: 'Finalizar atención', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirmar finalización' })).toBeDisabled();
});

for (const width of [1440, 1280]) for (const consoleMode of [false, true]) test(`UX-05G ${consoleMode ? 'consulta' : 'expediente'} ${width}: mapa/editor juntos, guardado explícito y selección sin saltos`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const { calls } = await fixture(page, 'DENTIST');
  await page.goto(consoleMode ? '/appointments/7' : '/patients/1');
  if (consoleMode) await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  const chart = page.getByRole('region', { name: 'Odontograma', exact: true }).locator('.dc-dental-chart:visible');
  await expect(chart.locator('[data-dental-renderer="shared"]')).toBeVisible();
  await selectDentalPiece(chart, 16);
  await chart.evaluate(node => node.scrollIntoView({ block: 'center' }));
  const map = chart.locator('.dc-chart-map');
  const detail = chart.locator('.dc-dental-detail');
  const mapBox = (await map.boundingBox())!, detailBox = (await detail.boundingBox())!;
  expect(detailBox.x).toBeGreaterThanOrEqual(mapBox.x + mapBox.width);
  expect(Math.abs(detailBox.y - mapBox.y)).toBeLessThan(2);
  expect((await chart.locator('.dc-full-arcades').boundingBox())!.height).toBe(238);
  expect((await chart.locator('.dc-full-arcades').boundingBox())!.width).toBe(704);
  await expect(chart.locator('.dc-dental-piece:visible')).toHaveCount(32);
  await chart.getByLabel('Condición de la pieza').selectOption('RESTORED');
  await chart.getByLabel('Observaciones (opcional)', { exact: true }).fill('Guardado explícito UX-05G');
  expect(calls.filter(call => call.method === 'PUT')).toHaveLength(0);
  await chart.getByRole('button', { name: 'Guardar pieza', exact: true }).click();
  await expect(page.getByText('Pieza 16 guardada.', { exact: true })).toBeVisible();
  expect(calls.filter(call => call.method === 'PUT')).toHaveLength(1);
  // Reposition once for the workspace; switching teeth must not require further scrolling.
  await chart.evaluate(node => node.scrollIntoView({ block: 'center' }));
  const position = () => chart.evaluate(node => ({ window: window.scrollY, main: node.closest('main')?.scrollTop ?? 0 }));
  const before = await position();
  for (const fdi of [17, 18, 16]) {
    await selectDentalPiece(chart, fdi);
    await expect(chart.getByRole('heading', { name: `Pieza ${fdi}`, exact: true })).toBeFocused();
    expect(await position()).toEqual(before);
    await expect(chart.locator('.dc-piece-editor')).toHaveCount(1);
  }
  await expect(chart.getByLabel('Observaciones (opcional)', { exact: true })).toHaveValue('Guardado explícito UX-05G');
  if (consoleMode) {
    const note = page.getByLabel('Contenido de la nota');
    expect((await note.boundingBox())!.width).toBeGreaterThanOrEqual(600);
    expect((await note.boundingBox())!.height).toBeGreaterThanOrEqual(120);
    await note.fill('Borrador de nota independiente UX-05G');
    await chart.getByLabel('Observaciones (opcional)', { exact: true }).fill('Borrador dental UX-05G');
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.setViewportSize({ width, height: 1000 });
    await expect(note).toHaveValue('Borrador de nota independiente UX-05G');
    await expect(chart.getByLabel('Observaciones (opcional)', { exact: true })).toHaveValue('Borrador dental UX-05G');
    await expect(chart.locator('.dc-piece-editor')).toHaveCount(1);
  }
});

for (const width of [1440, 390]) for (const temporary of [false, true]) test(`UX-05H siluetas ${temporary ? 'temporal' : 'permanente'} ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { calls, fdi } = await fixture(page, 'DENTIST', { temporary, silhouetteSample: true });
  await page.goto('/patients/1');
  const chart = page.getByRole('region', { name: 'Odontograma', exact: true }).locator('.dc-dental-chart:visible');
  await chart.getByRole('button', { name: temporary ? 'Temporal' : 'Permanente', exact: true }).click();
  await selectDentalPiece(chart, fdi);
  await expect(chart.locator(`[data-fdi="${fdi}"]`)).toHaveAttribute('aria-pressed', 'true');
  const boxes = await chart.locator('.dc-dental-piece:visible').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  }));
  expect(boxes.every(r => r.w >= 44 && r.h >= 44)).toBe(true);
  expect(boxes.some((a, i) => boxes.slice(i + 1).some(b => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y)))).toBe(false);
  if (width === 1440) expect((await chart.locator('.dc-full-arcades').boundingBox())!.height).toBe(238);
  await page.evaluate(async () => { await document.fonts.ready; });
  await chart.screenshot({ path: `${evidenceDirectory}/${temporary ? 'temporal' : 'permanente'}-${width}.png`, animations: 'disabled',
    style: 'nav[aria-label="Navegación rápida"] { visibility: hidden !important; }' });
  expect(calls.filter(call => call.method !== 'GET' && call.path.includes('/odontogram'))).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [1440, 390]) test(`UX-05I arcadas y detalle ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { calls } = await fixture(page, 'DENTIST', { silhouetteSample: true });
  await page.goto('/patients/1');
  const chart = page.getByRole('region', { name: 'Odontograma', exact: true }).locator('.dc-dental-chart:visible');
  await selectDentalPiece(chart, 16);
  await expect(chart.locator('[data-fdi="16"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.getByRole('heading', { name: 'Pieza 16', exact: true })).toBeVisible();
  const boxes = await chart.locator('.dc-dental-piece:visible').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  }));
  expect(boxes.every(r => r.w >= 44 && r.h >= 44)).toBe(true);
  expect(boxes.some((a, i) => boxes.slice(i + 1).some(b => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y)))).toBe(false);
  if (width === 1440) {
    expect((await chart.locator('.dc-full-arcades').boundingBox())!.height).toBe(238);
    await expect(chart.locator('.dc-tooth-symbol:visible')).toHaveCount(32);
  }
  await page.evaluate(async () => { await document.fonts.ready; });
  await chart.locator('.dc-full-arcades').screenshot({ path: `${evidenceDirectory}/arcada-${width}.png`, animations: 'disabled' });
  await chart.screenshot({ path: `${evidenceDirectory}/detalle-${width}.png`, animations: 'disabled',
    style: 'nav[aria-label="Navegación rápida"] { visibility: hidden !important; }' });
  if (width === 390) await page.screenshot({ path: `${evidenceDirectory}/expediente-390-viewport.png`, animations: 'disabled' });
  expect(calls.filter(call => call.method !== 'GET' && call.path.includes('/odontogram'))).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


/* UX-05J — compact arches, flat crowns, exterior FDI. Captures are opt-in so the
 * historical UX-05F/G/H/I evidence stays stable unless requested explicitly. */
const ux05jEvidence = process.env['DENTALCLINIC_UX05J_EVIDENCE'] ?? '../docs/ux/ux05j-evidence/despues';

async function dentalChart(page: Page) {
  return page.getByRole('region', { name: 'Odontograma', exact: true }).locator('.dc-dental-chart:visible');
}

async function targetBoxes(chart: Locator) {
  return chart.locator('.dc-dental-piece:visible').evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  }));
}

function expectNoOverlap(boxes: { x: number; y: number; w: number; h: number }[]) {
  expect(boxes.every(r => r.w >= 44 && r.h >= 44)).toBe(true);
  expect(boxes.some((a, i) => boxes.slice(i + 1).some(b => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x)
    && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y)))).toBe(false);
}

test('UX-05J permanentes: dos arcadas compactas, orden FDI y coronas sólidas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { calls } = await fixture(page, 'DENTIST', { silhouetteSample: true });
  await page.goto('/patients/1');
  const chart = await dentalChart(page);
  const map = chart.locator('.dc-full-arcades');
  await expect(map).toBeVisible();
  const mapBox = (await map.boundingBox())!;
  expect(mapBox.width).toBe(704);
  expect(mapBox.height).toBe(238);
  const order = await chart.locator('.dc-dental-piece').evaluateAll(nodes => nodes.map(node => ({
    fdi: Number(node.getAttribute('data-fdi')), arch: node.getAttribute('data-arch'),
  })));
  expect(order.filter(piece => piece.arch === 'upper').map(piece => piece.fdi))
    .toEqual([18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]);
  expect(order.filter(piece => piece.arch === 'lower').map(piece => piece.fdi))
    .toEqual([48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]);
  expectNoOverlap(await targetBoxes(chart));
  const geometry = await chart.locator('.dc-dental-piece').evaluateAll(nodes => nodes.map(node => {
    const crown = node.querySelector('.dc-crown-outline')!.getBoundingClientRect();
    const fdi = node.querySelector('.dc-fdi')!.getBoundingClientRect();
    return { arch: node.getAttribute('data-arch'), crownW: crown.width, crownH: crown.height,
      crownTop: crown.top, crownBottom: crown.bottom, fdiTop: fdi.top, fdiBottom: fdi.bottom };
  }));
  expect(geometry.every(r => r.arch === 'upper' ? r.fdiBottom <= r.crownTop : r.fdiTop >= r.crownBottom)).toBe(true);
  // UX-05M uses the approved, slightly narrower canine rather than the old inline path.
  expect(geometry.every(r => r.crownW >= 22 && r.crownH >= 35)).toBe(true);
  const styles = await chart.evaluate(root => {
    const read = (fdi: number) => {
      const style = getComputedStyle(root.querySelector(`[data-fdi="${fdi}"] .dc-crown-outline`)!);
      const base = getComputedStyle(root.querySelector(`[data-fdi="${fdi}"] [data-layer="geometry"] use`)!);
      return { fill: base.fill, dash: style.strokeDasharray };
    };
    return { healthy: read(11), caries: read(16), unrecorded: read(18) };
  });
  expect(styles.healthy.fill).not.toBe('none');
  expect(styles.healthy.fill).not.toBe(styles.unrecorded.fill);
  expect(styles.unrecorded.dash).toBe('none');
  await expect(chart.locator('[data-fdi="18"] .dc-fdi')).toHaveText('18');
  await expect(chart.locator('[data-fdi="11"] .dc-registration')).toHaveCount(0);
  expect(styles.healthy.dash).toBe('none');
  await page.evaluate(async () => { await document.fonts.ready; });
  await map.screenshot({ path: `${ux05jEvidence}/ux05j-permanente-arcadas-1440.png`, animations: 'disabled' });
  expect(calls.filter(call => call.method !== 'GET' && call.path.includes('/odontogram'))).toHaveLength(0);
});

test('UX-05J pieza seleccionada con editor lateral', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page, 'DENTIST', { silhouetteSample: true });
  await page.goto('/patients/1');
  const chart = await dentalChart(page);
  await selectDentalPiece(chart, 16);
  await expect(chart.locator('[data-fdi="16"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.getByRole('heading', { name: 'Pieza 16', exact: true })).toBeFocused();
  const mapBox = (await chart.locator('.dc-chart-map').boundingBox())!;
  const detail = chart.locator('.dc-dental-detail');
  await expect(detail.locator('.dc-piece-editor')).toHaveCount(1);
  expect((await detail.boundingBox())!.x).toBeGreaterThanOrEqual(mapBox.x + mapBox.width);
  expect((await detail.boundingBox())!.width).toBeGreaterThanOrEqual(188);
  await page.evaluate(async () => { await document.fonts.ready; });
  await chart.screenshot({ path: `${ux05jEvidence}/ux05j-seleccion-editor-1440.png`, animations: 'disabled',
    style: 'nav[aria-label="Navegación rápida"] { visibility: hidden !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('UX-05J temporales: diez piezas por arcada, sin premolares', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page, 'DENTIST', { temporary: true });
  await page.goto('/patients/1');
  const chart = await dentalChart(page);
  await chart.getByRole('button', { name: 'Temporal', exact: true }).click();
  await selectDentalPiece(chart, 55);
  await expect(chart.locator('[data-fdi="55"] svg')).toHaveAttribute('data-family', 'molar');
  await expect(chart.locator('svg[data-family="premolar"]')).toHaveCount(0);
  await expect(chart.locator('.dc-dental-piece:visible')).toHaveCount(20);
  const mapBox = (await chart.locator('.dc-full-arcades').boundingBox())!;
  expect(mapBox.width).toBe(704);
  expect(mapBox.height).toBe(238);
  expectNoOverlap(await targetBoxes(chart));
  const order = await chart.locator('.dc-dental-piece').evaluateAll(nodes => nodes.map(node => ({
    fdi: Number(node.getAttribute('data-fdi')), arch: node.getAttribute('data-arch'),
  })));
  expect(order.filter(piece => piece.arch === 'upper').map(piece => piece.fdi))
    .toEqual([55, 54, 53, 52, 51, 61, 62, 63, 64, 65]);
  expect(order.filter(piece => piece.arch === 'lower').map(piece => piece.fdi))
    .toEqual([85, 84, 83, 82, 81, 71, 72, 73, 74, 75]);
  await page.evaluate(async () => { await document.fonts.ready; });
  await chart.locator('.dc-full-arcades').screenshot({ path: `${ux05jEvidence}/ux05j-temporal-arcadas-1440.png`, animations: 'disabled' });
  await chart.screenshot({ path: `${ux05jEvidence}/ux05j-temporal-detalle-1440.png`, animations: 'disabled',
    style: 'nav[aria-label="Navegación rápida"] { visibility: hidden !important; }' });
});

test('UX-05J móvil: cuadrante legible sin solapamientos ni desbordamiento', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await fixture(page, 'DENTIST', { silhouetteSample: true });
  await page.goto('/patients/1');
  const chart = await dentalChart(page);
  await expect(chart.getByLabel('Cuadrante')).toBeVisible();
  await expect(chart.locator('.dc-dental-piece:visible')).toHaveCount(8);
  expectNoOverlap(await targetBoxes(chart));
  await selectDentalPiece(chart, 16);
  await expect(chart.getByRole('heading', { name: 'Pieza 16', exact: true })).toBeFocused();
  const mapBox = (await chart.locator('.dc-chart-map').boundingBox())!;
  expect((await chart.locator('.dc-dental-detail').boundingBox())!.y).toBeGreaterThanOrEqual(mapBox.y + mapBox.height);
  const exterior = await chart.locator('[data-fdi="16"]').evaluate(node => {
    const crown = node.querySelector('.dc-crown-outline')!.getBoundingClientRect();
    const fdi = node.querySelector('.dc-fdi')!.getBoundingClientRect();
    return { crownTop: crown.top, fdiBottom: fdi.bottom };
  });
  expect(exterior.fdiBottom).toBeLessThanOrEqual(exterior.crownTop);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(async () => { await document.fonts.ready; });
  await chart.screenshot({ path: `${ux05jEvidence}/ux05j-movil-390.png`, animations: 'disabled',
    style: 'nav[aria-label="Navegación rápida"] { visibility: hidden !important; }' });
  await page.screenshot({ path: `${ux05jEvidence}/ux05j-movil-390-viewport.png`, animations: 'disabled' });
});

test('UX-05J solo lectura autorizada: recepción mantiene resumen restringido', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { calls } = await fixture(page, 'RECEPTIONIST');
  await page.goto('/patients/1');
  const chart = await dentalChart(page);
  await expect(chart.locator('[data-dental-renderer="shared"]')).toBeVisible();
  await selectDentalPiece(chart, 16);
  await expect(chart.getByRole('heading', { name: /Pieza 16/ })).toBeFocused();
  await expect(chart.getByLabel('Condición de la pieza')).toHaveCount(0);
  await expect(chart.getByRole('button', { name: /Guardar|Registrar|Actualizar/ })).toHaveCount(0);
  expect(calls.filter(call => call.path.includes('/odontogram')).map(call => call.path))
    .toEqual(['/api/patients/1/odontogram/reception-summary']);
  expect(calls.some(call => /\/clinical|\/history|\/at$/.test(call.path))).toBe(false);
  expectNoOverlap(await targetBoxes(chart));
  await page.evaluate(async () => { await document.fonts.ready; });
  await chart.screenshot({ path: `${ux05jEvidence}/ux05j-solo-lectura-recepcion-1440.png`, animations: 'disabled',
    style: 'nav[aria-label="Navegación rápida"] { visibility: hidden !important; }' });
});

const ux05mEvidence = process.env['DENTALCLINIC_UX05M_EVIDENCE'] ?? '../docs/ux/ux05m-evidence';

async function expectLocalAnatomyReferences(chart: Locator) {
  const result = await chart.evaluate(root => {
    const ids = Array.from(root.querySelectorAll('[id]'), node => node.id);
    const symbols = Array.from(root.querySelectorAll('.dc-tooth-symbol'));
    return {
      unique: new Set(ids).size === ids.length,
      local: symbols.every(symbol => {
        const local = new Set(Array.from(symbol.querySelectorAll('[id]'), node => node.id));
        const refs = [
          ...Array.from(symbol.querySelectorAll('use'), node => node.getAttribute('href')!.slice(1)),
          ...Array.from(symbol.innerHTML.matchAll(/url\(#([^)]+)\)/g), match => match[1]),
        ];
        return refs.length > 0 && refs.every(id => local.has(id));
      }),
      layers: symbols.every(symbol => ['geometry', 'volume', 'detail'].every(layer => symbol.querySelector(`[data-layer="${layer}"]`))),
    };
  });
  expect(result).toEqual({ unique: true, local: true, layers: true });
}

for (const width of [1440, 390]) test(`UX-05M consulta integrada, condiciones y selección ${width}`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { calls } = await fixture(page, 'DENTIST', { silhouetteSample: true, clinicalSample: true });
  await page.goto('/appointments/7');
  await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  const chart = await dentalChart(page);
  await expect(chart.locator('.dc-tooth-symbol')).toHaveCount(32);
  await expectLocalAnatomyReferences(chart);
  for (const condition of CONDITION_ORDER) {
    const symbol = chart.locator(`.dc-tooth-symbol[data-condition="${condition}"]`).first();
    await expect(symbol).toHaveCount(1);
    const styles = await symbol.evaluate(root => ({
      fill: getComputedStyle(root.querySelector('[data-layer="geometry"] use')!).fill,
      dash: getComputedStyle(root.querySelector('.dc-crown-outline')!).strokeDasharray,
      volume: getComputedStyle(root.querySelector('[data-layer="volume"]')!).opacity,
      mark: root.querySelector('.dc-condition-mark') ? getComputedStyle(root.querySelector('.dc-condition-mark')!).stroke : null,
    }));
    expect(styles.fill).not.toBe('none');
    expect(styles.dash).toBe('none');
    expect(styles.volume).toBe('0.3');
    expect(styles.mark === null).toBe(condition === 'HEALTHY');
    if (styles.mark) expect(styles.mark).not.toBe('none');
  }
  const neutral = chart.locator('[data-fdi="13"]');
  const neutralFill = () => neutral.locator('[data-layer="geometry"] use').evaluate(node => getComputedStyle(node).fill);
  expect(await neutralFill()).toBe('rgb(248, 243, 234)');
  await expect(neutral).toHaveAccessibleName(/sin registro/);
  expect(await neutral.locator('.dc-crown-outline').evaluate(node => getComputedStyle(node).strokeDasharray)).toBe('none');
  await expect(neutral.locator('.dc-fdi')).toHaveText('13');
  const caries = chart.locator('[data-fdi="16"]');
  const beforeFill = await caries.locator('[data-layer="geometry"] use').evaluate(node => getComputedStyle(node).fill);
  await selectDentalPiece(chart, 16);
  await expect(chart.getByRole('heading', { name: 'Pieza 16', exact: true })).toBeFocused();
  await expect(chart.getByLabel('Condición de la pieza')).toHaveValue('CARIES');
  expect(await caries.locator('[data-layer="geometry"] use').evaluate(node => getComputedStyle(node).fill)).toBe(beforeFill);
  await expect(caries).toHaveAttribute('aria-pressed', 'true');
  expect(await caries.evaluate(node => getComputedStyle(node, '::before').backgroundColor)).toBe('rgb(215, 233, 227)');
  expectNoOverlap(await targetBoxes(chart));
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.locator('.dc-console-work').screenshot({ path: `${ux05mEvidence}/ux05m-consulta-condiciones-editor-${width}.png`, animations: 'disabled',
    style: 'nav[aria-label="Navegación rápida"] { visibility: hidden !important; }' });
  await chart.locator('.dc-full-arcades').screenshot({ path: `${ux05mEvidence}/ux05m-condiciones-arcadas-${width}.png`, animations: 'disabled' });
  if (width === 390) await page.screenshot({ path: `${ux05mEvidence}/ux05m-consulta-movil-viewport.png`, animations: 'disabled' });
  await selectDentalPiece(chart, 13);
  expect(await neutralFill()).toBe('rgb(248, 243, 234)');
  await expect(chart.getByLabel('Condición de la pieza')).toHaveValue('');
  await expect(chart.getByRole('button', { name: 'Guardar pieza', exact: true })).toBeDisabled();
  expect(calls.filter(call => call.method !== 'GET' && call.path.includes('/odontogram'))).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('UX-05M siete familias del renderer real a 44 y 32 px, sin otra galería', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { calls } = await fixture(page, 'DENTIST');
  await page.goto('/patients/1');
  const chart = await dentalChart(page);
  for (const [dentition, fdis] of [['Permanente', [11, 13, 14, 17]], ['Temporal', [51, 53, 54]]] as const) {
    await chart.getByRole('button', { name: dentition, exact: true }).click();
    await expectLocalAnatomyReferences(chart);
    expectNoOverlap(await targetBoxes(chart));
    for (const fdi of fdis) {
      const symbol = chart.locator(`[data-fdi="${fdi}"] .dc-tooth-symbol`);
      for (const size of [44, 32]) {
        await symbol.evaluate((node, px) => { node.style.width = `${px}px`; node.style.height = `${px}px`; }, size);
        const box = (await symbol.boundingBox())!;
        // Posterior splay rotates the bounding box by at most 5 degrees.
        expect(box.width).toBeGreaterThanOrEqual(size);
        expect(box.width).toBeLessThan(size * 1.1);
        await symbol.screenshot({ path: `${ux05mEvidence}/ux05m-pieza-${fdi}-${size}px.png`, animations: 'disabled' });
      }
      await symbol.evaluate(node => { node.style.removeProperty('width'); node.style.removeProperty('height'); });
    }
    await selectDentalPiece(chart, dentition === 'Temporal' ? 55 : 16);
    await chart.screenshot({ path: `${ux05mEvidence}/ux05m-longitudinal-${dentition.toLowerCase()}-1440.png`, animations: 'disabled' });
  }
  expect(calls.filter(call => call.method !== 'GET' && call.path.includes('/odontogram'))).toHaveLength(0);
});

const ux05nEvidence = process.env['DENTALCLINIC_UX05N_EVIDENCE'] ?? '../docs/ux/ux05n-evidence';

for (const width of [1440, 390]) for (const temporary of [false, true]) test(`UX-05N contorno continuo y anatomía +12% ${temporary ? 'temporal' : 'permanente'} ${width}`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { calls, fdi } = await fixture(page, 'DENTIST', { temporary, silhouetteSample: true, clinicalSample: !temporary });
  await page.goto('/appointments/7');
  await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  const chart = await dentalChart(page);
  if (temporary) await chart.getByRole('button', { name: 'Temporal', exact: true }).click();
  await selectDentalPiece(chart, fdi);
  await expect(chart.locator(`[data-fdi="${fdi}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.getByLabel('Condición de la pieza')).toHaveValue('CARIES');
  await expect(chart.locator('.dc-tooth-symbol')).toHaveCount(temporary ? 20 : 32);
  await expectLocalAnatomyReferences(chart);
  expectNoOverlap(await targetBoxes(chart));
  const geometry = await chart.locator('.dc-dental-piece:visible').evaluateAll(buttons => buttons.map(button => {
    const crown = button.querySelector('.dc-crown-outline')!;
    const anatomy = button.querySelector('[data-anatomy]') as SVGGraphicsElement;
    const after = crown.getBoundingClientRect();
    const label = button.querySelector('.dc-fdi')!.getBoundingClientRect();
    const symbol = button.querySelector('.dc-tooth-symbol') as SVGSVGElement;
    const glyph = button.querySelector('.dc-condition-mark') as SVGGraphicsElement | null;
    const box = (r: DOMRect) => ({ x: r.x, y: r.y, w: r.width, h: r.height });
    const rootScale = symbol.getCTM()!;
    const anatomyScale = anatomy.getCTM()!;
    const markScale = glyph?.getCTM();
    return {
      growthX: Math.hypot(anatomyScale.a, anatomyScale.b) / Math.hypot(rootScale.a, rootScale.b),
      growthY: Math.hypot(anatomyScale.c, anatomyScale.d) / Math.hypot(rootScale.c, rootScale.d),
      crown: box(after), label: box(label), arch: button.getAttribute('data-arch'),
      dash: getComputedStyle(crown).strokeDasharray,
      stroke: getComputedStyle(crown).stroke,
      strokeWidth: getComputedStyle(crown).strokeWidth,
      neutral: symbol.getAttribute('data-condition') === 'UNREGISTERED',
      glyphScale: markScale ? Math.hypot(markScale.a, markScale.b) / Math.hypot(rootScale.a, rootScale.b) : 1,
      svgSize: getComputedStyle(symbol).width,
      sr: button.querySelector('.dc-registration')?.textContent ?? null,
    };
  }));
  for (const item of geometry) {
    expect(item.growthX).toBeCloseTo(1.12, 5);
    expect(item.growthY).toBeCloseTo(1.12, 5);
    expect(item.glyphScale).toBeCloseTo(1, 5);
    expect(item.svgSize).toBe(width === 1440 ? '46px' : '40px');
    expect(item.dash).toBe('none');
    expect(item.strokeWidth).toBe('0.8px');
    if (item.neutral) {
      expect(item.stroke).toBe('rgb(138, 127, 110)');
      expect(item.sr).toBeNull();
    } else expect(item.sr).toBeNull();
    expect(item.arch === 'upper' ? item.label.y + item.label.h <= item.crown.y : item.label.y >= item.crown.y + item.crown.h).toBe(true);
  }
  const crowns = geometry.map(item => item.crown);
  expect(crowns.some((a, index) => crowns.slice(index + 1).some(b => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x)
    && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y)))).toBe(false);
  const labels = geometry.map(item => item.label);
  expect(labels.some((a, index) => labels.slice(index + 1).some(b => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x)
    && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y)))).toBe(false);
  if (width === 1440) {
    const map = (await chart.locator('.dc-full-arcades').boundingBox())!;
    expect([map.width, map.height]).toEqual([704, 238]);
    expect((await chart.locator('.dc-dental-detail').boundingBox())!.x).toBeGreaterThanOrEqual((await chart.locator('.dc-chart-map').boundingBox())!.x + (await chart.locator('.dc-chart-map').boundingBox())!.width);
  }
  if (!temporary) {
    await expect(chart.locator('[data-fdi="11"]')).toHaveAccessibleName(/Sano confirmado/);
    await expect(chart.locator('[data-fdi="11"] .dc-registration')).toHaveCount(0);
  }
  await chart.getByText('Leyenda de condiciones', { exact: true }).click();
  await expect(chart.getByText('Sano confirmado', { exact: true })).toBeVisible();
  await expect(chart.getByText(/Sin registro indica ausencia de una condición registrada/)).toBeVisible();
  await chart.getByText('Leyenda de condiciones', { exact: true }).click();
  await page.evaluate(async () => { await document.fonts.ready; });
  const name = `${temporary ? 'temporal' : 'permanente'}-${width}`;
  await page.locator('.dc-console-work').screenshot({ path: `${ux05nEvidence}/ux05n-consulta-${name}.png`, animations: 'disabled',
    style: 'nav[aria-label="Navegación rápida"] { visibility: hidden !important; }' });
  await chart.locator('.dc-full-arcades').screenshot({ path: `${ux05nEvidence}/ux05n-arcadas-${name}.png`, animations: 'disabled' });
  expect(calls.filter(call => call.method !== 'GET' && call.path.includes('/odontogram'))).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

async function expectSelectionOnCrown(button: Locator) {
  await expect.poll(() => button.evaluate(node => {
    const target = node.getBoundingClientRect();
    const crown = node.querySelector('.dc-crown-outline')!.getBoundingClientRect();
    const label = node.querySelector('.dc-fdi')!.getBoundingClientRect();
    const oval = getComputedStyle(node, '::before');
    const line = getComputedStyle(node, '::after');
    const cx = crown.x + crown.width / 2;
    const cy = crown.y + crown.height / 2;
    return Math.max(
      Math.abs(target.x + node.clientLeft + parseFloat(oval.left) - cx),
      Math.abs(target.y + node.clientTop + parseFloat(oval.top) - cy),
      Math.abs(target.x + node.clientLeft + parseFloat(line.left) - cx),
      Math.abs(target.y + node.clientTop + parseFloat(line.top) - Math.max(crown.bottom, label.bottom) - 2),
    );
  })).toBeLessThan(0.15);
  const styles = await button.evaluate(node => {
    const oval = getComputedStyle(node, '::before'), line = getComputedStyle(node, '::after');
    const number = getComputedStyle(node.querySelector('.dc-fdi')!);
    const crown = node.querySelector('.dc-crown-outline')!.getBoundingClientRect();
    const target = node.getBoundingClientRect();
    const label = node.querySelector('.dc-fdi')!.getBoundingClientRect();
    const lineBottom = target.y + node.clientTop + parseFloat(line.top) + parseFloat(line.height);
    return {
      background: getComputedStyle(node).backgroundColor, shadow: getComputedStyle(node).boxShadow,
      ovalFill: oval.backgroundColor, radius: oval.borderRadius, lineWidth: line.width, lineHeight: line.height,
      numberFill: number.backgroundColor, numberColor: number.color,
      clearOfLabel: node.getAttribute('data-arch') === 'upper' ? label.bottom <= crown.top : lineBottom - parseFloat(line.height) >= label.bottom + 1,
    };
  });
  expect(styles).toEqual({
    background: 'rgba(0, 0, 0, 0)', shadow: 'none', ovalFill: 'rgb(215, 233, 227)', radius: '50%',
    lineWidth: '14px', lineHeight: '2px', numberFill: 'rgba(0, 0, 0, 0)', numberColor: 'rgb(77, 82, 84)', clearOfLabel: true,
  });
}

for (const width of [1440, 390]) for (const temporary of [false, true]) test(`UX-05O numeración, selección alineada y teclado ${temporary ? 'temporal' : 'permanente'} ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const { calls, fdi } = await fixture(page, 'DENTIST', { temporary, silhouetteSample: true });
  await page.goto('/appointments/7');
  await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  const chart = await dentalChart(page);
  if (temporary) await chart.getByRole('button', { name: 'Temporal', exact: true }).click();
  await expect(chart.locator('.dc-dental-piece[aria-pressed="true"]')).toHaveCount(0);
  const labels = await chart.locator('.dc-fdi').allTextContents();
  expect(labels.every(label => /^\d{2}$/.test(label))).toBe(true);
  await expect(chart.locator('.dc-registration')).toHaveCount(0);
  await page.evaluate(async () => { await document.fonts.ready; });
  const name = `${temporary ? 'temporal' : 'permanente'}-${width}`;
  const shot = async (state: string) => {
    await page.mouse.move(0, 0);
    await page.locator('.dc-console-work').screenshot({
      path: `../docs/ux/ux05o-evidence/ux05o-${state}-${name}.png`, animations: 'disabled',
      style: 'nav[aria-label="Navegación rápida"] { visibility: hidden !important; }',
    });
  };
  await shot('sin-seleccion');
  const readGeometry = () => chart.locator('.dc-dental-piece:visible').evaluateAll(nodes => {
    const origin = nodes[0].closest('.dc-full-arcades')!.getBoundingClientRect();
    return nodes.map(node => {
      const label = node.querySelector('.dc-fdi')!.getBoundingClientRect();
      const crown = node.querySelector('.dc-crown-outline')!.getBoundingClientRect();
      return { fdi: node.getAttribute('data-fdi'), label: [label.x - origin.x, label.y - origin.y, label.width, label.height],
        crown: [crown.x - origin.x, crown.y - origin.y, crown.width, crown.height],
        fill: getComputedStyle(node.querySelector('[data-layer="geometry"] use')!).fill };
    });
  });
  const samples = temporary ? [55, 53, 85, 83] : [16, 13, 46, 43, 18];
  for (const tooth of samples) {
    const quadrant = chart.getByLabel('Cuadrante', { exact: true });
    if (await quadrant.isVisible()) await quadrant.selectOption(Math.floor(tooth / 10) % 4 === 1 ? '0' : Math.floor(tooth / 10) % 4 === 0 ? '2' : '3');
    const before = await readGeometry();
    await selectDentalPiece(chart, tooth);
    const button = chart.locator(`[data-fdi="${tooth}"]`);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expectSelectionOnCrown(button);
    const after = await readGeometry();
    expect(after).toHaveLength(before.length);
    for (const [index, item] of after.entries()) {
      expect(item.fill).toBe(before[index].fill);
      for (const key of ['label', 'crown'] as const) item[key].forEach((value, coord) => expect(value).toBeCloseTo(before[index][key][coord], 2));
    }
    if (tooth === fdi) {
      await expect(chart.getByLabel('Condición de la pieza')).toHaveValue('CARIES');
      await shot('seleccion');
      await chart.locator('.dc-full-arcades').screenshot({ path: `../docs/ux/ux05o-evidence/ux05o-arcadas-seleccion-${name}.png`, animations: 'disabled' });
    }
  }
  await chart.getByRole('button', { name: `Cerrar edición de la pieza ${samples.at(-1)}`, exact: true }).click();
  await expect(chart.locator('.dc-dental-piece[aria-pressed="true"]')).toHaveCount(0);
  await page.keyboard.press('Tab');
  const focused = chart.locator('.dc-dental-piece:focus-visible');
  await expect(focused).toHaveCount(1);
  await expect(focused).toHaveAttribute('aria-pressed', 'false');
  expect(await focused.evaluate(node => getComputedStyle(node).outlineWidth)).toBe('2px');
  expect(await focused.evaluate(node => getComputedStyle(node, '::before').content)).toBe('none');
  await page.keyboard.press('Enter');
  await expect(chart.getByRole('heading', { name: /^Pieza \d+$/ })).toBeFocused();
  await expectSelectionOnCrown(chart.locator('.dc-dental-piece[aria-pressed="true"]'));
  if (width === 1440) {
    await page.setViewportSize({ width: 390, height: 1000 });
    await expect(chart.getByLabel('Cuadrante', { exact: true })).toBeVisible();
    await expectSelectionOnCrown(chart.locator('.dc-dental-piece[aria-pressed="true"]'));
  }
  expect(calls.filter(call => call.method !== 'GET' && call.path.includes('/odontogram'))).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
