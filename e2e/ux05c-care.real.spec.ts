import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page, type Request } from '@playwright/test';
import { selectDentalPiece } from './dentalInteraction';

// No routes, mock responses or injected credentials: real login + SPA + Spring + PostgreSQL.
const f = JSON.parse(readFileSync(process.env.DENTALCLINIC_CARE_FIXTURE!, 'utf8')) as { ids: number[]; dentistId: number; patientId: number };
async function login(page: Page, role: 'DENTIST' | 'RECEPTION' | 'OWNER') {
  await page.goto('/login'); await page.getByLabel('Correo electrónico').fill(process.env[`DENTALCLINIC_${role}_EMAIL`]!);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.DENTALCLINIC_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click(); await expect(page).not.toHaveURL(/\/login/);
}
async function reviewClinical(page: Page) {
  await page.getByRole('button', { name: 'Finalizar atención', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Finalizar atención', exact: true })).toBeFocused();
  await expect(page.getByRole('dialog').getByRole('textbox')).toHaveCount(0);
}
function writes(page: Page, path: string) {
  const requests: Request[] = []; page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith(path)) requests.push(req); }); return requests;
}
async function collect(browser: Browser, role: 'RECEPTION' | 'OWNER', partial: boolean) {
  const context = await browser.newContext(); const page = await context.newPage();
  try {
    await login(page, role); const requests = writes(page, '/collection');
    await page.goto('/collections');
    await expect(page.getByRole('heading', { name: 'Atenciones por cobrar', exact: true })).toBeVisible();
    if (partial) await expect(page.getByText('Sin importe de deuda registrado. El precio de referencia no es un cargo.').first()).toBeVisible();
    await page.getByRole('link', { name: new RegExp(`Atención #${f.ids[0]}$`) }).click();
    await page.getByRole('radio', { name: partial ? 'Pago parcial' : 'Pago completo', exact: true }).check();
    if (partial) await page.getByLabel('Importe abonado (MXN)').fill('200.01');
    await page.getByRole('checkbox', { name: /Confirmo expresamente/ }).check(); await page.getByRole('button', { name: 'Revisar cobro', exact: true }).click();
    expect(requests).toHaveLength(0);
    const response = page.waitForResponse(r => r.url().endsWith('/collection'));
    await page.getByRole('button', { name: 'Confirmar cobro', exact: true }).click(); const actual = await response;
    expect(actual.status()).toBe(200); const result = await actual.json();
    expect(result.appointmentStatus).toBe('COMPLETED'); expect(result.financialAtCollection.pendingBalance).toBe(partial ? 299.99 : 0);
    expect(result.financialAtCollection.chargeDisposition).toBe(partial ? 'CREATED' : 'REUSED');
    await expect(page.getByText(/Cobro confirmado por el servidor/)).toBeVisible();
    const req = requests[0]!;
    const replay = await page.request.post(req.url(), { headers: req.headers(), data: req.postData()! });
    expect(replay.status()).toBe(200); expect(await replay.json()).toEqual(result);
    const appointment = await page.request.get(`/api/appointments/${f.ids[0]}`, { headers: { Authorization: req.headers().authorization! } });
    expect((await appointment.json()).status).toBe('COMPLETED');
    const forbidden = await page.request.post(`/api/appointments/${f.ids[0]}/complete`, { headers: { Authorization: req.headers().authorization!, 'Idempotency-Key': crypto.randomUUID() }, data: { expectedOccurrenceVersion: 1 } });
    expect(forbidden.status()).toBe(403);
    if (role === 'RECEPTION') {
      const clinical = await page.request.get(`/api/patients/${f.patientId}/clinical`, { headers: { Authorization: req.headers().authorization! } }); expect(clinical.status()).toBe(403);
    }
  } finally { await context.close(); }
}
test('DENTIST → recepción pago parcial → OWNER abono posterior: recorrido completo real', async ({ page, browser }) => {
  await login(page, 'DENTIST'); const requests = writes(page, '/complete');
  const agenda = `/appointments?view=day&date=2026-10-13&patientId=${f.patientId}&status=SCHEDULED`;
  await page.goto(agenda); await page.getByRole('button', { name: /Abrir cita de .*09:00–10:00/ }).click();
  await expect(page.getByRole('heading', { name: 'Detalle de cita', exact: true })).toBeVisible();
  await expect(page.getByLabel('Contenido de la nota')).toHaveCount(0); await page.getByRole('button', { name: 'Abrir consulta' }).click(); await reviewClinical(page);
  await page.getByRole('button', { name: 'Confirmar finalización' }).click(); await expect(page).toHaveURL(agenda);
  await expect(page.getByRole('button', { name: /Abrir cita de .*09:00–10:00/ })).toHaveCount(0); expect(requests).toHaveLength(1);
  const forbidden = await page.request.post(`/api/appointments/${f.ids[0]}/collection`, { headers: { Authorization: requests[0]!.headers().authorization!, 'Idempotency-Key': crypto.randomUUID() }, data: {} }); expect(forbidden.status()).toBe(403);
  await collect(browser, 'RECEPTION', true); await collect(browser, 'OWNER', false);
});
for (const [index, view, width, note] of [[1, 'week', 768, true], [2, 'month', 390, false]] as const) test(`finalización real ${view}: opcionales=${note}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await login(page, 'DENTIST');
  const returnTo = `/appointments?view=${view}&date=2026-10-13&patientId=${f.patientId}`;
  await page.goto(`/appointments/${f.ids[index]}?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByRole('button', { name: 'Abrir consulta' }).click();
  if (note) {
    await page.getByLabel('Contenido de la nota').fill('Observación sintética BUILD 2 real');
    await page.getByRole('button', { name: 'Guardar nota', exact: true }).click(); await expect(page.getByText(/Nota clínica guardada/)).toBeVisible();
  }
  if (note) {
    await expect(page.getByRole('region', { name: 'Tratamientos del paciente' })).toBeVisible();
    await page.getByRole('button', { name: 'Nuevo tratamiento', exact: true }).click();
    await page.getByLabel('Descripción', { exact: true }).fill('Plan sintético explícito BUILD 2');
    await expect(page.getByLabel('Cita vinculada (opcional)')).toHaveCount(0);
    await reviewClinical(page);
    await expect(page.getByRole('button', { name: 'Confirmar finalización' })).toBeDisabled();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.getByLabel('Descripción', { exact: true })).toHaveValue('Plan sintético explícito BUILD 2');
    await page.getByRole('button', { name: 'Crear tratamiento', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Tratamiento Plan sintético explícito BUILD 2' })).toBeVisible();
    await page.getByRole('button', { name: 'Ver detalle y evolución' }).click();
    await page.getByRole('button', { name: 'Evolución', exact: true }).click();
    await page.getByLabel('Nueva nota de evolución').fill('Evolución explícita BUILD 2');
    await page.getByRole('button', { name: 'Guardar evolución', exact: true }).click();
    await expect(page.getByLabel('Nueva nota de evolución')).toHaveValue('');
    await selectDentalPiece(page, 48);
    const dental = page.getByRole('region', { name: 'Odontograma', exact: true });
    await expect(dental.getByLabel('Condición de la pieza')).toHaveValue('');
    await dental.getByLabel('Condición de la pieza').selectOption('CARIES');
    await dental.getByLabel('Observaciones (opcional)', { exact: true }).fill('Hallazgo sintético explícito BUILD 2');
    await expect(page.getByLabel('Contenido de la nota')).toBeVisible();
    await reviewClinical(page);
    await expect(page.getByRole('button', { name: 'Confirmar finalización' })).toBeDisabled();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dental).toBeVisible();
    await expect(dental.getByLabel('Observaciones (opcional)', { exact: true })).toHaveValue('Hallazgo sintético explícito BUILD 2');
    await dental.getByRole('button', { name: 'Guardar pieza', exact: true }).click();
    await expect(dental.getByText('Pieza 48 guardada.', { exact: true })).toBeVisible();
    await reviewClinical(page);
    for (const label of ['Notas', 'Evoluciones', 'Tratamientos vinculados a esta cita']) {
      await expect(page.getByRole('dialog').locator('.dc-activity-counts > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd')).toHaveText('1');
    }
  } else await reviewClinical(page);
  await page.getByRole('button', { name: 'Confirmar finalización' }).click(); await expect(page).toHaveURL(returnTo);
  if (width < 768) await expect(page.getByText(/Vista Día en móvil/)).toBeVisible();
  else await expect(page.getByRole('button', { name: view === 'week' ? 'Semana' : 'Mes', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('respuesta clínica perdida después del commit real: mismo cuerpo/clave, una finalización', async ({ page }) => {
  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window); let lost = false;
    window.fetch = async (...args) => {
      const response = await realFetch(...args);
      if (!lost && String(args[0]).endsWith('/complete') && response.ok) { lost = true; await response.text(); throw new TypeError('Injected transport loss after real commit'); }
      return response;
    };
  });
  await login(page, 'DENTIST'); const requests = writes(page, '/complete'); await page.goto(`/appointments/${f.ids[3]}`);
  await page.getByRole('button', { name: 'Abrir consulta' }).click(); await reviewClinical(page);
  await page.getByRole('button', { name: 'Confirmar finalización' }).click(); await expect(page.getByText(/Resultado incierto/)).toBeVisible();
  await page.getByRole('button', { name: 'Recuperar con la misma solicitud' }).click(); await expect(page).toHaveURL('/appointments');
  expect(requests).toHaveLength(2); expect(requests[0]!.postData()).toBe(requests[1]!.postData()); expect(requests[0]!.headers()['idempotency-key']).toBe(requests[1]!.headers()['idempotency-key']);
});
