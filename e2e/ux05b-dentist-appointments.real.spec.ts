import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppointmentResponse } from '../src/api/appointments';

test.skip(process.env.DENTALCLINIC_UX05B !== '1', 'Solo con node scripts/run-ux05b-demo.mjs (PostgreSQL efímero).');
const fixture = JSON.parse(process.env.DENTALCLINIC_DENTIST_FIXTURE ? readFileSync(process.env.DENTALCLINIC_DENTIST_FIXTURE, 'utf8') : '{}') as {
  api: string; web: string; database: string; timezone: string; password: string; dentistId: number;
  today: string; dentistEmail: string; ownerEmail: string; emptyDentistEmail: string;
};
const evidence = resolve('../docs/ux/ux05b-evidence-real');
async function token(request: APIRequestContext, email = fixture.dentistEmail) {
  const response = await request.post(fixture.api + '/api/auth/login', { data: { email, password: fixture.password } });
  expect(response.ok()).toBeTruthy(); return (await response.json()).accessToken as string;
}
async function list(request: APIRequestContext, access: string) {
  const response = await request.get(`${fixture.api}/api/appointments?dentistId=${fixture.dentistId}&size=100`, { headers: { Authorization: `Bearer ${access}` } });
  expect(response.ok()).toBeTruthy(); return (await response.json()).content as AppointmentResponse[];
}
async function login(page: Page) {
  await page.goto('/login'); await page.getByLabel('Correo electrónico').fill(fixture.dentistEmail);
  await page.getByLabel('Contraseña', { exact: true }).fill(fixture.password); await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mi jornada clínica', exact: true })).toBeVisible();
}
async function shot(page: Page, name: string) {
  mkdirSync(evidence, { recursive: true });
  await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.locator('.dc-appointments button:visible').evaluateAll(buttons => buttons.filter(b => {
    const r = b.getBoundingClientRect(); return r.height < 43.9 || r.width < 43.9;
  }).map(b => b.textContent))).toEqual([]);
  const primary = page.locator('.dc-appointments .dc-primary:visible').first();
  if (await primary.count()) {
    const contrast = await primary.evaluate(button => {
      const luminance = (color: string) => {
        const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4);
        return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
      };
      const css = getComputedStyle(button); const a = luminance(css.color); const b = luminance(css.backgroundColor);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  }
  await page.screenshot({ path: resolve(evidence, name + '.png'), fullPage: true });
}

test('agenda real: día, semana, mes, filtros, fechas y móvil', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 }); await login(page);
  await page.goto(`/appointments?view=day&date=${fixture.today}`);
  await expect(page.getByRole('region', { name: 'Agenda del día' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Abrir cita de Valeria/ })).toBeVisible();
  await shot(page, '01-agenda-diaria');
  await page.getByRole('button', { name: 'Semana', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Agenda semanal' })).toBeVisible(); await shot(page, '02-agenda-semanal');
  await page.getByRole('button', { name: 'Mes', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Agenda mensual' })).toBeVisible(); await shot(page, '03-agenda-mensual');
  await page.getByLabel('Filtrar por estado').selectOption('CANCELLED');
  await expect(page.getByRole('button', { name: /Abrir cita de Valeria/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Abrir cita de Diego/ })).toBeVisible();
  await page.getByLabel('Filtrar por estado').selectOption('');
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await expect(page.getByLabel('Fecha', { exact: true })).toHaveValue(fixture.today);
  for (const width of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width >= 768) await expect(page.getByRole('region', { name: 'Agenda mensual' })).toBeVisible();
    else await expect(page.getByRole('region', { name: 'Agenda del día' })).toBeVisible();
    expect(await page.evaluate(() => ({ width: innerWidth, overflow: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map(e => e.className) }))).toMatchObject({ width, overflow: width });
  }
  await shot(page, '12-agenda-movil-320');
});

test('creación real: tres pasos, día cerrado, slots reales y acceso a la cita', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 }); await login(page);
  await page.goto(`/appointments?view=day&date=${fixture.today}&create=1`);
  await expect(page.getByRole('heading', { name: 'Nueva cita' })).toBeVisible();
  await page.getByLabel('Buscar paciente').fill('Valeria');
  await page.getByLabel('Paciente', { exact: true }).selectOption({ label: 'Valeria Ortiz Demo' });
  const service = page.getByLabel('Servicio', { exact: true }); await service.selectOption({ label: 'Consulta de valoración · 30 min' });
  await shot(page, '04-crear-cita-paciente');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  const day = new Date(fixture.today + 'T12:00:00Z'); day.setUTCDate(day.getUTCDate() + 7);
  while (day.getUTCDay() !== 0) day.setUTCDate(day.getUTCDate() + 1);
  await page.getByLabel('Día', { exact: true }).fill(day.toISOString().slice(0, 10));
  await expect(page.getByText('Sin huecos disponibles para esa combinación.')).toBeVisible();
  day.setUTCDate(day.getUTCDate() + 1); await page.getByLabel('Día', { exact: true }).fill(day.toISOString().slice(0, 10));
  const slots = page.getByRole('group', { name: 'Huecos disponibles', exact: true });
  await expect(slots.getByRole('button').first()).toBeVisible(); await slots.getByRole('button').first().click();
  await expect(slots.getByRole('button', { pressed: true })).toHaveCount(1); await shot(page, '04b-crear-cita-horarios');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click(); await page.getByLabel('Motivo', { exact: true }).fill('Revisión sintética UX-05B');
  await shot(page, '04c-crear-cita-confirmacion');
  await page.getByRole('button', { name: 'Reservar cita', exact: true }).click();
  await expect(page.getByText('Cita creada correctamente.')).toBeVisible();
  await page.getByRole('link', { name: 'Ver detalle de la cita' }).click();
  await expect(page.getByRole('heading', { name: 'Valeria Ortiz Demo', exact: true })).toBeVisible();
  await expect(page.getByText('Revisión sintética UX-05B', { exact: true })).toBeVisible();
});

test('atención real: notas, evolución y preparación sin checkout', async ({ page, request }) => {
  const access = await token(request);
  const a = (await list(request, access)).find(a => a.status === 'SCHEDULED' && a.patientFirstName === 'Emilio')!;
  expect(a).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 960 }); await login(page); await page.goto(`/appointments/${a.id}`);
  await expect(page.getByRole('heading', { name: 'Emilio Vargas Demo', exact: true })).toBeVisible(); await shot(page, '05-detalle-programada');
  await page.setViewportSize({ width: 390, height: 844 }); await shot(page, '12d-detalle-programada-movil');
  await page.setViewportSize({ width: 1440, height: 960 });
  const writes: string[] = []; page.on('request', r => { if (r.method() !== 'GET' && /\/api\/(charges|patients|appointments)/.test(r.url())) writes.push(new URL(r.url()).pathname); });
  await page.getByRole('tab', { name: 'Resumen', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Atención clínica', exact: true })).toBeFocused();
  await page.getByLabel('Nueva nota clínica').fill('Observación clínica sintética: consulta de seguimiento.');
  await page.getByRole('tab', { name: 'Resumen', exact: true }).click(); await page.getByRole('button', { name: 'Abrir atención clínica', exact: true }).click();
  await expect(page.getByLabel('Nueva nota clínica')).toHaveValue('Observación clínica sintética: consulta de seguimiento.');
  await shot(page, '06-espacio-atencion');
  await page.setViewportSize({ width: 390, height: 844 }); await shot(page, '12e-espacio-atencion-movil');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('link', { name: 'Volver a Citas', exact: true }).click();
  await page.getByRole('button', { name: 'Seguir aquí', exact: true }).click();
  await page.getByRole('button', { name: 'Añadir nota', exact: true }).click(); await expect(page.getByText(/Nota clínica guardada. Consulta/)).toBeVisible();
  await expect(page.getByText('Observación clínica sintética: consulta de seguimiento.', { exact: true })).toBeVisible(); await shot(page, '07-registro-clinico');
  await page.getByRole('tab', { name: 'Tratamientos', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo tratamiento', exact: true }).click();
  await page.getByLabel('Descripción', { exact: true }).fill('Seguimiento restaurador sintético');
  await page.getByLabel('Cita vinculada (opcional)').selectOption(String(a.id)); await page.getByRole('button', { name: 'Crear tratamiento', exact: true }).click();
  const treatment = page.getByRole('article', { name: 'Tratamiento Seguimiento restaurador sintético' });
  await treatment.getByRole('button', { name: 'Evolución', exact: true }).click();
  await page.getByLabel('Nueva nota de evolución').fill('Procedimiento realizado descrito explícitamente para esta cita (dato sintético).');
  await page.getByRole('button', { name: 'Registrar nota', exact: true }).click();
  await expect(treatment.getByText('Procedimiento realizado descrito explícitamente para esta cita (dato sintético).', { exact: true })).toBeVisible(); await shot(page, '08-tratamientos');
  await expect(page.getByRole('button', { name: /Registrar pago|Confirmar y completar cita|Completar cita/ })).toHaveCount(0);
  expect(writes.filter(p => p.endsWith('/complete') || p.endsWith('/checkout') || p.startsWith('/api/charges'))).toEqual([]);
  expect((await list(request, access)).find(item => item.id === a.id)?.status).toBe('SCHEDULED');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Atención clínica', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Atención clínica', exact: true }).getByText('Observación clínica sintética: consulta de seguimiento.', { exact: true })).toBeVisible(); await shot(page, '12c-atencion-movil');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('reprogramación, cancelación y conflicto clínico contra el estado real', async ({ page, request }) => {
  const access = await token(request); const appointments = await list(request, access);
  const a = appointments.find(a => a.status === 'SCHEDULED' && a.patientFirstName === 'Lucía')!;
  await login(page); await page.goto(`/appointments/${a.id}`); await page.getByRole('button', { name: 'Reprogramar', exact: true }).click();
  const form = page.getByRole('region', { name: 'Reprogramar cita' });
  await expect(form.getByRole('group', { name: 'Huecos disponibles' }).getByRole('button').first()).toBeVisible();
  await form.getByRole('group', { name: 'Huecos disponibles' }).getByRole('button').first().click();
  await form.getByRole('button', { name: 'Confirmar reprogramación', exact: true }).click();
  await expect(page.getByText(/Cita reprogramada. Los borradores conservan/)).toBeVisible();
  const after = (await list(request, access)).find(item => item.id === a.id)!; expect(after.occurrenceVersion).toBe(a.occurrenceVersion + 1);
  await page.getByRole('tab', { name: 'Atención clínica', exact: true }).click();
  await page.getByLabel('Nueva nota clínica').fill('Borrador sintético conservado tras cancelación');
  await page.getByRole('tab', { name: 'Resumen', exact: true }).click();
  await page.getByRole('button', { name: 'Cancelar cita', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar cancelación', exact: true }).click(); await expect(page.getByText('Cita cancelada.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Atención clínica', exact: true }).click();
  await expect(page.getByLabel('Nueva nota clínica')).toHaveValue('Borrador sintético conservado tras cancelación');
  await expect(page.getByRole('button', { name: 'Añadir nota', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Volver a Citas', exact: true }).click();
  await page.getByRole('dialog', { name: 'Tienes cambios sin guardar' }).getByRole('button', { name: 'Seguir aquí', exact: true }).click();
  await expect(page.getByLabel('Nueva nota clínica')).toHaveValue('Borrador sintético conservado tras cancelación');
  await page.getByLabel('Nueva nota clínica').fill('');
  const conflict = appointments.find(a => a.status === 'SCHEDULED' && a.patientFirstName === 'Mateo')!;
  await page.goto(`/appointments/${conflict.id}?clinical=1`);
  await page.getByLabel('Nueva nota clínica').fill('Borrador previo a cancelación externa');
  const cancel = await request.post(`${fixture.api}/api/appointments/${conflict.id}/cancel`, { headers: { Authorization: `Bearer ${access}` } }); expect(cancel.ok()).toBe(true);
  await page.getByRole('button', { name: 'Añadir nota', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Añadir nota', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Nueva nota clínica')).toHaveValue('Borrador previo a cancelación externa');
});

test('estados terminales, ausencia de checkout y RBAC financiero real', async ({ page, request }) => {
  const access = await token(request); const appointments = await list(request, access);
  const cancelled = appointments.find(a => a.status === 'CANCELLED')!;
  const scheduled = appointments.find(a => a.status === 'SCHEDULED' && a.patientFirstName === 'Valeria')!;
  await login(page); await page.goto(`/appointments/${cancelled.id}`);
  await expect(page.getByText('Cancelada', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Completar cita', exact: true })).toHaveCount(0);
  const other = await token(request, fixture.emptyDentistEmail);
  const denied = await request.post(`${fixture.api}/api/appointments/${scheduled.id}/complete`, { headers: { Authorization: `Bearer ${other}` } }); expect(denied.status()).toBe(403);
  await page.goto(`/appointments/${scheduled.id}?clinical=1`);
  await expect(page.getByLabel('Nueva nota clínica')).toBeVisible();
  await expect(page.getByRole('button', { name: /Completar cita|Confirmar y completar cita|Registrar pago/ })).toHaveCount(0);
  const headers = { Authorization: `Bearer ${access}`, 'Idempotency-Key': crypto.randomUUID() };
  const create = await request.post(fixture.api + '/api/charges', { headers, data: { patientId: scheduled.patientId, appointmentId: scheduled.id, items: [{ description: 'Intento no autorizado', quantity: 1, unitPrice: 10 }] } }); expect(create.status()).toBe(403);
  const pay = await request.post(fixture.api + '/api/charges/1/payments', { headers, data: { amount: 10, method: 'CASH' } }); expect(pay.status()).toBe(403);
});
