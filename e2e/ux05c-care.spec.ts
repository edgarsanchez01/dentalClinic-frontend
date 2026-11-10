import { expect, test, type Page } from '@playwright/test';
import { checkoutAppointment as a, checkoutContext, collectionResult, contextCharge } from '../src/test/checkoutFixtures';
import type { AppointmentFinancialContext, CollectionInput, CollectionState } from '../src/api/collection';

const empty = { content: [], page: 0, size: 20, totalPages: 0, totalElements: 0 };
type Options = { role?: string; dentistId?: number; completed?: boolean; lostComplete?: boolean; lostCollection?: boolean; error?: number; context?: AppointmentFinancialContext; reviewReason?: string; state?: CollectionState };
async function fixture(page: Page, options: Options = {}) {
  const calls: { path: string; method: string; body: CollectionInput | null; raw: string | null; key?: string }[] = [];
  let status = options.completed ? 'COMPLETED' : 'SCHEDULED';
  let context = options.context ?? checkoutContext(); let completes = 0; let collections = 0; let note = '';
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const body = req.postDataJSON(); calls.push({ path, method, body, raw: req.postData(), key: req.headers()['idempotency-key'] });
    const send = (json: unknown, code = 200) => route.fulfill({ status: code, json });
    if (path === '/api/auth/refresh') return send({ accessToken: 'care-mock' });
    if (path === '/api/auth/me') return send({ id: 2, role: options.role ?? 'DENTIST', dentistId: options.dentistId ?? 3, active: true, email: 'synthetic@care.test', createdAt: a.createdAt });
    if (path === '/api/onboarding/status') return send({ status: 'COMPLETED', clinicConfigured: true });
    if (path === '/api/public/schedule') return send({ timezone: 'UTC', days: [], dentists: [], exceptions: [] });
    if (path === '/api/notifications/unread-count') return send({ unread: 0 });
    if (path === '/api/notifications') return send(empty);
    if (path === '/api/appointments/collection-queue') {
      const active = context.charges.find(c => c.status !== 'ANULADO');
      const state = options.state ?? (active ? active.status === 'PAGADO' ? 'SETTLED' : active.status === 'PARCIAL' ? 'PARTIAL' : 'PENDING' : 'NO_CHARGE');
      const row = { appointment: { ...a, status: 'COMPLETED' }, collectionState: state, hasRecordedCharge: Boolean(active), activeChargeId: active?.id ?? null,
        totalAmount: state === 'REVIEW_REQUIRED' ? null : active?.totalAmount ?? null, appliedAmount: state === 'REVIEW_REQUIRED' ? null : active?.appliedAmount ?? null, pendingBalance: state === 'REVIEW_REQUIRED' ? null : active?.pendingBalance ?? null,
        currency: active ? 'MXN' : null, financialContextToken: context.financialContextToken, reviewReason: options.reviewReason ?? null };
      return send({ ...empty, content: [row], totalElements: 1, totalPages: 1, observedAt: a.startAt, summary: { counts: { NO_CHARGE: 0, PENDING: 0, PARTIAL: 0, SETTLED: 0, REVIEW_REQUIRED: 0, [state]: 1 }, completedCount: 1, verifiedPendingBalance: state === 'REVIEW_REQUIRED' ? '0' : active?.pendingBalance ?? '0', currency: 'MXN' } });
    }
    if (path === '/api/appointments') {
      const content = url.searchParams.get('status') && url.searchParams.get('status') !== status ? [] : [{ ...a, status }];
      return send({ ...empty, content, totalElements: content.length, totalPages: content.length ? 1 : 0 });
    }
    if (path === '/api/appointments/7') return send({ ...a, status, ...(status === 'COMPLETED' ? { completedAt: a.endAt } : {}) });
    if (path.endsWith('/complete')) {
      completes++; if (options.error) return send({ code: 'APPOINTMENT_CONFLICT' }, options.error);
      status = 'COMPLETED'; if (options.lostComplete && completes === 1) return route.abort('failed');
      return send({ ...a, status, completedAt: a.endAt });
    }
    if (path.endsWith('/financial-context')) return send(context);
    if (path.endsWith('/collection')) {
      collections++; if (options.error) return send({ code: 'COLLECTION_CONFLICT' }, options.error);
      const paid = body.payment.action === 'REGISTER' ? Number(body.payment.amount) : 0;
      const applied = Number(context.charges[0]?.appliedAmount ?? 0) + paid;
      const f = { ...collectionResult().financialAtCollection, chargeDisposition: body.charge.action === 'REUSE' ? 'REUSED' as const : 'CREATED' as const, appliedAmount: String(applied), pendingBalance: String(500 - applied), status: applied === 500 ? 'PAGADO' as const : applied ? 'PARCIAL' as const : 'PENDIENTE' as const,
        ...(paid ? { paymentId: 31, paymentMethod: body.payment.method, paymentAmount: String(paid) } : {}) };
      if (options.lostCollection && collections === 1) return route.abort('failed');
      context = checkoutContext({ associationState: 'SINGLE_ACTIVE', chargeCount: 1, financialContextToken: `v1:${'b'.repeat(64)}`, charges: [contextCharge({ appliedAmount: f.appliedAmount, pendingBalance: f.pendingBalance, status: f.status })] });
      return send(collectionResult({ financialAtCollection: f }));
    }
    if (path.endsWith('/clinical')) return send({ patientId: 1, allergies: 'Información sintética' });
    if (path.endsWith('/odontogram/history')) return send(empty);
    if (path.endsWith('/notes')) { if (method === 'POST') note = body.content; return send(method === 'POST' ? { id: 1, ...body } : []); }
    if (path.endsWith('/trace')) {
      const content = note && url.searchParams.get('section') === 'NOTES' ? [{ recordId: 1, originalEntry: { id: 1 }, currentEntry: { id: 1, content: note, createdAt: a.startAt, authorName: 'Profesional', appointmentContext: { statusAtRegistration: 'SCHEDULED' } }, corrections: [] }] : [];
      return send({ context: { appointmentId: 7, occurrenceVersion: 1, currentOccurrenceVersion: 1, currentStatus: status, kind: 'CURRENT_UNFROZEN' }, availableSections: ['NOTES', 'EVOLUTIONS'], section: url.searchParams.get('section'), results: { ...empty, content, totalElements: content.length } });
    }
    if (path.endsWith('/events') || path.endsWith('/treatments') || path.endsWith('/exceptions') || path.endsWith('/time-off')) return send([]);
    if (path.includes('/schedules/')) return send({ timezone: 'UTC', days: [] });
    if (path === '/api/services') return send([]); if (path === '/api/patients') return send(empty);
    return send({ message: 'API no contemplada' }, 404);
  });
  return { calls, setContext: (value: AppointmentFinancialContext) => { context = value; } };
}
async function reviewClinical(page: Page) {
  await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  await page.getByRole('button', { name: 'Finalizar atención', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Finalizar atención' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Finalizar atención', exact: true })).toBeFocused();
}
async function reviewCollection(page: Page) {
  await page.getByRole('checkbox', { name: /Confirmo expresamente/ }).check();
  await page.getByRole('button', { name: 'Revisar cobro' }).click();
  await expect(page.getByRole('heading', { name: 'Revisar cobro', exact: true })).toBeFocused();
}
const writes = (calls: Awaited<ReturnType<typeof fixture>>['calls'], endpoint: string) => calls.filter(c => c.method === 'POST' && c.path.endsWith(endpoint));

for (const width of [1440, 768, 390, 320]) test(`detalle → herramientas independientes → diálogo → complete → agenda (${width}px)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); const { calls } = await fixture(page);
  const agenda = '/appointments?view=day&date=2026-10-22&status=SCHEDULED';
  await page.goto(agenda); await page.getByRole('button', { name: /Abrir cita de Ana/ }).click();
  await expect(page.getByRole('heading', { name: 'Detalle de cita', exact: true })).toBeVisible();
  await expect(page.getByLabel('Contenido de la nota')).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir consulta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Consulta clínica', exact: true })).toBeFocused();
  const finish = page.getByRole('button', { name: 'Finalizar atención', exact: true });
  const size = await finish.boundingBox(); expect(size!.height).toBeGreaterThanOrEqual(44); expect(size!.width).toBeGreaterThanOrEqual(44);
  const contrast = await finish.evaluate(element => {
    const css = getComputedStyle(element);
    const luminance = (color: string) => {
      const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(v => Number(v) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
      return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
    };
    const a = luminance(css.color), b = luminance(css.backgroundColor);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  if (width === 1440 || width === 390) await page.screenshot({ path: `/tmp/opencode/ux05d-workspace-${width}.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Finalizar atención', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveCount(0);
  await page.keyboard.press('Tab'); await expect(page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('dialog').getByRole('button', { name: 'Confirmar finalización', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
  expect(writes(calls, '/complete')).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (width === 1440 || width === 390) await page.screenshot({ path: `/tmp/opencode/ux05d-confirmation-${width}.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Confirmar finalización' }).click(); await expect(page).toHaveURL(agenda);
  await expect(page.getByRole('button', { name: /Abrir cita de Ana/ })).toHaveCount(0);
  expect(writes(calls, '/complete')).toHaveLength(1); expect(writes(calls, '/complete')[0]!.body).toEqual({ expectedOccurrenceVersion: 1 });
  expect(calls.some(c => /checkout|collection$|financial-context|charges/.test(c.path))).toBe(false);
});
test('borradores sobreviven herramientas/diálogo, bloquean finalización y protegen Back', async ({ page }) => {
  const { calls } = await fixture(page); await page.goto('/appointments/7');
  await page.getByRole('button', { name: 'Abrir consulta' }).click();
  await page.getByLabel('Contenido de la nota').fill('No guardar automáticamente');
  await expect(page.getByRole('region', { name: 'Tratamientos del paciente' })).toBeVisible();
  await page.getByRole('button', { name: 'Finalizar atención', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirmar finalización' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Finalizar atención', exact: true })).toBeFocused();
  await expect(page.getByLabel('Contenido de la nota')).toHaveValue('No guardar automáticamente');
  await page.getByRole('link', { name: 'Volver a Agenda', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByLabel('Contenido de la nota')).toHaveValue('No guardar automáticamente');
  await page.getByRole('button', { name: 'Guardar nota', exact: true }).click(); await expect(page.getByText(/Nota clínica guardada/)).toBeVisible();
  await page.getByRole('button', { name: 'Finalizar atención', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.dc-activity-counts').getByText('1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar finalización' }).click(); await expect(page).toHaveURL('/appointments');
  expect(writes(calls, '/notes')).toHaveLength(1);
});
test('complete incierto conserva identidad tras salir de la vista y volver', async ({ page }) => {
  const { calls } = await fixture(page, { lostComplete: true });
  const agenda = '/appointments?view=day&date=2026-10-22';
  await page.goto(agenda); await page.getByRole('button', { name: /Abrir cita de Ana/ }).click(); await reviewClinical(page);
  await page.getByRole('button', { name: 'Confirmar finalización' }).click(); await expect(page.getByText(/Resultado incierto/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('link', { name: 'Volver a Agenda', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Operación pendiente de verificar' })).toBeVisible(); await page.getByRole('button', { name: 'Salir de esta vista' }).click();
  await page.getByRole('button', { name: /Abrir cita de Ana/ }).click(); await expect(page.getByText(/Resultado incierto/)).toBeVisible();
  await page.getByRole('button', { name: 'Recuperar con la misma solicitud' }).click(); await expect(page).toHaveURL(agenda);
  const p = writes(calls, '/complete'); expect(p).toHaveLength(2); expect(p[1]!.raw).toBe(p[0]!.raw); expect(p[1]!.key).toBe(p[0]!.key);
});
for (const role of ['RECEPTIONIST', 'OWNER']) test(`${role} encuentra atención sin cargo y registra pago parcial`, async ({ page }) => {
  await page.setViewportSize({ width: role === 'OWNER' ? 1440 : 390, height: 900 });
  const { calls } = await fixture(page, { role, dentistId: 99, completed: true }); await page.goto('/collections');
  await expect(page.getByText('Sin importe de deuda registrado. El precio de referencia no es un cargo.')).toBeVisible();
  await page.getByRole('link', { name: /Ana.*Atención #7/ }).click();
  await page.getByRole('radio', { name: 'Pago parcial' }).check(); await page.getByLabel('Importe abonado (MXN)').fill('200.01'); await reviewCollection(page);
  await page.screenshot({ path: `/tmp/opencode/ux05c-collection-${role === 'RECEPTIONIST' ? 'mobile' : 'desktop'}.png`, fullPage: true });
  expect(writes(calls, '/collection')).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirmar cobro', exact: true }).click(); await expect(page.getByText(/Cobro confirmado por el servidor/)).toBeVisible();
  await expect(page.getByText('$299.99 MXN', { exact: true })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(calls.some(c => /clinical|odontogram|complete$|checkout/.test(c.path))).toBe(false);
});
test('OWNER registra abono posterior sobre cargo existente', async ({ page }) => {
  const { calls } = await fixture(page, { role: 'OWNER', dentistId: 99, completed: true, context: checkoutContext({ associationState: 'SINGLE_ACTIVE', chargeCount: 1, charges: [contextCharge()] }) });
  await page.goto('/collections/7'); await page.getByRole('radio', { name: 'Pago completo' }).check(); await reviewCollection(page); await page.getByRole('button', { name: 'Confirmar cobro', exact: true }).click();
  await expect(page.getByText(/Cobro confirmado por el servidor/)).toBeVisible(); expect(writes(calls, '/collection')[0]!.body).toMatchObject({ charge: { action: 'REUSE', chargeId: 20 }, payment: { amount: 400 } });
});
test('cobro incierto recupera exactamente el mismo cuerpo y clave, sin otra operación clínica', async ({ page }) => {
  const { calls } = await fixture(page, { role: 'RECEPTIONIST', completed: true, lostCollection: true }); await page.goto('/collections/7');
  await page.getByRole('radio', { name: 'Pago completo' }).check(); await reviewCollection(page);
  await page.getByRole('button', { name: 'Confirmar cobro', exact: true }).click(); await expect(page.getByText(/Resultado incierto/)).toBeVisible();
  await page.getByRole('button', { name: 'Verificar estado del servidor' }).click();
  await expect(page.getByText(/Esta lectura no prueba/)).toBeVisible();
  await page.getByRole('button', { name: 'Recuperar con la misma solicitud' }).click(); await expect(page.getByText(/Cobro confirmado por el servidor/)).toBeVisible();
  const p = writes(calls, '/collection'); expect(p).toHaveLength(2); expect(p[1]!.raw).toBe(p[0]!.raw); expect(p[1]!.key).toBe(p[0]!.key);
  expect(calls.some(c => /complete$|checkout|clinical|odontogram/.test(c.path))).toBe(false);
});
test('contexto obsoleto requiere volver a consentir sin crear cargo', async ({ page }) => {
  const f = await fixture(page, { role: 'RECEPTIONIST', completed: true }); await page.goto('/collections/7');
  await page.getByRole('checkbox', { name: /Confirmo expresamente/ }).check();
  f.setContext(checkoutContext({ financialContextToken: `v1:${'b'.repeat(64)}` }));
  await page.getByRole('button', { name: 'Revisar cobro', exact: true }).click();
  await expect(page.getByText(/El contexto cambió/)).toBeVisible(); await expect(page.getByRole('checkbox')).not.toBeChecked();
  expect(writes(f.calls, '/collection')).toHaveLength(0);
});
test('varios cargos activos bloquean la confirmación y dirigen a administración', async ({ page }) => {
  const first = contextCharge(); const second = contextCharge({ id: 22, items: [{ ...first.items[0]!, chargeId: 22 }], movements: [] });
  const f = await fixture(page, { role: 'RECEPTIONIST', completed: true, context: checkoutContext({ associationState: 'MULTIPLE_ACTIVE', chargeCount: 2, charges: [first, second] }) });
  await page.goto('/collections/7'); await expect(page.getByText(/Hay varios cargos activos/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Revisar en gestión administrativa' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revisar cobro', exact: true })).toHaveCount(0); expect(writes(f.calls, '/collection')).toHaveLength(0);
});
for (const [state, reason] of [['NO_CHARGE', 'ECONOMIC_REFERENCE_REQUIRED'], ['REVIEW_REQUIRED', 'MULTIPLE_ACTIVE_CHARGES'], ['REVIEW_REQUIRED', 'FINANCIAL_CONTEXT_UNAVAILABLE']] as const) test(`${state}: ${reason} no inventa importes`, async ({ page }) => {
  await fixture(page, { role: 'RECEPTIONIST', completed: true, state, reviewReason: reason }); await page.goto('/collections');
  await expect(page.getByRole('link', { name: 'Gestión administrativa de esta atención' })).toBeVisible();
  await expect(page.locator('.collection-rows').getByText(/MXN/)).toHaveCount(0);
});
test('recepción no termina clínicamente; doctor no consulta ni confirma cobros', async ({ page }) => {
  let f = await fixture(page, { role: 'RECEPTIONIST' }); await page.goto('/appointments/7?clinical=1');
  await expect(page.getByRole('heading', { name: 'Cita #7' })).toBeVisible(); await expect(page.getByText('Terminar atención', { exact: true })).toHaveCount(0);
  expect(f.calls.some(c => /clinical|odontogram/.test(c.path))).toBe(false);
  await page.unrouteAll(); f = await fixture(page); await page.goto('/collections/7');
  await expect(page.getByText('Tu cuenta no tiene permisos para esta sección.')).toBeVisible();
  expect(f.calls.some(c => /collection-queue|financial-context|collection$/.test(c.path))).toBe(false);
});
