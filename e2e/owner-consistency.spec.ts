import { expect, test, type Locator, type Page } from '@playwright/test';
import { ownerUiFixture } from './ownerUiFixture';

async function open(page: Page, role: string, path: string) {
  const calls = await ownerUiFixture(page, role);
  await page.clock.setFixedTime(new Date('2026-10-26T08:00:00Z'));
  await page.goto(path);
  await expect(page.locator('h1')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('status', { name: /^Cargando / })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  return calls;
}
async function style(locator: Locator, compactVisit = false) {
  return locator.first().evaluate((el, compact) => {
    const css = getComputedStyle(el);
    return Object.fromEntries(['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color', 'border-radius', ...(compact ? [] : ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']), 'min-height'].map(key => [key, css.getPropertyValue(key)]));
  }, compactVisit);
}

for (const width of [1440, 768, 390, 320]) {
  test(`Inicio administrativo OWNER usa el lenguaje de Recepción ${width}`, async ({ browser }) => {
    const owner = await browser.newPage({ viewport: { width, height: 1000 } });
    const reception = await browser.newPage({ viewport: { width, height: 1000 } });
    try {
      await open(owner, 'OWNER', '/'); await open(reception, 'RECEPTIONIST', '/');
      for (const selector of ['.reception-desk', 'h1', '.reception-journal-cover', '.reception-today-sheet', '.reception-visit', '.reception-visit-status', '.reception-button']) {
        expect(await style(owner.locator(selector), selector === '.reception-visit'), selector).toEqual(await style(reception.locator(selector), selector === '.reception-visit'));
      }
      await expect(owner.locator('.owner-home-hybrid, .oh-card, .oh-metric')).toHaveCount(0);
      for (const name of ['Cartera pendiente', 'Cobrado este mes', 'Evaluación global', 'Resumen financiero', 'Personal pendiente de activación']) await expect(owner.getByRole('region', { name, exact: true })).toHaveCount(1);
      expect(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await owner.close(); await reception.close(); }
  });

  test(`Inicio clínico OWNER reutiliza DENTIST ${width}`, async ({ browser }) => {
    const owner = await browser.newPage({ viewport: { width, height: 1000 } });
    const dentist = await browser.newPage({ viewport: { width, height: 1000 } });
    try {
      await open(owner, 'OWNER', '/?scope=mine'); await open(dentist, 'DENTIST', '/');
      for (const selector of ['.dentist-home', 'h1', '.dentist-highlight', '.dentist-visit', '.dentist-status', '.dentist-notification', '.dentist-button']) {
        expect(await style(owner.locator(selector)), selector).toEqual(await style(dentist.locator(selector)));
      }
      await expect(owner.getByRole('link', { name: 'Mi horario', exact: true })).toHaveAttribute('href', '/scheduling?scope=mine');
      await expect(owner.locator('.owner-home-hybrid, .op-visit')).toHaveCount(0);
      expect(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await owner.close(); await dentist.close(); }
  });

  test(`Citas OWNER reutiliza controles y visitas de Recepción ${width}`, async ({ browser }) => {
    const owner = await browser.newPage({ viewport: { width, height: 1000 } });
    const reception = await browser.newPage({ viewport: { width, height: 1000 } });
    const path = '/appointments?date=2026-10-26&view=week';
    try {
      await open(owner, 'OWNER', path); await open(reception, 'RECEPTIONIST', path);
      for (const selector of ['h1', '.reception-agenda-heading .reception-button', 'input[aria-label="Fecha"]', '.reception-visit-person > strong', '.reception-visit-status']) {
        // Mobile reception intentionally uses day cards; typography, palette and
        // controls still share the same source. Week/day card padding may differ.
        const actual = await style(owner.locator(selector), selector === '.reception-visit-person > strong');
        const reference = await style(reception.locator(selector), selector === '.reception-visit-person > strong');
        // Grid vs. block changes the computed intrinsic minimum, not title identity.
        if (selector === 'h1') { delete actual['min-height']; delete reference['min-height']; }
        if (width < 768 && selector === '.reception-agenda-heading .reception-button') {
          // Approved compact header keeps type, height, colors and vertical padding.
          expect(actual['padding-left']).toBe('12px'); expect(actual['padding-right']).toBe('12px');
          for (const property of ['padding-left', 'padding-right']) { delete actual[property]; delete reference[property]; }
        }
        expect(actual, selector).toEqual(reference);
      }
      await expect(owner.locator('.owner-week')).toHaveCount(1);
      await expect(owner.locator('.oa-visit, .oa-toolbar, .oa-status')).toHaveCount(0);
    } finally { await owner.close(); await reception.close(); }
  });
}

if (process.env.DC_OWNER_APPOINTMENTS_BASELINE) for (const personal of [false, true]) {
  test(`Inicio ${personal ? 'personal' : 'clínica'} conserva todas las consultas`, async ({ browser }) => {
    const current = await browser.newPage(), before = await browser.newPage();
    try {
      const path = personal ? '/?scope=mine' : '/';
      const calls = await open(current, 'OWNER', `http://127.0.0.1:5296${path}`);
      const reads = (items: typeof calls) => items.map(c => `${c.method} ${c.path}?${[...c.params].sort().map(([k, v]) => `${k}=${v}`).join('&')}`).sort();
      const snapshot = reads(calls);
      const oldCalls = await open(before, 'OWNER', `http://127.0.0.1:5295${path}`);
      expect(snapshot).toEqual(reads(oldCalls));
    } finally { await current.close(); await before.close(); }
  });
}
