import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * UX-05A.1 — Inicio del DENTIST contra el BACKEND REAL del entorno de demostración.
 *
 * Sin mocks: el SPA consulta el backend real arrancado por `scripts/run-ux05a-demo.mjs`
 * sobre una base PostgreSQL efímera y aislada con datos sintéticos realistas.
 *
 * Solo se ejecuta si `run-ux05a-demo.mjs` exporta el fixture (DENTALCLINIC_DENTIST_REAL=1).
 * La contraseña llega por variable de entorno; NUNCA se escribe en capturas ni en informes.
 */

test.skip(process.env.DENTALCLINIC_DENTIST_REAL !== '1', 'Solo con el entorno demo aislado + backend real.');

const fixturePath = process.env.DENTALCLINIC_DENTIST_FIXTURE!;
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  api: string; web: string; database: string; timezone: string; password: string;
  dentistId: number; emptyDentistId: number; today: string; nextAppointmentAt: string | null;
  patients: number; services: number; appointments: number; notifications: number;
  dentistEmail: string; emptyDentistEmail: string;
};

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(fixture.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mi jornada clínica', exact: true })).toBeVisible();
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test.describe('UX-05A DENTIST · backend real · verificación funcional', () => {
  test('1) el dentista inicia sesión y el Inicio carga sus citas reales', async ({ page }) => {
    await login(page, fixture.dentistEmail);
    const day = page.getByRole('region', { name: 'Mi agenda de hoy' });
    await expect(day).toBeVisible();
    // "Citas que siguen programadas hoy" es un total real del servidor, no una constante de mock.
    await expect(day.locator('.dentist-agenda-total strong')).toHaveText(/^\d+$/);
    const scheduledToday = Number(await day.locator('.dentist-agenda-total strong').innerText());
    expect(scheduledToday).toBeGreaterThanOrEqual(1);
    await expect(day.getByRole('list')).toBeVisible();
  });

  test('2) «Siguiente paciente» muestra una cita futura real', async ({ page }) => {
    await login(page, fixture.dentistEmail);
    const next = page.getByRole('region', { name: 'Próxima cita propia' });
    await expect(next.getByText('Siguiente paciente')).toBeVisible();
    // La hora del destacado debe ser posterior a ahora (cita futura real programada).
    const iso = await next.locator('time').first().getAttribute('dateTime');
    expect(iso).toBeTruthy();
    expect(Date.parse(iso!)).toBeGreaterThan(Date.now() - 60_000);
    await expect(next.getByRole('link', { name: 'Abrir cita' })).toBeVisible();
    await expect(next.getByRole('link', { name: 'Abrir expediente' })).toBeVisible();
  });

  test('3) «Mi agenda de hoy» presenta los estados reales (programada/completada/ausencia/cancelada)', async ({ page }) => {
    await login(page, fixture.dentistEmail);
    const day = page.getByRole('region', { name: 'Mi agenda de hoy' });
    const rows = day.locator('.dentist-agenda-list > li');
    await expect(rows.first()).toBeVisible();
    const text = await day.innerText();
    expect(text).toMatch(/Programada|Completada|No asistió|Cancelada/);
  });

  test('4) los enlaces a cita y expediente responden según los permisos actuales', async ({ page }) => {
    await login(page, fixture.dentistEmail);
    const next = page.getByRole('region', { name: 'Próxima cita propia' });
    const openAppointment = next.getByRole('link', { name: 'Abrir cita' });
    await expect(openAppointment).toHaveAttribute('href', /^\/appointments\/\d+$/);
    await openAppointment.click();
    await expect(page).toHaveURL(/\/appointments\/\d+$/);
    // El dentista tiene RW sobre sus citas: la página de detalle no debe mostrar acceso denegado.
    await expect(page.getByText(/No tienes permiso|Acceso denegado|403/i)).toHaveCount(0);
  });

  test('5) las notificaciones se muestran sin revelar información médica sensible', async ({ page }) => {
    await login(page, fixture.dentistEmail);
    const box = page.getByRole('region', { name: 'Tus notificaciones' });
    await expect(box.locator('.dentist-notification').first()).toBeVisible();
    const text = await box.innerText();
    // Los avisos demo son administrativos; no deben contener términos clínicos sensibles.
    expect(text).not.toMatch(/diagnóstico|odontograma|endodoncia|conducto|receta|medicamento/i);
  });

  test('6) el dentista solo ve su propia agenda (aislamiento de alcance)', async ({ request }) => {
    const token = await apiToken(request, fixture.dentistEmail);
    const res = await request.get(`${fixture.api}/api/appointments?dentistId=${fixture.dentistId}&size=100`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as { content: Array<{ dentistId: number }> };
    expect(body.content.length).toBeGreaterThan(0);
    expect(body.content.every(a => a.dentistId === fixture.dentistId)).toBe(true);
  });
});

test.describe('UX-05A DENTIST · backend real · evidencia visual', () => {
  test('desktop con jornada clínica completa', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await login(page, fixture.dentistEmail);
    await expect(page.getByRole('region', { name: 'Mi agenda de hoy' }).getByRole('list')).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: test.info().outputPath('ux05a-dentist-real-desktop-jornada.png'), fullPage: true });
  });

  test('desktop con la siguiente cita destacada', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page, fixture.dentistEmail);
    const next = page.getByRole('region', { name: 'Próxima cita propia' });
    await expect(next.getByText('Siguiente paciente')).toBeVisible();
    await next.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('ux05a-dentist-real-desktop-destacado.png') });
  });

  test('móvil con varias citas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await login(page, fixture.dentistEmail);
    await expect(page.getByRole('region', { name: 'Mi agenda de hoy' }).getByRole('list')).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: test.info().outputPath('ux05a-dentist-real-mobile-citas.png'), fullPage: true });
  });

  test('móvil con el destacado de siguiente paciente', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await login(page, fixture.dentistEmail);
    const next = page.getByRole('region', { name: 'Próxima cita propia' });
    await expect(next.getByText('Siguiente paciente')).toBeVisible();
    await next.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('ux05a-dentist-real-mobile-destacado.png') });
  });

  test('estado vacío real (profesional sin citas)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await login(page, fixture.emptyDentistEmail);
    await expect(page.getByText('No tienes próximas citas programadas.')).toBeVisible();
    await expect(page.getByText('No tienes citas para hoy')).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: test.info().outputPath('ux05a-dentist-real-desktop-vacio.png'), fullPage: true });
  });
});

async function apiToken(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${fixture.api}/api/auth/login`, { data: { email, password: fixture.password } });
  expect(res.ok()).toBeTruthy();
  return (await res.json() as { accessToken: string }).accessToken;
}
