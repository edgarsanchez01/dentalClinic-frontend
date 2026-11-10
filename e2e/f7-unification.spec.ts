import { expect, test, type Page } from '@playwright/test';
import { uiUnificationFixture, type UiFixtureResult } from './uiUnificationFixture';

function clean(fixture: UiFixtureResult) {
  expect(fixture.violations, fixture.manifest()).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
}

async function capture(page: Page, name: string, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `/tmp/opencode/dc-ui-f7/after-${name}-${width}.png`, fullPage: true });
}

if (!process.env.DC_F7_CAPTURE_BEFORE) for (const width of [1440, 390]) {
  test(`F7 OWNER agrupación persistente e identidades separadas @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'OWNER');
    await open(page, '/scheduling');
    const clinic = page.getByRole('region', { name: 'Gestión de clínica', exact: true });
    const management = page.getByRole('region', { name: 'Gestión de profesionales', exact: true });
    const availability = page.getByRole('region', { name: 'Consulta pública de disponibilidad', exact: true });
    await capture(page, 'scheduling', width);
    const start = clinic.getByLabel('Inicio Lunes', { exact: true });
    await start.fill('08:15');
    await clinic.getByLabel('Motivo (opcional)', { exact: true }).fill('Excepción clínica en borrador');
    await management.getByLabel('Motivo (opcional)', { exact: true }).first().fill('Excepción privada en borrador');
    const privateReads = () => fixture.calls.filter(c => /^\/api\/schedules\/dentist\/8(?:\/|$)/.test(c.path));
    expect(privateReads()).toHaveLength(0);
    await availability.getByRole('combobox', { name: 'Dentista', exact: true }).selectOption('8');
    await expect(management.getByRole('combobox', { name: 'Dentista', exact: true })).toHaveValue('7');
    await expect(management.getByText(/Profesional en edición: Ana Propietaria/)).toBeVisible();
    expect(privateReads()).toHaveLength(0);
    await page.getByRole('navigation', { name: 'Apartados de horarios' }).getByRole('link', { name: 'Disponibilidad' }).click();
    await expect(start).toHaveValue('08:15');
    await page.getByRole('navigation', { name: 'Apartados de horarios' }).getByRole('link', { name: 'Clínica', exact: true }).click();
    await expect(clinic.getByLabel('Motivo (opcional)', { exact: true })).toHaveValue('Excepción clínica en borrador');
    await expect(management.getByLabel('Motivo (opcional)', { exact: true }).first()).toHaveValue('Excepción privada en borrador');
    await expect(page.locator('#schedule-clinic [hidden], #schedule-professionals [hidden]')).toHaveCount(0);
    clean(fixture);
  });

  test(`F7 Equipo CTA único, campos por función y borradores @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'OWNER');
    await open(page, '/users');
    await capture(page, 'users', width);
    const cta = page.getByRole('button', { name: 'Invitar al equipo', exact: true });
    await cta.focus(); await page.keyboard.press('Enter');
    const form = page.locator('#team-invitation form');
    await expect(form).toHaveCount(1);
    await expect(form.getByLabel('Email', { exact: true })).toBeFocused();
    await form.getByLabel('Email', { exact: true }).fill('dentista-f7@example.test');
    await form.getByLabel('Nombre', { exact: true }).fill('Borrador profesional');
    await page.locator('#team-invitation').getByRole('button', { name: 'Invitar recepción', exact: true }).click();
    await expect(form.getByRole('textbox')).toHaveCount(1);
    await form.getByLabel('Email', { exact: true }).fill('recepcion-f7@example.test');
    await cta.click();
    await expect(form.getByLabel('Email', { exact: true })).toBeFocused();
    await page.locator('#team-invitation').getByRole('button', { name: 'Invitar odontólogo', exact: true }).click();
    await expect(form.getByLabel('Nombre', { exact: true })).toHaveValue('Borrador profesional');
    await expect(form.getByLabel('Email', { exact: true })).toHaveValue('dentista-f7@example.test');
    await expect(page.locator('#team-invitation form')).toHaveCount(1);
    clean(fixture);
  });

  test(`F7 Clínica grupos, website y cancelación de salida @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'OWNER');
    await open(page, '/clinic');
    await capture(page, 'clinic', width);
    const form = page.getByRole('form', { name: 'Configuración de la clínica', exact: true });
    await expect(form.getByRole('textbox')).toHaveCount(9);
    for (const name of ['Identidad y zona horaria', 'Contacto y descripción', 'Redes y enlaces']) await expect(form.getByRole('region', { name, exact: true })).toHaveCount(1);
    await form.getByLabel('Sitio web', { exact: true }).fill('https://f7.example.test');
    await form.getByLabel('Descripción', { exact: true }).fill('Descripción sin enviar');
    await page.locator('a[href="/"]').first().click();
    await page.getByRole('button', { name: 'Seguir aquí', exact: true }).click();
    await expect(form.getByLabel('Sitio web', { exact: true })).toHaveValue('https://f7.example.test');
    await expect(form.getByLabel('Descripción', { exact: true })).toHaveValue('Descripción sin enviar');
    clean(fixture);
  });

  test(`F7 OWNER personal conserva calendario propio y panel oculto @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'OWNER');
    await open(page, '/scheduling?scope=mine');
    const tools = page.locator('#professional-schedule-tools');
    await tools.getByRole('button', { name: 'Editar horario', exact: true }).click();
    await tools.getByLabel('Inicio Lunes', { exact: true }).fill('08:45');
    await tools.getByRole('tab', { name: 'Excepciones', exact: true }).click();
    await tools.getByRole('button', { name: 'Nueva excepción', exact: true }).click();
    await tools.getByLabel('Motivo (opcional)', { exact: true }).fill('Mi borrador');
    await page.getByRole('region', { name: 'Consultar disponibilidad', exact: true }).getByRole('combobox', { name: 'Dentista', exact: true }).selectOption('8');
    expect(fixture.calls.filter(c => /^\/api\/schedules\/dentist\/8(?:\/|$)/.test(c.path))).toHaveLength(0);
    await tools.getByRole('tab', { name: 'Mi semana', exact: true }).click();
    await expect(tools.getByLabel('Inicio Lunes', { exact: true })).toHaveValue('08:45');
    await tools.getByRole('tab', { name: 'Excepciones', exact: true }).click();
    await expect(tools.getByLabel('Motivo (opcional)', { exact: true })).toHaveValue('Mi borrador');
    clean(fixture);
  });
}
async function open(page: Page, route: string) {
  await page.goto(route);
  await expect(page.locator('h1')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

if (process.env.DC_F7_CAPTURE_BEFORE) for (const width of [1440, 390]) {
  test(`F7 referencia acotada @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'OWNER');
    for (const route of ['scheduling', 'users', 'clinic']) {
      await open(page, `/${route}`);
      await page.screenshot({ path: `/tmp/opencode/dc-ui-f7/before-${route}-${width}.png`, fullPage: true });
    }
    clean(fixture);
  });
}
