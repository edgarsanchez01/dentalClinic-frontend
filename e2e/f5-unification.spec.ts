import { expect, test, type Page } from '@playwright/test';

import { uiUnificationFixture, type UiFixtureResult } from './uiUnificationFixture';

/**
 * F5 — consolidación de bloques administrativos y pestañas.
 *
 * Solo comprueba los contratos de F5: pestañas con activación manual y paneles
 * persistentes, datos administrativos compartidos por rol, composición vertical
 * DENTIST, ficha propia/ajena PATIENT y pestañas de horario sin desmontaje.
 * No repite la matriz visual de F0–F4 ni escribe evidencia PNG en el repositorio.
 */

const WIDTHS = [1440, 390] as const;

function reset(fixture: UiFixtureResult) {
  fixture.calls.length = 0;
  fixture.violations.undeclared.length = 0;
  fixture.violations.forbidden.length = 0;
  fixture.violations.blockedWrites.length = 0;
}

function assertNoViolations(fixture: UiFixtureResult) {
  expect(fixture.violations.undeclared, `Endpoints no declarados:\n${fixture.manifest()}`).toEqual([]);
  expect(fixture.violations.forbidden, `Endpoints prohibidos para el rol:\n${fixture.manifest()}`).toEqual([]);
  expect(fixture.violations.blockedWrites, `Escrituras bloqueadas:\n${fixture.manifest()}`).toEqual([]);
}

function assertNoHorizontalOverflow(page: Page, label: string) {
  return page.evaluate((description) => {
    const { scrollWidth, clientWidth } = document.documentElement;
    return { description, scrollWidth, clientWidth, overflows: scrollWidth > clientWidth + 1 };
  }, label);
}

async function open(page: Page, fixture: UiFixtureResult, route: string) {
  reset(fixture);
  await page.goto(route);
  await expect(page.locator('h1')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
}

for (const width of WIDTHS) {
  test(`F5 OWNER · pestañas manuales y borrador persistente @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'OWNER');
    await open(page, fixture, '/patients/4');

    const tablist = page.getByRole('tablist', { name: 'Secciones de la ficha del paciente' });
    await expect(tablist).toBeVisible();
    const tabs = tablist.getByRole('tab');
    await expect(tabs).toHaveCount(6);
    await expect(tabs.nth(0)).toHaveAccessibleName('Administración');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');

    const panels = page.locator('[role="tabpanel"]');
    await expect(panels).toHaveCount(6);
    await expect(page.locator('[role="tabpanel"]:not([hidden])')).toHaveCount(1);
    await expect(page.locator('[role="tabpanel"]:not([hidden])')).toHaveAccessibleName('Administración');

    // Activación manual: la flecha mueve el foco sin seleccionar; Enter activa.
    await tabs.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('Enter');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Declaraciones del paciente');
    expect(new URL(page.url()).pathname).toBe('/patients/4');

    // Volver a Administración y comprobar que el borrador sobrevive al cambio de pestaña.
    await tabs.nth(0).click();
    await page.getByRole('button', { name: 'Editar datos' }).click();
    const email = page.getByLabel('Email (opcional)');
    await email.fill('borrador-f5@example.test');
    await tabs.nth(3).click();
    await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Odontograma');
    await tabs.nth(0).click();
    await expect(email).toHaveValue('borrador-f5@example.test');
    expect(
      fixture.calls.filter(call => call.method !== 'GET' && call.path !== '/api/auth/refresh'),
      fixture.manifest(),
    ).toEqual([]);

    assertNoViolations(fixture);
    const overflow = await assertNoHorizontalOverflow(page, `OWNER /patients/4 @${width}`);
    expect(overflow.overflows, JSON.stringify(overflow)).toBe(false);
    await test.info().attach(`owner-tabs-${width}`, {
      body: JSON.stringify({ overflow, calls: fixture.manifest() }, null, 2),
      contentType: 'application/json',
    });
  });

  test(`F5 RECEPTIONIST · resumen administrativo sin expediente @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'RECEPTIONIST');
    await open(page, fixture, '/patients/4');

    await expect(page.getByRole('tablist')).toHaveCount(0);
    for (const heading of ['Identificación', 'Contacto', 'Administración']) {
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
    for (const term of ['Nombre', 'Apellidos', 'Fecha de nacimiento', 'Correo electrónico', 'Teléfono', 'Estado', 'Cuenta de acceso']) {
      await expect(page.getByText(term, { exact: true }).first()).toBeVisible();
    }

    const clinical = fixture.calls.filter(call =>
      call.path.includes('/clinical') || call.path.includes('/medical-intake') ||
      call.path.includes('/odontogram/history') || call.path.includes('/odontogram/at'));
    expect(clinical, fixture.manifest()).toEqual([]);
    expect(fixture.calls.some(call => call.path === '/api/patients/4'), fixture.manifest()).toBe(true);
    assertNoViolations(fixture);

    const overflow = await assertNoHorizontalOverflow(page, `RECEPTIONIST /patients/4 @${width}`);
    expect(overflow.overflows, JSON.stringify(overflow)).toBe(false);
    await test.info().attach(`reception-summary-${width}`, {
      body: JSON.stringify({ overflow, calls: fixture.manifest() }, null, 2),
      contentType: 'application/json',
    });
  });

  test(`F5 DENTIST · composición administrativa vertical @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'DENTIST');
    await open(page, fixture, '/patients/4');

    await expect(page.locator('h1')).toHaveText('Propio, Paciente');
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Datos administrativos', exact: true })).toBeVisible();
    for (const term of ['Email', 'Teléfono', 'Fecha de nacimiento', 'Notas administrativas']) {
      await expect(page.getByText(term, { exact: true }).first()).toBeVisible();
    }
    const admin = page.getByRole('heading', { name: 'Datos administrativos', exact: true });
    const clinical = page.getByRole('heading', { name: 'Observaciones del odontólogo', exact: true });
    await expect(clinical).toBeVisible();
    const [adminBox, clinicalBox] = await Promise.all([admin.boundingBox(), clinical.boundingBox()]);
    expect(adminBox).not.toBeNull();
    expect(clinicalBox).not.toBeNull();
    expect(adminBox!.y).toBeLessThan(clinicalBox!.y);
    expect(fixture.calls.some(call => call.path === '/api/patients/4/odontogram/reception-summary')).toBe(false);
    assertNoViolations(fixture);

    const overflow = await assertNoHorizontalOverflow(page, `DENTIST /patients/4 @${width}`);
    expect(overflow.overflows, JSON.stringify(overflow)).toBe(false);
    await test.info().attach(`dentist-admin-${width}`, {
      body: JSON.stringify({ adminY: adminBox!.y, clinicalY: clinicalBox!.y, overflow, calls: fixture.manifest() }, null, 2),
      contentType: 'application/json',
    });
  });

  test(`F5 PATIENT · ficha propia y ficha ajena @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'PATIENT');

    await open(page, fixture, '/patients/4');
    for (const heading of ['Mis datos', 'Mi información personal', 'Mi información de salud', 'Mi odontograma']) {
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
    for (const term of ['Correo de contacto', 'Teléfono', 'Fecha de nacimiento']) {
      await expect(page.getByText(term, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('12 de abril de 1990', { exact: true })).toBeVisible();
    await expect(page.getByRole('tablist')).toHaveCount(0);
    expect(fixture.calls.some(call => call.path === '/api/patients/4'), fixture.manifest()).toBe(true);
    expect(fixture.calls.filter(call => call.path.includes('/clinical')), fixture.manifest()).toEqual([]);
    assertNoViolations(fixture);

    reset(fixture);
    await page.goto('/patients/5');
    await expect(page.getByRole('alert')).toHaveText('No se encontró tu ficha de paciente. Contacta con la clínica.');
    expect(fixture.calls.filter(call => call.path === '/api/patients/5'), fixture.manifest()).toEqual([]);
    assertNoViolations(fixture);

    const overflow = await assertNoHorizontalOverflow(page, `PATIENT /patients/5 @${width}`);
    expect(overflow.overflows, JSON.stringify(overflow)).toBe(false);
    await test.info().attach(`patient-own-foreign-${width}`, {
      body: JSON.stringify({ overflow, calls: fixture.manifest() }, null, 2),
      contentType: 'application/json',
    });
  });

  test(`F5 DENTIST · pestañas de horario persistentes @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'DENTIST');
    await open(page, fixture, '/scheduling');

    const tablist = page.getByRole('tablist', { name: 'Gestionar mi horario' });
    await expect(tablist).toBeVisible();
    const tabs = tablist.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveAccessibleName('Mi semana');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[role="tabpanel"]')).toHaveCount(3);
    await expect(page.locator('[role="tabpanel"]:not([hidden])')).toHaveCount(1);

    await tabs.nth(1).click();
    await expect(page.getByRole('heading', { name: 'Excepciones por fecha', exact: true })).toBeVisible();
    await tabs.nth(2).click();
    await expect(page.getByRole('heading', { name: 'Ausencias programadas', exact: true })).toBeVisible();

    const newAbsence = page.getByRole('button', { name: 'Nueva ausencia' });
    await expect(newAbsence).toBeEnabled();
    await newAbsence.click();
    const form = page.getByRole('form', { name: 'Nueva ausencia' });
    await expect(form).toBeVisible();

    // Cambiar de pestaña no desmonta el editor: al volver sigue abierto.
    await tabs.nth(0).click();
    await expect(form).toBeHidden();
    await expect(page.getByRole('button', { name: 'Editar horario' })).toBeVisible();
    await tabs.nth(2).click();
    await expect(form).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/scheduling');
    expect(
      fixture.calls.filter(call => call.method !== 'GET' && call.path !== '/api/auth/refresh'),
      fixture.manifest(),
    ).toEqual([]);
    assertNoViolations(fixture);

    const overflow = await assertNoHorizontalOverflow(page, `DENTIST /scheduling @${width}`);
    await test.info().attach(`dentist-schedule-tabs-${width}`, {
      body: JSON.stringify({ overflow, calls: fixture.manifest() }, null, 2),
      contentType: 'application/json',
    });
  });
}
