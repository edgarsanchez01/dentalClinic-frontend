import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page, type Locator } from '@playwright/test';
import type { FinancialIntentOperation as Operation, FinancialIntentView as View } from '../src/api/financialIntents';

// All HTTP responses come from Spring/PostgreSQL. Faults consume real responses before losing/delaying them.
const fixtureFile = process.env.DENTALCLINIC_B6_FIXTURE;
test.skip(!fixtureFile, 'Solo con FinancialRecoveryBrowserIT y PostgreSQL efímero propios.');
const f = (fixtureFile ? JSON.parse(readFileSync(fixtureFile, 'utf8')) : { emails: {} }) as {
  api: string; patientId: number; emails: Record<'owner' | 'other' | 'reception' | 'dentist' | 'patient', string>;
};
type Actor = keyof typeof f.emails;
const BASE = '/api/financial-intents';
const CONFIRM = 'FIN_CONFIRM_CHARGE', PAY = 'FIN_REGISTER_PAYMENT', REVERSE = 'FIN_REVERSE_PAYMENT', CANCEL = 'FIN_CANCEL_CHARGE';
const operations: Operation[] = [CONFIRM, PAY, REVERSE, CANCEL];
const tokens = new Map<Actor, string>();
test.beforeAll(async ({ request }) => {
  for (const actor of Object.keys(f.emails) as Actor[]) {
    const response = await request.post(`${f.api}/api/auth/login`, { data: { email: f.emails[actor], password: process.env.DENTALCLINIC_B6_PASSWORD } });
    expect(response.status()).toBe(200); tokens.set(actor, (await response.json()).accessToken);
  }
});
function path(view: Pick<View, 'operation' | 'intentId'>) { return `${BASE}/${view.operation}/${view.intentId}`; }
async function api(request: APIRequestContext, actor: Actor, route: string, data?: unknown) {
  const options = { headers: { Authorization: `Bearer ${tokens.get(actor)}`, ...(typeof data === 'string' ? { 'Content-Type': 'application/json' } : {}) },
    ...(data === undefined ? {} : { data }) };
  const response = data === undefined ? await request.get(f.api + route, options) : await request.post(f.api + route, options);
  // HTTP combines repeated field lines; the pre-security filter and exception advice may both
  // contribute no-store. Validate the actual cache directive, not MockMvc's first-header view.
  if (route.startsWith(BASE)) expect([...new Set(response.headers()['cache-control']?.split(',').map(value => value.trim()))]).toEqual(['no-store']);
  return response;
}
async function register(request: APIRequestContext, actor: Actor, operation: Operation, command: object, intentId = randomUUID()): Promise<View> {
  const response = await api(request, actor, BASE, { operation, intentId, command });
  expect(response.status()).toBe(201); const view = await response.json(); expect(view.state).toBe('REGISTERED'); return view;
}
async function execute(request: APIRequestContext, actor: Actor, view: View): Promise<View> {
  const response = await api(request, actor, path(view) + '/execute', {});
  expect(response.status()).toBe(200); const result = await response.json(); expect(result.state).toBe('CONFIRMED'); return result;
}
function chargeCommand() { return { patientId: f.patientId, appointmentId: null, notes: null,
  items: [{ description: `B6 sintético ${randomUUID()}`, quantity: 1, unitPrice: 100 }] }; }
async function charge(request: APIRequestContext, actor: Actor = 'owner') {
  return execute(request, actor, await register(request, actor, CONFIRM, chargeCommand()));
}
async function pending(request: APIRequestContext, actor: Actor, operation: Operation) {
  if (operation === CONFIRM) return register(request, actor, operation, chargeCommand());
  const c = await charge(request, actor); const chargeId = c.effect!.chargeId;
  if (operation === PAY) return register(request, actor, operation, { chargeId, amount: 25, method: 'CASH', reason: null });
  if (operation === CANCEL) return register(request, actor, operation, { chargeId, reason: 'Corrección sintética B6' });
  const paid = await execute(request, actor, await register(request, actor, PAY, { chargeId, amount: 25, method: 'CARD', reason: null }));
  return register(request, actor, operation, { chargeId, movementId: paid.effect!.movementId, reason: 'Corrección sintética B6' });
}
async function login(page: Page, actor: Actor, route = '/finances') {
  await page.goto('/login'); await page.getByLabel('Correo electrónico').fill(f.emails[actor]);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.DENTALCLINIC_B6_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click(); await expect(page).not.toHaveURL(/\/login/);
  await page.goto(route);
  await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true }).first()).toBeVisible();
}
function writes(page: Page) {
  const result: Array<{ path: string; body: string | null }> = [];
  page.on('request', request => { const p = new URL(request.url()).pathname;
    if (request.method() === 'POST' && (p.startsWith(BASE) || p.startsWith('/api/charges'))) result.push({ path: p, body: request.postData() }); });
  return result;
}
async function fillManual(page: Page, actor: Actor) {
  if (actor === 'reception') {
    await page.getByRole('combobox', { name: 'Paciente (obligatorio)' }).click();
    await page.getByRole('option', { name: /Ada Finanzas/ }).click();
    await page.getByRole('button', { name: 'Continuar a conceptos' }).click();
  } else {
    await expect(page.getByRole('option', { name: /Finanzas, Ada/ })).toBeAttached();
    await page.getByLabel('Paciente (obligatorio)').selectOption(String(f.patientId));
  }
  await page.getByLabel('Descripción del concepto 1').fill(`B6 UI ${randomUUID()}`);
  await page.getByLabel('Precio unitario del concepto 1 (MXN)').fill('100.00');
  if (actor === 'reception') await page.getByRole('button', { name: 'Revisar cargo' }).click();
  await expect(page.getByRole('button', { name: 'Confirmar cargo manual' })).toBeEnabled();
}
async function openIntent(page: Page, view: View, actor: Actor = 'owner'): Promise<Locator> {
  // A reload resolves at document load, before HttpOnly refresh/hydration. Do not abort that
  // refresh with another document navigation (rotating refresh tokens are deliberately single-use).
  await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true }).first()).toBeVisible();
  if (new URL(page.url()).pathname !== '/finances') await page.goto('/finances');
  await page.getByText(/Revisar pendientes y recientes/).click();
  // Select by the identity carried in the real GET, not by an invented UI label or query parameter.
  const response = await page.request.get(f.api + BASE + '?view=pending', { headers: { Authorization: `Bearer ${tokens.get(actor)}` } });
  expect(response.status()).toBe(200);
  const items = (await response.json()).items as View[];
  const index = items.findIndex(item => item.intentId === view.intentId); expect(index).toBeGreaterThanOrEqual(0);
  await page.getByRole('button', { name: 'Revisar operación', exact: true }).nth(index).click();
  return page.getByRole('region', { name: 'Operación recuperada' });
}
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).first().click();
  const leave = page.getByRole('button', { name: 'Salir de esta vista' });
  if (await leave.isVisible()) await leave.click();
  await expect(page).toHaveURL('/');
}

for (const actor of ['owner', 'reception'] as const) test(`${actor}: alta/pago manual reales${actor === 'owner' ? ', reversa y anulación' : ', correcciones prohibidas'}`, async ({ page, request }) => {
  await login(page, actor, '/finances/new'); const sent = writes(page); await fillManual(page, actor);
  await page.getByRole('button', { name: 'Confirmar cargo manual' }).click(); await expect(page).toHaveURL(/\/finances\/\d+$/);
  const chargeId = Number(page.url().split('/').pop());
  await expect(page.getByRole('heading', { name: 'Estado vigente: Pendiente' })).toBeVisible();
  await page.getByLabel('Importe del pago (MXN)').fill('25'); await page.getByRole('button', { name: 'Registrar pago', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Estado vigente: Parcial' })).toBeVisible();
  if (actor === 'owner') {
    await page.getByRole('button', { name: /^Reversar pago #/ }).click(); await page.getByLabel('Motivo obligatorio').fill('Reversa B6');
    await page.getByRole('checkbox', { name: 'Confirmo esta operación y sus consecuencias' }).check();
    await page.getByRole('button', { name: 'Confirmar reversa completa' }).click();
    await expect(page.getByRole('heading', { name: 'Estado vigente: Pendiente' })).toBeVisible();
    await page.reload(); await page.getByRole('button', { name: 'Anular cargo', exact: true }).click();
    await page.getByLabel('Motivo obligatorio').fill('Anulación B6'); await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Confirmar anulación', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Estado vigente: Anulado' })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: /Reversar pago|Anular cargo/ })).toHaveCount(0);
    expect((await api(request, actor, BASE, { operation: CANCEL, intentId: randomUUID(), command: { chargeId, reason: 'No permitido' } })).status()).toBe(403);
  }
  const registrations = sent.filter(row => row.path === BASE); expect(registrations).toHaveLength(actor === 'owner' ? 4 : 2);
  for (const row of registrations) {
    const body = JSON.parse(row.body!); expect(sent.filter(write => write.path === `${BASE}/${body.operation}/${body.intentId}/execute`)).toHaveLength(1);
    expect((await (await api(request, actor, `${BASE}/${body.operation}/${body.intentId}`)).json()).state).toBe('CONFIRMED');
  }
  expect(sent.every(row => row.path.startsWith(BASE))).toBe(true);
});

for (const actor of ['owner', 'reception'] as const) for (const operation of actor === 'owner' ? operations : [CONFIRM, PAY] as Operation[])
test(`${actor} ${operation}: descubre REGISTERED tras recarga, reanuda explícitamente y reproduce sin duplicar`, async ({ page, request }) => {
  const view = await pending(request, actor, operation);
  await login(page, actor); const sent = writes(page); await page.reload();
  const region = await openIntent(page, view, actor);
  await region.getByRole('button', { name: 'Consultar operación' }).click();
  await expect(region.getByText('Registrada · pendiente de ejecución', { exact: true })).toBeVisible(); expect(sent).toHaveLength(0);
  await region.getByRole('button', { name: 'Reanudar operación' }).click(); expect(sent).toHaveLength(0);
  await region.getByRole('button', { name: 'Confirmar reanudación' }).click(); await expect(region.getByText('Confirmada', { exact: true })).toBeVisible();
  expect(sent).toEqual([{ path: path(view) + '/execute', body: '{}' }]);
  const authoritative = await (await api(request, actor, path(view))).json();
  expect(await execute(request, actor, view)).toEqual(authoritative);
  expect((await api(request, actor, path(view) + '/abandon', {})).status()).toBe(409);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, history: history.state, url: location.href }));
  expect(stored).not.toContain(view.intentId); expect(stored).not.toContain('command');
});

for (const actor of ['owner', 'reception'] as const) for (const operation of actor === 'owner' ? operations : [CONFIRM, PAY] as Operation[])
test(`${actor} ${operation}: abandono explícito sin recibo/efecto, cierre durable`, async ({ page, request }) => {
  const view = await pending(request, actor, operation); await login(page, actor); const sent = writes(page);
  const region = await openIntent(page, view, actor); await region.getByRole('button', { name: 'Abandonar operación' }).click(); expect(sent).toHaveLength(0);
  await region.getByRole('button', { name: 'Confirmar abandono' }).click(); await expect(region.getByText('Abandonada sin efecto', { exact: true })).toBeVisible();
  expect(sent).toEqual([{ path: path(view) + '/abandon', body: '{}' }]);
  expect((await api(request, actor, path(view) + '/execute', {})).status()).toBe(409);
  expect((await (await api(request, actor, path(view))).json()).state).toBe('ABANDONED');
});

test('rechazo real de negocio: sobrepago concurrente -> REJECTED, no error técnico convertido en rechazo', async ({ page, request }) => {
  const c = await charge(request); const command = { chargeId: c.effect!.chargeId, amount: 100, method: 'CASH', reason: null };
  const view = await register(request, 'owner', PAY, command);
  await execute(request, 'other', await register(request, 'other', PAY, command));
  // Same ledger, distinct authenticated actors; only the first payment can succeed.
  await login(page, 'owner'); const region = await openIntent(page, view);
  await region.getByRole('button', { name: 'Reanudar operación' }).click(); await region.getByRole('button', { name: 'Confirmar reanudación' }).click();
  await expect(region.getByText('Rechazada sin efecto', { exact: true })).toBeVisible();
  const result = await (await api(request, 'owner', path(view))).json(); expect(result.rejection.code).toBe('PAYMENT_EXCEEDS_BALANCE');
  expect((await api(request, 'owner', path(view) + '/execute', {})).status()).toBe(409);
});

test('pérdida después del commit real + GET perdido -> UNCERTAIN; consultar misma identidad sin POST', async ({ page, request }) => {
  await page.addInitScript(() => {
    const real = window.fetch.bind(window); let lost = false, loseRead = false;
    window.fetch = async (...args) => {
      const response = await real(...args); const route = String(args[0]);
      if (!lost && route.endsWith('/execute') && response.ok) { lost = true; loseRead = true; await response.text(); throw new TypeError('B6 loss after real commit'); }
      if (loseRead && args[1]?.method === 'GET' && /\/api\/financial-intents\/FIN_/.test(route)) { loseRead = false; await response.text(); throw new TypeError('B6 lost real verification'); }
      return response;
    };
  });
  const c = await charge(request); await login(page, 'owner', `/finances/${c.effect!.chargeId}`); const sent = writes(page);
  await page.getByLabel('Importe del pago (MXN)').fill('25'); await page.getByRole('button', { name: 'Registrar pago', exact: true }).click();
  await expect(page.getByText('Resultado incierto', { exact: true })).toBeVisible();
  const registered = JSON.parse(sent.find(row => row.path === BASE)!.body!); const identity = { operation: registered.operation, intentId: registered.intentId };
  expect((await (await api(request, 'owner', path(identity))).json()).state).toBe('CONFIRMED');
  const before = sent.length; await page.getByRole('button', { name: 'Consultar operación' }).click();
  await expect(page.getByText('Confirmada', { exact: true })).toBeVisible(); expect(sent).toHaveLength(before);
  expect(await execute(request, 'owner', { ...identity } as View)).toMatchObject({ state: 'CONFIRMED' });
});

test('recarga/logout/login solo leen, nueva sesión recupera comando durable y otro actor no puede operarlo', async ({ page, request }) => {
  const view = await pending(request, 'owner', PAY); await login(page, 'owner'); const sent = writes(page);
  await page.reload(); await openIntent(page, view); await logout(page);
  await login(page, 'owner'); const region = await openIntent(page, view); expect(sent).toHaveLength(0);
  await region.getByRole('button', { name: 'Consultar operación' }).click();
  await expect(region.getByText('Registrada · pendiente de ejecución', { exact: true })).toBeVisible(); expect(sent).toHaveLength(0);
  await logout(page); await login(page, 'other');
  const foreign = await api(request, 'other', path(view)); const absent = await api(request, 'other', `${BASE}/${PAY}/${randomUUID()}`);
  expect(foreign.status()).toBe(404); expect(absent.status()).toBe(404);
  expect((await foreign.json()).code).toBe((await absent.json()).code);
  for (const action of ['execute', 'abandon']) expect((await api(request, 'other', path(view) + '/' + action, {})).status()).toBe(404);
  expect((await api(request, 'reception', path(view))).status()).toBe(404);
  for (const actor of ['other', 'reception'] as const) {
    const own = await (await api(request, actor, BASE + '?view=pending')).json();
    expect(own.items.some((item: View) => item.intentId === view.intentId)).toBe(false);
  }
  expect(sent).toHaveLength(0);
});

test('concurrencia real misma identidad: registro/execute/abandono serializados sin duplicados', async ({ request }) => {
  const command = chargeCommand(), intentId = randomUUID();
  const registrations = await Promise.all(Array.from({ length: 4 }, () => api(request, 'owner', BASE, { operation: CONFIRM, intentId, command })));
  expect(registrations.map(r => r.status()).sort()).toEqual([200, 200, 200, 201]);
  const view = await registrations[0]!.json(); const results = await Promise.all(Array.from({ length: 6 }, () => execute(request, 'owner', view)));
  expect(new Set(results.map(row => row.effect!.chargeId)).size).toBe(1);
  const race = await pending(request, 'owner', PAY);
  const [executed, abandoned] = await Promise.all([api(request, 'owner', path(race) + '/execute', {}), api(request, 'owner', path(race) + '/abandon', {})]);
  const final = await (await api(request, 'owner', path(race))).json();
  if (final.state === 'CONFIRMED') { expect(executed.status()).toBe(200); expect(abandoned.status()).toBe(409); }
  else { expect(final.state).toBe('ABANDONED'); expect(abandoned.status()).toBe(200); expect(executed.status()).toBe(409); }
});

test('permisos reales: DENTIST/PATIENT sin API; recepción sin reversa/anulación en los cinco endpoints', async ({ request }) => {
  const view = await pending(request, 'owner', CANCEL);
  for (const actor of ['dentist', 'patient', 'reception'] as const) {
    for (const route of [path(view), ...(actor === 'reception' ? [] : [BASE + '?view=pending'])]) expect((await api(request, actor, route)).status()).toBe(403);
    for (const action of ['execute', 'abandon']) expect((await api(request, actor, path(view) + '/' + action, {})).status()).toBe(403);
    expect((await api(request, actor, BASE, { operation: CANCEL, intentId: randomUUID(), command: { chargeId: 1, reason: 'No permitido' } })).status()).toBe(403);
  }
});

test('registro comprometido con respuesta perdida: mismo UUID recuperado, replay de registro no ejecuta', async ({ page, request }) => {
  await page.addInitScript(() => {
    const real = window.fetch.bind(window); let lost = false;
    window.fetch = async (...args) => {
      const response = await real(...args);
      if (!lost && String(args[0]).endsWith('/api/financial-intents') && args[1]?.method === 'POST' && response.ok) {
        lost = true; await response.text(); throw new TypeError('B6 registration response lost after real commit');
      }
      return response;
    };
  });
  await login(page, 'owner', '/finances/new'); const sent = writes(page); await fillManual(page, 'owner');
  await page.getByRole('button', { name: 'Confirmar cargo manual' }).click();
  await expect(page.getByText('Registrada · pendiente de ejecución', { exact: true })).toBeVisible(); expect(sent).toHaveLength(1);
  const original = JSON.parse(sent[0]!.body!); const view = await (await api(request, 'owner', `${BASE}/${original.operation}/${original.intentId}`)).json();
  // Preserve the original decimal representation (100.00 is not rewritten to 100 by JSON.parse/stringify).
  const replay = await api(request, 'owner', BASE, sent[0]!.body!); expect(replay.status()).toBe(200); expect((await replay.json()).state).toBe('REGISTERED');
  await page.reload(); const region = await openIntent(page, view); expect(sent).toHaveLength(1);
  await region.getByRole('button', { name: 'Reanudar operación' }).click(); await region.getByRole('button', { name: 'Confirmar reanudación' }).click();
  await expect(region.getByText('Confirmada', { exact: true })).toBeVisible();
  expect(sent).toHaveLength(2); expect(sent[1]!.path).toBe(path(view) + '/execute');
});

async function forgetAccessToken(page: Page) {
  // Remove only the in-memory credential to exercise a genuine 401 + real cookie/CSRF refresh.
  // No injected credential, forged status, substituted body or API route interception.
  await page.evaluate(async () => { const modulePath = '/src/api/http.ts'; const http = await import(/* @vite-ignore */ modulePath); http.tokenStore.set(null); });
}

test('renovación real durante GET y POST: GET reintenta solo lectura; POST no se reenvía tras refresh', async ({ page, request }) => {
  const view = await pending(request, 'owner', PAY); await login(page, 'owner'); const region = await openIntent(page, view);
  const sent = writes(page); let refreshes = 0;
  page.on('response', response => { if (new URL(response.url()).pathname === '/api/auth/refresh' && response.status() === 200) refreshes++; });
  await forgetAccessToken(page); await region.getByRole('button', { name: 'Consultar operación' }).click();
  await expect.poll(() => refreshes).toBe(1); await expect(region.getByText('Registrada · pendiente de ejecución', { exact: true })).toBeVisible();
  expect(sent).toHaveLength(0);
  await page.goto('/finances/new'); await fillManual(page, 'owner'); const beforePostRefresh = refreshes; await forgetAccessToken(page);
  await page.getByRole('button', { name: 'Confirmar cargo manual' }).click();
  await expect(page.getByText('Resultado incierto', { exact: true })).toBeVisible(); await expect.poll(() => refreshes).toBe(beforePostRefresh + 1);
  expect(sent).toHaveLength(1); const original = sent[0]!.body;
  await page.getByRole('button', { name: 'Reintentar registro con la misma identidad' }).click();
  await expect(page.getByText('Registrada · pendiente de ejecución', { exact: true })).toBeVisible();
  expect(sent).toHaveLength(2); expect(sent[1]!.body).toBe(original); expect(sent.every(row => row.path === BASE)).toBe(true);
  await page.getByRole('button', { name: 'Reanudar operación' }).click(); await page.getByRole('button', { name: 'Confirmar reanudación' }).click();
  await expect(page).toHaveURL(/\/finances\/\d+$/); expect(sent).toHaveLength(3);
});

for (const step of ['register', 'execute'] as const) for (const actor of ['owner', 'other', 'reception'] as const)
  test(`respuesta ${step} tardía tras logout/login ${actor}: no contamina versión/actor nuevos`, async ({ page, request }) => {
    await page.addInitScript(({ step }) => {
      const state = window as typeof window & { b6Held?: boolean; b6Release?: () => void; b6Delivered?: boolean };
      const real = window.fetch.bind(window); let held = false;
      window.fetch = async (...args) => {
        const response = await real(...args); const route = String(args[0]);
        if (!held && args[1]?.method === 'POST' && response.ok
            && (step === 'register' ? route.endsWith('/api/financial-intents') : route.endsWith('/execute'))) {
          held = true; await response.clone().text(); state.b6Held = true;
          await new Promise<void>(resolve => { state.b6Release = resolve; }); state.b6Delivered = true;
        }
        return response;
      };
    }, { step });
    await login(page, 'owner', '/finances/new'); const sent = writes(page); await fillManual(page, 'owner');
    await page.getByRole('button', { name: 'Confirmar cargo manual' }).click();
    await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { b6Held?: boolean }).b6Held))).toBe(true);
    const original = JSON.parse(sent[0]!.body!); const identity = { operation: original.operation, intentId: original.intentId };
    await logout(page);
    // SPA navigation preserves the delayed real transport, while auth replaces its entire session/cache.
    await page.getByRole('link', { name: /Iniciar sesión|Entrar/ }).first().click();
    await page.getByLabel('Correo electrónico').fill(f.emails[actor]); await page.getByLabel('Contraseña', { exact: true }).fill(process.env.DENTALCLINIC_B6_PASSWORD!);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click(); await expect(page).not.toHaveURL(/\/login/);
    const before = sent.length;
    await page.evaluate(() => (window as typeof window & { b6Release?: () => void }).b6Release!());
    await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { b6Delivered?: boolean }).b6Delivered))).toBe(true);
    // Drain the real fetch/application continuation, not an arbitrary timing sleep.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(sent).toHaveLength(before); await expect(page).not.toHaveURL(/\/finances\/\d+$/);
    await expect(page.getByText('Confirmada', { exact: true })).toHaveCount(0);
    const authoritative = await (await api(request, 'owner', path(identity))).json();
    expect(authoritative.state).toBe(step === 'register' ? 'REGISTERED' : 'CONFIRMED');
    if (actor !== 'owner') expect((await api(request, actor, path(identity))).status()).toBe(404);
  });

test('descubrimiento reciente real: páginas propias, metadata mínima y estados cerrados visibles sin POST', async ({ page, request }) => {
  await login(page, 'owner'); const sent = writes(page);
  await page.getByText(/Revisar pendientes y recientes/).click();
  await page.getByLabel('Mostrar operaciones').selectOption('recent');
  await expect(page.getByRole('region', { name: 'Operaciones propias' })).toBeVisible();
  const identities = new Set<string>(); const states = new Set<string>(); let cursor: string | undefined;
  do {
    const response = await api(request, 'owner', BASE + '?view=recent&size=20' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    expect(response.status()).toBe(200); const result = await response.json();
    for (const view of result.items as View[]) {
      const identity = path(view); expect(identities.has(identity)).toBe(false); identities.add(identity); states.add(view.state);
      const json = JSON.stringify(view); for (const forbidden of ['command', 'requestHash', 'actorId', 'responseBody']) expect(json).not.toContain(forbidden);
    }
    cursor = result.nextCursor;
  } while (cursor);
  for (const state of ['REGISTERED', 'CONFIRMED', 'REJECTED', 'ABANDONED']) expect(states.has(state)).toBe(true);
  expect(identities.size).toBeGreaterThan(20); expect(sent).toHaveLength(0);
});
