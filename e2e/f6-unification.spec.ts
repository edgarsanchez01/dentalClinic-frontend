import { expect, test, type Page } from '@playwright/test';
import { uiUnificationFixture, type UiFixtureResult } from './uiUnificationFixture';

function clean(fixture: UiFixtureResult) {
  expect(fixture.violations, fixture.manifest()).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
}
async function ready(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('h1')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}
async function patient(page: Page) {
  const picker = page.getByRole('combobox', { name: 'Paciente', exact: true });
  await picker.fill('Paciente');
  const option = page.getByRole('option', { name: /Paciente Propio/ }).first();
  await expect(option).toBeVisible();
  await picker.press('ArrowDown');
  await picker.press('Enter');
  await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeEnabled();
}

for (const width of [1440, 390]) {
  test(`F6 Recepción reserva sin capas anidadas, teclado y borrador @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'RECEPTIONIST');
    const path = '/appointments?create=1&date=2026-10-26&view=week&status=SCHEDULED';
    await ready(page, path);
    await expect(page.getByText(/Contexto de agenda/)).toBeVisible();
    await page.getByRole('combobox', { name: 'Servicio', exact: true }).selectOption('1');
    await patient(page);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.locator('#reception-step-2')).toBeFocused();
    await page.getByRole('combobox', { name: 'Dentista', exact: true }).selectOption('7');
    const slot = page.getByRole('button', { name: '10:00–11:00', exact: true });
    await slot.focus(); await page.keyboard.press('Enter');
    await expect(slot).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.locator('#reception-step-3')).toBeFocused();
    await page.getByLabel('Motivo', { exact: true }).fill('Borrador F6');
    await page.getByRole('button', { name: 'Atrás', exact: true }).click();
    await expect(slot).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByLabel('Motivo', { exact: true })).toHaveValue('Borrador F6');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/opencode/dc-ui-f6/booking-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Volver a la agenda', exact: true }).click();
    await page.getByRole('button', { name: 'Crear cita', exact: true }).click();
    // Cerrar/reabrir reinicia la reserva en el flujo previo; no se añade persistencia.
    await expect(page.locator('#reception-step-1')).toBeVisible();
    await expect(page.getByLabel('Motivo', { exact: true })).toHaveValue('');
    expect(new URL(page.url()).searchParams.get('status')).toBe('SCHEDULED');
    expect(new URL(page.url()).searchParams.get('view')).toBe('week');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    clean(fixture);
  });

  test(`F6 Recepción no asistencia única, reprogramación y retorno @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'RECEPTIONIST');
    const back = '/appointments?date=2026-10-26&view=day&dentistId=7&status=SCHEDULED';
    const detail = `/appointments/21?returnTo=${encodeURIComponent(back)}`;
    await ready(page, detail);
    await expect(page.getByRole('button', { name: 'Registrar no asistencia' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Registrar no asistencia' })).toBeDisabled();
    await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
    await ready(page, detail);
    const actions = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Acciones', exact: true }) });
    await actions.getByRole('button', { name: 'Registrar no asistencia' }).click();
    await expect(page.getByRole('button', { name: 'Sí, no asistió' })).toHaveCount(1);
    await actions.getByRole('button', { name: 'No', exact: true }).click();
    await actions.getByRole('button', { name: 'Reprogramar', exact: true }).click();
    await page.getByRole('button', { name: '10:00–11:00', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirmar reprogramación' })).toBeEnabled();
    await actions.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await actions.getByRole('button', { name: 'Reprogramar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirmar reprogramación' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Completar|Iniciar|Registrar llegada/ })).toHaveCount(0);
    await page.getByRole('link', { name: 'Volver a Citas', exact: true }).click();
    await expect(page).toHaveURL(back);
    expect(fixture.calls.some(c => /clinical|odontogram/.test(c.path))).toBe(false);
    clean(fixture);
  });

  test(`F6 DENTIST profesional propio y cancelación de salida conserva borrador @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'DENTIST');
    await ready(page, '/appointments?create=1&date=2026-10-26');
    await page.getByRole('combobox', { name: 'Servicio', exact: true }).selectOption('1');
    await patient(page);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Dentista', exact: true })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: 'Dentista', exact: true })).toHaveValue('7');
    await page.getByRole('button', { name: '10:00–11:00', exact: true }).click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByLabel('Motivo', { exact: true }).fill('Borrador profesional');
    await page.locator('a[href="/"]').first().click();
    await expect(page.getByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Motivo', { exact: true })).toHaveValue('Borrador profesional');
    await expect(page.getByRole('button', { name: 'Reservar cita' })).toBeEnabled();
    clean(fixture);
  });

  test(`F6 PATIENT tarjetas y borrador con protección de salida @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const fixture = await uiUnificationFixture(page, 'PATIENT');
    await ready(page, '/appointments?create=1&date=2026-10-26');
    await page.getByRole('radio', { name: 'Consulta de valoración', exact: true }).check();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByLabel('Dentista', { exact: true }).selectOption('7');
    await page.getByRole('button', { name: '10:00–11:00', exact: true }).click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByLabel('Motivo (opcional)').fill('Borrador propio');
    await page.getByRole('button', { name: 'Anterior', exact: true }).click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByLabel('Motivo (opcional)')).toHaveValue('Borrador propio');
    await page.locator('a[href="/"]').first().click();
    await page.getByRole('button', { name: 'Seguir aquí', exact: true }).click();
    await expect(page.getByLabel('Motivo (opcional)')).toHaveValue('Borrador propio');
    expect(fixture.calls.some(c => /\/api\/services|\/clinical|\/schedules\/clinic/.test(c.path))).toBe(false);
    clean(fixture);
  });

  if (process.env.DC_F6_REFERENCE) test(`F6 OWNER composición recuperada Día/Semana/Mes clínica y personal @${width}`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: 900 });
    const current = await uiUnificationFixture(page, 'OWNER');
    const reference = await browser.newPage({ viewport: { width, height: 900 }, locale: 'es-MX', timezoneId: 'UTC', reducedMotion: 'reduce' });
    const previous = await uiUnificationFixture(reference, 'OWNER');
    const presentation = (p: Page) => p.locator('.owner-agenda-heading, .owner-agenda-tools, .reception-agenda-results').evaluateAll(roots => roots.flatMap(root => [root, ...root.querySelectorAll('*')]).map(el => {
      const css = getComputedStyle(el), box = el.getBoundingClientRect();
      return { tag: el.tagName, text: el.textContent?.replace(/\s+/g, ' ').trim(), classes: el.getAttribute('class'),
        box: { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height },
        css: Object.fromEntries(Array.from(css).filter(name => !name.startsWith('--')).map(name => [name, css.getPropertyValue(name)])) };
    }));
    for (const personal of [false, true]) for (const view of ['day', 'week', 'month']) {
      const path = `/appointments?${personal ? 'scope=mine&' : ''}date=2026-10-26&view=${view}`;
      await ready(page, path);
      await ready(reference, `${process.env.DC_F6_REFERENCE}${path}`);
      // Sin hover/foco ni transiciones en la comparación; no cambia la aplicación.
      for (const p of [page, reference]) {
        await p.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
        await p.mouse.move(0, 0);
      }
      expect(await presentation(page), `${personal ? 'personal' : 'clínica'} ${view}`).toEqual(await presentation(reference));
    }
    clean(current); clean(previous);
    await reference.close();
  });
}
