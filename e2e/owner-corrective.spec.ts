import { expect, test, type Locator, type Page } from '@playwright/test';
import { uiUnificationFixture } from './uiUnificationFixture';

const out = '/tmp/opencode/dc-owner-corrective';
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('h1')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}
async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (overflow > 1) console.log('Overflow', await page.evaluate(() => [...document.querySelectorAll('main *')]
    .filter(el => el.getBoundingClientRect().right > innerWidth + 1 && !el.closest('.financial-table-region'))
    .map(el => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right })).slice(0, 20)));
  expect(overflow).toBeLessThanOrEqual(1);
}
async function paper(panel: Locator) {
  await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(panel).toHaveCSS('border-top-width', '1px');
  await expect(panel).toHaveCSS('border-radius', '12px');
}
async function visualStyle(locator: Locator) {
  return locator.first().evaluate(el => {
    const css = getComputedStyle(el);
    return Object.fromEntries(['font-size', 'font-weight', 'color', 'background-color', 'border-radius', 'border-top-width', 'border-top-color', 'padding-top', 'padding-left'].map(key => [key, css.getPropertyValue(key)]));
  });
}
for (const width of [1440, 768, 390]) {
  test(`correctivo OWNER superficies, formularios y reflujo ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const api = await uiUnificationFixture(page, 'OWNER');
    await open(page, '/finances');
    await noOverflow(page);
    for (const name of ['Atenciones por cobrar', 'Reportes financieros', 'Crear cargo manual']) {
      const action = page.locator('.reception-page-actions').getByRole('link', { name, exact: true });
      await expect(action).toBeVisible();
      const box = await action.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    const filter = page.getByRole('form', { name: 'Filtrar cargos' });
    await filter.getByText('Filtros avanzados', { exact: true }).click();
    await filter.getByLabel('Estado del cargo', { exact: true }).selectOption('PENDIENTE');
    await filter.getByRole('button', { name: 'Aplicar filtros', exact: true }).first().click();
    await expect(page).toHaveURL(/status=PENDIENTE/);
    await page.screenshot({ path: `${out}/finances-${width}.png` });

    await open(page, '/finances/reports?tab=cobros&from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-27T00%3A00%3A00.000Z');
    await expect(page.locator('.reception-finances-period')).toContainText('fin exclusivo');
    await noOverflow(page);
    await page.screenshot({ path: `${out}/reports-${width}.png` });

    await open(page, '/scheduling');
    const weeks = page.locator('.schedule-owner-management .schedule-week-primary');
    await expect(weeks).toHaveCount(2);
    for (const week of await weeks.all()) await paper(week);
    await expect(weeks.first().locator('fieldset')).toHaveCount(7);
    const start = page.getByRole('region', { name: 'Gestión de clínica', exact: true }).getByLabel('Inicio Lunes', { exact: true });
    const handle = await start.elementHandle();
    await start.fill('08:15');
    await page.getByRole('navigation', { name: 'Apartados de horarios' }).getByRole('link', { name: 'Disponibilidad', exact: true }).click();
    await page.locator('#availability-dentist').selectOption('8');
    await expect(page.locator('#schedule-professionals select').first()).toHaveValue('7');
    await expect(start).toHaveValue('08:15');
    expect(await start.evaluate((el, old) => el === old, handle)).toBe(true);
    expect(api.calls.filter(c => /^\/api\/schedules\/dentist\/8(?:\/|$)/.test(c.path))).toHaveLength(0);
    await noOverflow(page);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${out}/scheduling-${width}.png`, fullPage: true });

    await open(page, '/clinic');
    const clinic = page.getByRole('form', { name: 'Configuración de la clínica' });
    await paper(clinic);
    await expect(clinic.getByRole('textbox')).toHaveCount(9);
    await expect(clinic.getByRole('region')).toHaveCount(3);
    await expect(clinic.locator('.ce-surface--paper')).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: `${out}/clinic-${width}.png`, fullPage: true });

    await open(page, '/services');
    await expect(page.locator('.ce-feedback')).toBeEmpty();
    await expect(page.locator('.ce-feedback')).toHaveCSS('display', 'none');
    await page.getByRole('button', { name: 'Nuevo servicio', exact: true }).click();
    const editor = page.getByRole('form', { name: 'Crear servicio' });
    await paper(editor);
    await expect(editor.getByLabel('Nombre', { exact: true })).toBeFocused();
    await editor.getByRole('button', { name: 'Guardar servicio' }).click();
    await expect(editor.getByLabel('Nombre', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await noOverflow(page);
    if (width !== 768) await page.screenshot({ path: `${out}/services-${width}.png` });
    await editor.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Nuevo servicio', exact: true })).toBeFocused();

    await open(page, '/users');
    const invitation = page.locator('#team-invitation');
    await paper(invitation.locator(':scope > section'));
    await page.getByRole('button', { name: 'Invitar al equipo', exact: true }).click();
    await expect(invitation.getByLabel('Email', { exact: true })).toBeFocused();
    await noOverflow(page);
    if (width !== 768) await page.screenshot({ path: `${out}/users-${width}.png` });
    expect(api.violations, api.manifest()).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
  });

  test(`correctivo recetas compartidas RECEPTIONIST/PATIENT ${width}`, async ({ browser }) => {
    const owner = await browser.newPage({ viewport: { width, height: 1000 } });
    const reception = await browser.newPage({ viewport: { width, height: 1000 } });
    const patient = await browser.newPage({ viewport: { width, height: 1000 } });
    const fixtures = await Promise.all([uiUnificationFixture(owner, 'OWNER'), uiUnificationFixture(reception, 'RECEPTIONIST'), uiUnificationFixture(patient, 'PATIENT')]);
    try {
      for (const path of ['/finances', '/finances/reports', '/services']) {
        await open(owner, path); await open(reception, path);
        const selector = path === '/services' ? '.rc-service' : 'table th';
        expect(await visualStyle(owner.locator(selector))).toEqual(await visualStyle(reception.locator(selector)));
        await noOverflow(reception);
      }
      await open(reception, '/scheduling');
      await paper(reception.locator('.rs-professional'));
      await expect(reception.locator('.rs-calendar-columns')).toHaveCount(1);
      await expect(reception.getByRole('button', { name: 'Guardar horario' })).toHaveCount(0);
      await noOverflow(reception);
      for (const target of [owner, reception, patient]) {
        await open(target, '/change-password');
        await expect(target.locator('form')).toHaveCount(1);
        await expect(target.locator('.auth-footer')).toHaveCSS('margin-top', '24px');
        expect(await visualStyle(target.locator('#new-password'))).toEqual(await visualStyle(owner.locator('#new-password')));
        await noOverflow(target);
      }
      await open(patient, '/notifications');
      await expect(patient.locator('.patient-notification').first()).toBeVisible();
      await noOverflow(patient);
      for (const api of fixtures) expect(api.violations, api.manifest()).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
    } finally { await owner.close(); await reception.close(); await patient.close(); }
  });
}
