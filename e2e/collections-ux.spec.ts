import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { checkoutAppointment, checkoutContext, collectionResult, contextCharge } from '../src/test/checkoutFixtures';
import type { AppointmentFinancialContext, CollectionInput } from '../src/api/collection';

const out = '/tmp/opencode/dc-collections-two-step';
type Call = { path: string; method: string; search: string; raw: string | null; key: string | undefined };
async function fixture(page: Page, role: 'OWNER' | 'RECEPTIONIST') {
  const calls: Call[] = [], unexpected: string[] = [];
  const mode = { error: false, empty: false, lost: false, blocked: false, missing: false, settled: false };
  const results = new Map<string, { raw: string; result: ReturnType<typeof collectionResult> }>();
  const a = (id: number) => ({ ...checkoutAppointment, id, status: 'COMPLETED', completedAt: checkoutAppointment.endAt });
  function context(id: number): AppointmentFinancialContext {
    if (mode.missing || id === 7) return checkoutContext({ appointmentId: id, ...(mode.missing ? { service: null } : {}) });
    const charge = contextCharge({ appointmentId: id, ...(mode.settled ? { status: 'PAGADO', appliedAmount: '500', pendingBalance: '0' } : {}) });
    if (mode.blocked || id === 9) return checkoutContext({ appointmentId: id, associationState: 'MULTIPLE_ACTIVE', chargeCount: 2, charges: [charge, contextCharge({ id: 22, appointmentId: id, items: [{ ...charge.items[0]!, chargeId: 22 }], movements: [] })] });
    return checkoutContext({ appointmentId: id, associationState: 'SINGLE_ACTIVE', chargeCount: 1, charges: [charge] });
  }
  await page.clock.setFixedTime(new Date('2026-10-30T12:00:00Z'));
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const raw = req.postData(), key = req.headers()['idempotency-key'];
    calls.push({ path, method, search: url.search, raw, key });
    const send = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (path === '/api/auth/refresh') return send({ accessToken: 'collections-ux-synthetic' });
    if (method !== 'GET' && !/^\/api\/appointments\/\d+\/collection$/.test(path)) {
      unexpected.push(`${method} ${path}`); return route.abort('blockedbyclient');
    }
    if (path === '/api/auth/me') return send({ id: 2, role, dentistId: 99, active: true, email: 'synthetic@example.test', createdAt: checkoutAppointment.createdAt });
    if (path === '/api/onboarding/status') return send({ status: 'COMPLETED', clinicConfigured: true });
    if (path === '/api/notifications/unread-count') return send({ unread: 0 });
    if (path === '/api/public/schedule') return send({ timezone: 'America/Mexico_City', days: [], exceptions: [], dentists: [{ dentistId: 3, firstName: 'Olivia', lastName: 'Profesional de prueba', days: [] }] });
    if (path === '/api/patients/1') return send({ id: 1, firstName: 'Ana', lastName: 'Paciente de prueba', active: true });
    if (path === '/api/appointments/collection-queue') {
      if (mode.error) return send({ message: 'Sin conexión' }, 503);
      const rows = Array.from({ length: 42 }, (_, i) => {
        const id = i + 7, financial = id !== 7 && id !== 9;
        return { appointment: a(id), collectionState: id === 7 ? 'NO_CHARGE' : id === 9 ? 'REVIEW_REQUIRED' : 'PARTIAL',
          hasRecordedCharge: financial, activeChargeId: financial ? 20 : null, totalAmount: financial ? '500.00' : null,
          appliedAmount: financial ? '100.00' : null, pendingBalance: financial ? '400.00' : null, currency: financial ? 'MXN' : null,
          financialContextToken: null, reviewReason: id === 9 ? 'MULTIPLE_ACTIVE_CHARGES' : null };
      });
      const filtered = mode.empty ? [] : rows.filter(row => !url.searchParams.has('state') || row.collectionState === url.searchParams.get('state'));
      const current = Number(url.searchParams.get('page') ?? 0);
      return send({ page: current, size: 20, totalPages: Math.ceil(filtered.length / 20), totalElements: filtered.length,
        content: filtered.slice(current * 20, (current + 1) * 20), observedAt: checkoutAppointment.endAt,
        summary: { completedCount: 42, verifiedPendingBalance: '16000.00', currency: 'MXN', counts: { NO_CHARGE: 1, PENDING: 0, PARTIAL: 40, REVIEW_REQUIRED: 1, SETTLED: 0 } } });
    }
    const match = path.match(/^\/api\/appointments\/(\d+)(?:\/(financial-context|collection|events))?$/);
    if (match) {
      const id = Number(match[1]);
      if (!match[2]) return send(a(id));
      if (match[2] === 'events') return send([]);
      if (match[2] === 'financial-context') return send(context(id));
      if (match[2] === 'collection' && method === 'POST') {
        if (!key) { unexpected.push('Missing idempotency key'); return send({}, 400); }
        const previous = results.get(key);
        if (previous) { expect(raw).toBe(previous.raw); return send(previous.result); }
        const input = req.postDataJSON() as CollectionInput;
        const paid = input.payment.action === 'REGISTER' ? Number(input.payment.amount) : 0;
        const applied = (input.charge.action === 'REUSE' ? 100 : 0) + paid;
        const result = collectionResult({ appointmentId: id, financialAtCollection: {
          ...collectionResult().financialAtCollection, appointmentId: id,
          chargeDisposition: input.charge.action === 'REUSE' ? 'REUSED' : 'CREATED',
          appliedAmount: applied.toFixed(2), pendingBalance: (500 - applied).toFixed(2), status: applied === 500 ? 'PAGADO' : applied ? 'PARCIAL' : 'PENDIENTE',
          ...(input.payment.action === 'REGISTER' ? { paymentId: 31, paymentMethod: input.payment.method, paymentAmount: paid.toFixed(2) } : {}),
        } });
        results.set(key, { raw: raw!, result });
        if (mode.lost) { mode.lost = false; return route.abort('failed'); }
        return send(result);
      }
    }
    if (path === '/api/charges' || path === '/api/patients' || path === '/api/notifications') return send({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 });
    if (path === '/api/services') return send([]);
    // OWNER's existing detail may read clinical tools; Collections itself must not.
    const trace = path.match(/^\/api\/patients\/1\/clinical\/appointments\/(\d+)\/trace$/);
    if (trace) return send({ context: { appointmentId: Number(trace[1]), occurrenceVersion: 1, currentOccurrenceVersion: 1, currentStatus: 'COMPLETED', kind: 'CURRENT_UNFROZEN' }, availableSections: ['NOTES', 'EVOLUTIONS'], section: url.searchParams.get('section'), results: { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 } });
    if (/\/patients\/\d+\/(clinical|odontogram|treatments|notes|evolutions|trace)/.test(path)) return send(path.endsWith('/clinical') ? { patientId: 1 } : []);
    unexpected.push(`${method} ${path}`); return send({}, 404);
  });
  return { mode, calls, unexpected };
}
const writes = (calls: Call[]) => calls.filter(call => call.method === 'POST' && call.path.endsWith('/collection'));
async function ready(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await Promise.all([400, 500, 600].map(weight => document.fonts.load(`${weight} 16px "IBM Plex Sans"`)));
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}
async function recipe(page: Page) {
  await page.mouse.move(0, 0);
  return page.locator('.collection-page').evaluate(root => {
    const origin = root.getBoundingClientRect();
    return [root, ...root.querySelectorAll<HTMLElement>('*')].filter(el => el.getClientRects().length).map(el => {
      const c = getComputedStyle(el), r = el.getBoundingClientRect();
      return [el.tagName, el.getAttribute('class'), Math.round(r.x - origin.x), Math.round(r.y - origin.y), Math.round(r.width), Math.round(r.height), c.color, c.backgroundColor, c.fontSize, c.fontFamily, c.padding, c.gap, c.borderRadius];
    });
  });
}
async function review(page: Page) {
  await expect(page.getByRole('checkbox', { name: /Confirmo expresamente/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Revisar cobro', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Revisar y confirmar', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Confirmar cobro' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Confirmo expresamente/ }).check();
  await expect(page.getByRole('button', { name: 'Confirmar cobro' })).toBeEnabled();
}

for (const width of [1440, 768, 390]) test(`composición idéntica y journeys OWNER/RECEPTIONIST a ${width}px`, async ({ context }) => {
  const recipes: unknown[][] = [];
  for (const role of ['OWNER', 'RECEPTIONIST'] as const) {
    const page = await context.newPage(); await page.setViewportSize({ width, height: 1000 });
    const f = await fixture(page, role);
    await page.goto('/collections');
    await expect(page.getByRole('list', { name: 'Atenciones completadas' })).toBeVisible(); await ready(page);
    const toggle = page.getByRole('button', { name: 'Más filtros' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const rows = page.getByRole('list', { name: 'Atenciones completadas' }).locator(':scope > li');
    await expect(rows.first().getByText(/Sin importe de deuda registrado/)).toBeVisible();
    await expect(rows.first().locator('.collection-money-value')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Actualizar bandeja' })).toBeEnabled();
    const queueRecipe = await recipe(page);
    const selector = page.getByLabel('Estado financiero');
    expect(await selector.evaluate(el => {
      const wrapper = el.parentElement!.getBoundingClientRect(), r = el.getBoundingClientRect();
      return Math.round(wrapper.right - r.right);
    })).toBe(13);
    await toggle.click();
    await page.getByLabel('Profesional').selectOption('3');
    await page.getByLabel('Desde (fecha de atención)').fill('2026-10-22');
    await page.getByLabel('Hasta (incluye ese día)').fill('2026-10-22');
    await page.getByLabel('Estado financiero').selectOption('PARTIAL');
    const count = f.calls.filter(c => c.path.endsWith('collection-queue')).length;
    await toggle.click(); await toggle.click();
    await expect(page.getByLabel('Desde (fecha de atención)')).toHaveValue('2026-10-22');
    expect(f.calls.filter(c => c.path.endsWith('collection-queue'))).toHaveLength(count);
    await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).click();
    await expect(page.getByText('40 atenciones con los filtros aplicados.')).toBeVisible();
    const applied = new URL(page.url()).searchParams;
    expect(applied.get('from')).toBe('2026-10-22T06:00:00.000Z'); expect(applied.get('to')).toBe('2026-10-23T06:00:00.000Z');
    await page.getByRole('button', { name: 'Página siguiente' }).click(); await expect(page.getByText('Página 2 de 2')).toBeVisible();
    const returnTo = new URL(page.url()).pathname + new URL(page.url()).search;
    await rows.first().getByRole('link', { name: 'Ver detalle de la cita' }).click();
    await expect(page.getByRole('heading', { name: /^Cita #/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Volver a atenciones por cobrar' })).toHaveAttribute('href', returnTo);
    await page.getByRole('link', { name: 'Volver a atenciones por cobrar' }).click();
    await expect(page).toHaveURL(returnTo); await expect(page.getByText('Página 2 de 2')).toBeVisible();
    await rows.first().getByRole('link', { name: 'Gestionar cobro', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Preparar cobro' })).toBeVisible(); await ready(page);
    await expect(page.getByRole('button', { name: 'Revisar cobro' })).toBeEnabled();
    const workspaceRecipe = await recipe(page); recipes.push([queueRecipe, workspaceRecipe]);
    await expect(page.getByRole('list', { name: 'Progreso del cobro' }).locator('li')).toHaveCount(2);
    await expect(page.getByRole('checkbox', { name: /Confirmo expresamente/ })).toHaveCount(0);
    if ((width === 1440 && role === 'OWNER') || (width === 390 && role === 'RECEPTIONIST')) await page.screenshot({ path: `${out}/prepare-${role}-${width}.png`, fullPage: true });
    await page.getByText('Conceptos y pagos anteriores', { exact: true }).click();
    await expect(page.getByText('Pago #30', { exact: false })).toBeVisible();
    await page.getByRole('radio', { name: 'Pago parcial', exact: true }).check();
    await page.getByLabel('Importe abonado (MXN)').fill('123.45');
    await page.getByLabel('Método de pago').selectOption('TRANSFER');
    await page.getByRole('link', { name: 'Volver a atenciones por cobrar' }).click();
    await expect(page.getByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeVisible();
    await page.getByRole('button', { name: 'Seguir aquí' }).click();
    await expect(page.getByLabel('Importe abonado (MXN)')).toHaveValue('123.45');
    await review(page); expect(writes(f.calls)).toHaveLength(0);
    await page.getByRole('button', { name: 'Anterior', exact: true }).click();
    await expect(page.getByLabel('Importe abonado (MXN)')).toHaveValue('123.45'); await expect(page.getByLabel('Método de pago')).toHaveValue('TRANSFER');
    await review(page); await ready(page);
    recipes.at(-1)!.push(await recipe(page));
    if ((width === 1440 && role === 'OWNER') || (width === 390 && role === 'RECEPTIONIST')) await page.screenshot({ path: `${out}/review-${role}-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Confirmar cobro', exact: true }).click();
    await expect(page.getByText(/Cobro confirmado por el servidor/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Progreso del cobro' })).toHaveCount(0);
    expect(writes(f.calls)).toHaveLength(1);
    expect(JSON.parse(writes(f.calls)[0]!.raw!)).toMatchObject({ charge: { action: 'REUSE', confirmed: true }, payment: { action: 'REGISTER', amount: 123.45, method: 'TRANSFER' } });
    await expect(page.getByText('$276.55 MXN', { exact: true })).toBeVisible(); await ready(page);
    await writeFile(`${out}/calls-${role}-${width}.json`, JSON.stringify(f.calls, null, 2));
    expect(f.calls.filter(c => c.method !== 'GET' && c.path !== '/api/auth/refresh').every(c => c.path.endsWith('/collection'))).toBe(true);
    expect(f.unexpected).toEqual([]); await page.close();
  }
  expect(recipes[0]).toEqual(recipes[1]);
});

for (const role of ['OWNER', 'RECEPTIONIST'] as const) test(`${role}: completo, sin pago y recuperación incierta`, async ({ page }) => {
  const f = await fixture(page, role); f.mode.lost = true;
  await page.goto('/collections/8');
  await page.getByRole('radio', { name: 'Pago completo', exact: true }).check(); await review(page);
  expect(writes(f.calls)).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirmar cobro' }).click();
  await expect(page.getByText(/Resultado incierto/)).toBeVisible();
  await page.getByRole('button', { name: 'Verificar estado del servidor' }).click();
  await expect(page.getByText(/Esta lectura no prueba/)).toBeVisible();
  await page.getByRole('button', { name: 'Recuperar con la misma solicitud' }).click();
  await expect(page.getByText(/Cobro confirmado por el servidor/)).toBeVisible();
  const posted = writes(f.calls); expect(posted).toHaveLength(2); expect(posted[0]!.raw).toBe(posted[1]!.raw); expect(posted[0]!.key).toBe(posted[1]!.key);
  expect(JSON.parse(posted[0]!.raw!)).toMatchObject({ payment: { amount: 400 } });
  await expect(page.getByText('$0.00 MXN', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a la bandeja' }).click();
  await page.getByRole('list', { name: 'Atenciones completadas' }).locator(':scope > li').first().getByRole('link', { name: 'Gestionar cobro' }).click();
  await expect(page.getByText(/No es deuda registrada/)).toBeVisible();
  await review(page); expect(writes(f.calls)).toHaveLength(2);
  await page.getByRole('button', { name: 'Confirmar cobro' }).click();
  await expect(page.getByText(/Cobro confirmado por el servidor/)).toBeVisible();
  expect(JSON.parse(writes(f.calls)[2]!.raw!)).toMatchObject({ charge: { action: 'CREATE_FROM_APPOINTMENT', confirmed: true }, payment: { action: 'NO_NEW_PAYMENT' } });
  expect(f.unexpected).toEqual([]);
});

test('bloqueos financieros y estados seguros de bandeja', async ({ page }) => {
  const f = await fixture(page, 'RECEPTIONIST');
  await page.goto('/collections/9'); await expect(page.getByRole('alert')).toContainText('varios cargos activos');
  await expect(page.getByRole('button', { name: 'Revisar cobro' })).toHaveCount(0);
  f.mode.missing = true; await page.goto('/collections/8'); await expect(page.getByRole('alert')).toContainText('precio histórico positivo');
  f.mode.missing = false; f.mode.settled = true; await page.goto('/collections/8');
  await expect(page.getByRole('radio', { name: 'Pago completo' })).toBeDisabled(); await expect(page.getByRole('radio', { name: 'Pago parcial' })).toBeDisabled();
  await page.goto('/collections'); await expect(page.getByRole('list', { name: 'Atenciones completadas' })).toBeVisible();
  f.mode.error = true; await page.getByRole('button', { name: 'Actualizar bandeja' }).click();
  await expect(page.getByRole('alert')).toContainText('No se pudo verificar la bandeja');
  await expect(page.getByLabel('Resumen de atenciones completadas')).toHaveCount(0);
  f.mode.error = false; f.mode.empty = true; await page.getByRole('button', { name: 'Reintentar bandeja' }).click();
  await expect(page.getByText('No hay atenciones con estos filtros')).toBeVisible();
  await page.getByRole('button', { name: 'Más filtros' }).click();
  await page.getByLabel('Desde (fecha de atención)').fill('2026-10-30'); await page.getByLabel('Hasta (incluye ese día)').fill('2026-10-01');
  const count = f.calls.length; await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(page.getByRole('alert')).toContainText('La fecha inicial no puede ser posterior'); expect(f.calls).toHaveLength(count);
  await page.getByRole('button', { name: 'Limpiar filtros' }).click(); await expect(page).toHaveURL('/collections');
  expect(writes(f.calls)).toHaveLength(0); expect(f.unexpected).toEqual([]);
});
