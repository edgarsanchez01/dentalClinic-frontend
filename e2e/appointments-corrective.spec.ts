import { expect, test, type Page } from '@playwright/test';
import { uiUnificationFixture, type UiRole } from './uiUnificationFixture';
import { writeFile } from 'node:fs/promises';

const out = process.env.DC_APPOINTMENTS_EVIDENCE ?? '/tmp/opencode/dc-appointments-corrective';
const date = '2026-10-26';
const name = 'María Fernanda De la Fuente Rodríguez';
const service = 'Seguimiento integral de tratamiento odontológico y revisión de restauraciones prolongadas';
const entries = (['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const).map((status, index) => ({
  id: 101 + index, patientId: 4, patientFirstName: 'María Fernanda', patientLastName: 'De la Fuente Rodríguez',
  dentistId: 7, dentistFirstName: 'Ana', dentistLastName: 'Propietaria', startAt: `${date}T09:00:00Z`, endAt: `${date}T10:00:00Z`,
  durationMinutes: 60, status, occurrenceVersion: 2, createdByUserId: 1, createdAt: `${date}T07:00:00Z`, reason: 'Motivo conservado', notes: null,
  service: { id: 1, name: service, durationMinutes: 60, referencePrice: '100.00', description: null },
}));
async function fixture(page: Page, role: UiRole) {
  const api = await uiUnificationFixture(page, role);
  await page.route(url => url.pathname === '/api/appointments' || url.pathname === '/api/appointments/101' || url.pathname === '/api/availability', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    api.calls.push({ method: 'GET', path: url.pathname, params: url.searchParams, body: null, role, declared: true, allowed: true });
    if (url.pathname === '/api/appointments/101') return route.fulfill({ json: entries[0] });
    if (url.pathname === '/api/appointments') return route.fulfill({ json: { content: entries, page: 0, size: 100, totalElements: 4, totalPages: 1 } });
    const durationMinutes = url.searchParams.has('appointmentId') ? 60 : url.searchParams.get('serviceId') === '2' ? 45 : 60;
    const from = url.searchParams.get('from') ?? date;
    const slots = [10, 11, 14].map(hour => {
      const start = `${from}T${hour}:00:00Z`;
      const end = new Date(Date.parse(start) + durationMinutes * 60_000).toISOString();
      return { startDate: from, startTime: `${hour}:00:00`, endTime: end.slice(11, 19), start, end };
    });
    return route.fulfill({ json: { dentistId: Number(url.searchParams.get('dentistId')), timezone: 'UTC', durationMinutes, slots } });
  });
  return api;
}
async function ready(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: 'Citas', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}
async function readable(page: Page) {
  const persons = page.locator('.reception-agenda-results .reception-visit-person, .dc-day .reception-visit-person');
  await expect(persons.first()).toBeVisible();
  for (const person of await persons.all()) {
    await expect(person).toHaveCSS('display', 'grid');
    const geometry = await person.evaluate(el => ({ width: el.getBoundingClientRect().width, overflow: el.scrollWidth - el.clientWidth }));
    expect(geometry.width).toBeGreaterThan(180);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    await expect(person).toContainText(name);
    await expect(person).toContainText(service);
  }
}

for (const width of [1440, 768, 390]) for (const role of ['OWNER', 'RECEPTIONIST', 'DENTIST'] as const) {
  test(`Citas y slots ${role} ${width}`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: 1100 });
    const api = await fixture(page, role);
    const reference = role === 'RECEPTIONIST' && process.env.DC_APPOINTMENTS_REFERENCE
      ? await browser.newPage({ viewport: { width, height: 1100 }, locale: 'es-MX', timezoneId: 'UTC', reducedMotion: 'reduce' }) : null;
    if (reference) await fixture(reference, role);
    const compareReference = async (selector: string, phase: string) => {
      if (!reference) return;
      await page.mouse.move(0, 0); await reference.mouse.move(0, 0);
      const actual = await page.locator(selector).screenshot({ animations: 'disabled' });
      const original = await reference.locator(selector).screenshot({ animations: 'disabled' });
      const comparison = actual.equals(original) ? { maxDelta: 0, changedPixels: 0, pixels: 1 } : await page.evaluate(async urls => {
        const images = await Promise.all(urls.map(async url => createImageBitmap(await (await fetch(url)).blob())));
        const first = images[0]!, second = images[1]!;
        if (first.width !== second.width || first.height !== second.height) return { maxDelta: 255, changedPixels: Number.MAX_SAFE_INTEGER, pixels: 1 };
        const pixels = first.width * first.height;
        const canvas = document.createElement('canvas'); canvas.width = first.width; canvas.height = first.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(first, 0, 0); const a = context.getImageData(0, 0, canvas.width, canvas.height).data;
        context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(second, 0, 0);
        const b = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let changedPixels = 0, maxDelta = 0;
        for (let index = 0; index < a.length; index += 4) {
          let delta = 0;
          for (let channel = 0; channel < 4; channel++) delta = Math.max(delta, Math.abs(a[index + channel]! - b[index + channel]!));
          if (delta) changedPixels++; maxDelta = Math.max(maxDelta, delta);
        }
        images.forEach(image => image.close());
        return { maxDelta, changedPixels, pixels };
      }, [actual, original].map(image => `data:image/png;base64,${image.toString('base64')}`));
      // Solo redondeo de rasterización: como máximo 1/255 en <=0,01% de píxeles;
      // no se enmascara contenido, ni se toleran diferencias de geometría/color.
      const equal = comparison.maxDelta <= 1 && comparison.changedPixels / comparison.pixels <= .0001;
      await writeFile(`${out}/reference-${phase}-${width}.json`, JSON.stringify({ ...comparison, equal }));
      if (!equal) {
        await writeFile(`${out}/reference-${phase}-${width}-before.png`, original);
        await writeFile(`${out}/reference-${phase}-${width}-after.png`, actual);
      }
      expect(equal, `RECEPTIONIST sin cambios visuales: ${phase} ${width} ${JSON.stringify(comparison)}`).toBe(true);
    };
    const agenda = `/appointments?date=${date}&view=${role === 'RECEPTIONIST' && width >= 768 ? 'week' : 'day'}`;
    await ready(page, agenda);
    if (reference) await ready(reference, `${process.env.DC_APPOINTMENTS_REFERENCE}${agenda}`);
    await compareReference('.reception-operations', 'agenda');
    await expect(page.locator('.reception-agenda-heading')).toBeVisible();
    await expect(page.locator('.reception-agenda-controls')).toBeVisible();
    await readable(page); await fits(page);
    await page.screenshot({ path: `${out}/daily-${role}-${width}.png`, fullPage: true });
    for (const status of ['Programada', 'Completada', 'Cancelada', 'No asistió']) await expect(page.locator('.reception-visit-status').filter({ hasText: status }).first()).toBeVisible();
    if (role === 'OWNER') {
      for (const view of ['week', 'month']) {
        await ready(page, `/appointments?date=${date}&view=${view}`);
        await readable(page); await fits(page);
        if (view === 'week' && width === 1440) await page.screenshot({ path: `${out}/week-OWNER-${width}.png`, fullPage: true });
      }
    }
    if (role === 'DENTIST' && width >= 768) {
      await ready(page, `/appointments?date=${date}&view=week`);
      await readable(page); await fits(page);
      if (width === 1440) await page.screenshot({ path: `${out}/week-DENTIST-${width}.png`, fullPage: true });
      await ready(page, `/appointments?date=${date}&view=month`);
      await expect(page.locator('.reception-month-view')).toBeVisible(); await fits(page);
      if (width === 1440) await page.screenshot({ path: `${out}/month-DENTIST-${width}.png`, fullPage: true });
      await ready(page, agenda);
    }
    if (role === 'OWNER') await page.screenshot({ path: `${out}/agenda-${role}-${width}.png`, fullPage: true });

    // Detail and rescheduling retain their existing independent confirmation.
    const first = page.locator('.reception-visit').first();
    await first.click();
    await expect(page.getByRole('button', { name: 'Reprogramar', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reprogramar', exact: true }).click();
    const rescheduleSlot = page.getByRole('button', { name: '10:00–11:00', exact: true });
    await rescheduleSlot.click();
    await expect(rescheduleSlot).toContainText('60 min');
    await expect(rescheduleSlot).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Confirmar reprogramación', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: role === 'DENTIST' ? 'Reprogramar' : 'Cerrar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirmar reprogramación', exact: true })).toHaveCount(0);
    if (role === 'OWNER') await page.getByRole('button', { name: 'Volver', exact: true }).click();
    else await page.getByRole('link', { name: role === 'DENTIST' ? 'Volver a Agenda' : 'Volver a Citas', exact: true }).click();
    await expect(page).toHaveURL(role === 'OWNER' ? `/appointments?date=${date}&view=month` : agenda);

    await ready(page, `/appointments?date=${date}&view=day&create=1`);
    if (reference) await ready(reference, `${process.env.DC_APPOINTMENTS_REFERENCE}/appointments?date=${date}&view=day&create=1`);
    await compareReference('.reception-booking', 'step-1');
    await expect(page.locator('.reception-booking')).toHaveClass(/reception-booking--flat/);
    await page.getByRole('combobox', { name: 'Servicio', exact: true }).selectOption('1');
    await page.getByRole('combobox', { name: 'Paciente', exact: true }).fill('Paciente');
    await page.getByRole('option', { name: /Paciente Propio/ }).first().click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    const dentist = page.getByRole('combobox', { name: 'Dentista', exact: true });
    if (role === 'DENTIST') { await expect(dentist).toHaveValue('7'); await expect(dentist).toBeDisabled(); }
    else await dentist.selectOption('7');
    if (reference) {
      await reference.getByRole('combobox', { name: 'Servicio', exact: true }).selectOption('1');
      await reference.getByRole('combobox', { name: 'Paciente', exact: true }).fill('Paciente');
      await reference.getByRole('option', { name: /Paciente Propio/ }).first().click();
      await reference.getByRole('button', { name: 'Continuar', exact: true }).click();
      await reference.getByRole('combobox', { name: 'Dentista', exact: true }).selectOption('7');
      await reference.getByRole('button', { name: '10:00–11:00', exact: true }).focus();
      await reference.keyboard.press('Enter');
    }
    const slot = page.getByRole('button', { name: '10:00–11:00', exact: true });
    await slot.focus(); await page.keyboard.press('Enter');
    await expect(slot).toHaveAttribute('aria-pressed', 'true');
    await expect(slot).toContainText('60 min');
    await expect(slot).toContainText('Seleccionado');
    await expect.poll(async () => slot.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)');
    const selectedStyle = await slot.evaluate(el => {
      const css = getComputedStyle(el);
      return { background: css.backgroundColor, border: css.borderColor, shadow: css.boxShadow };
    });
    const otherStyle = await page.getByRole('button', { name: '14:00–15:00', exact: true }).evaluate(el => {
      const css = getComputedStyle(el);
      return { background: css.backgroundColor, border: css.borderColor, shadow: css.boxShadow };
    });
    expect(selectedStyle.background).not.toBe(otherStyle.background);
    expect(selectedStyle.border).not.toBe(otherStyle.border);
    expect(selectedStyle.shadow).toContain('inset');
    await test.info().attach('slot-visual-state', { body: JSON.stringify({ selectedStyle, otherStyle }), contentType: 'application/json' });
    await expect(page.getByRole('combobox', { name: /Hora ·/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Mañana', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tarde', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '11:00–12:00', exact: true })).toBeVisible();
    await fits(page);
    if (role === 'OWNER') await readable(page);
    await compareReference('.reception-booking', 'step-2');
    const recipe = await page.evaluate(() => {
      const selectors = ['.reception-agenda-heading', '.reception-booking', '.reception-stepper', '.reception-stepper-step', '.reception-step[data-active="true"]', '.reception-step-head', '.reception-step-head > span', '.booking-slot[aria-pressed="true"]'];
      return Object.fromEntries(selectors.map(selector => {
        const el = document.querySelector(selector)!; const css = getComputedStyle(el);
        return [selector, Object.fromEntries(['display', 'padding', 'gap', 'fontSize', 'borderWidth', 'borderRadius', 'backgroundColor', 'color'].map(property => [property, css[property as keyof CSSStyleDeclaration]]))];
      }));
    });
    await writeFile(`${out}/recipe-${role}-${width}.json`, JSON.stringify(recipe, null, 2));
    await page.screenshot({ path: `${out}/slots-${role}-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByLabel('Motivo', { exact: true }).fill('Borrador de confirmación');
    if (reference) {
      await reference.getByRole('button', { name: 'Continuar', exact: true }).click();
      await reference.getByLabel('Motivo', { exact: true }).fill('Borrador de confirmación');
    }
    await compareReference('.reception-booking', 'step-3');
    if (width === 390) await page.locator('.reception-booking').screenshot({ path: `${out}/review-${role}-${width}.png` });
    await page.getByRole('button', { name: 'Atrás', exact: true }).click();
    await expect(slot).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByLabel('Motivo', { exact: true })).toHaveValue('Borrador de confirmación');
    expect(api.calls.filter(c => c.method !== 'GET' && c.path !== '/api/auth/refresh')).toEqual([]);
    expect(api.violations, api.manifest()).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
    await reference?.close();
  });
}

for (const width of [1440, 390]) test(`Citas y slots OWNER personal ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1100 });
  const api = await fixture(page, 'OWNER');
  const agenda = `/appointments?scope=mine&date=${date}&view=day`;
  await ready(page, agenda);
  await readable(page); await fits(page);
  expect(api.calls.filter(c => c.path === '/api/appointments').every(c => c.params.get('dentistId') === '7')).toBe(true);
  await expect(page.getByRole('combobox', { name: 'Filtrar por dentista', exact: true })).toHaveCount(0);
  await page.locator('.reception-visit').first().click();
  expect(new URL(page.url()).searchParams.get('clinical')).toBe('1');
  await page.getByRole('link', { name: 'Volver a Agenda', exact: true }).click();
  await expect(page).toHaveURL(agenda);
  await page.getByRole('button', { name: 'Crear cita', exact: true }).click();
  await page.getByRole('combobox', { name: 'Servicio', exact: true }).selectOption('1');
  await page.getByRole('combobox', { name: 'Paciente', exact: true }).fill('Paciente');
  await page.getByRole('option', { name: /Paciente Propio/ }).first().click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Dentista', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Dentista', exact: true })).toHaveValue('7');
  await expect(page.getByRole('combobox', { name: /Hora ·/ })).toHaveCount(0);
  await page.getByRole('button', { name: '11:00–12:00', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Motivo', { exact: true }).fill('Borrador OWNER personal');
  await page.locator('a[href="/"]').first().click();
  await expect(page.getByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Motivo', { exact: true })).toHaveValue('Borrador OWNER personal');
  expect(api.calls.filter(c => c.method !== 'GET' && c.path !== '/api/auth/refresh')).toEqual([]);
  expect(api.violations, api.manifest()).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
});
