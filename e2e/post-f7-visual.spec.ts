import { writeFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { uiUnificationFixture } from './uiUnificationFixture';

const before = !!process.env.DC_POST_F7_BEFORE;
const out = '/tmp/opencode/dc-ui-post-f7';
const routes = ['/finances', '/finances/reports', '/reviews', '/services', '/scheduling', '/users', '/clinic', '/notifications', '/change-password'];
const shared = routes.filter(route => !['/reviews', '/users', '/clinic'].includes(route));
const properties = ['color', 'background-color', 'font-size', 'font-weight', 'line-height', 'border-radius', 'box-shadow', 'outline-color', 'outline-width', 'outline-offset', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'];
async function style(locator: Locator) {
  return locator.evaluate((el, keys) => {
    const css = getComputedStyle(el);
    return Object.fromEntries(keys.map(key => [key, css.getPropertyValue(key)]));
  }, properties);
}
async function open(page: Page, route: string) {
  await page.goto(route);
  await expect(page.locator('h1')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}
async function chrome(page: Page, width: number) {
  // Chromium must paint the page being compared, not the background role tab.
  await page.bringToFront();
  if (width < 768) await page.getByRole('button', { name: 'Abrir menú de navegación' }).click();
  const navigation = page.getByRole('navigation', { name: width < 768 ? 'Navegación móvil' : 'Navegación de escritorio', exact: true });
  await page.mouse.move(width - 1, 0);
  const active = navigation.locator('[aria-current="page"]');
  const inactive = navigation.locator('a:not([aria-current])').first();
  await expect(inactive).toHaveCSS('color', 'rgb(82, 118, 111)');
  const result = { shell: await style(page.locator('.owner-shell, .reception-shell').first()), surface: await style(page.locator(width < 768 ? 'dialog[open]' : 'aside')), active: await style(active), normal: await style(inactive), hover: {}, focus: {} };
  await inactive.hover();
  await expect(inactive).toHaveCSS('color', 'rgb(25, 63, 67)');
  result.hover = await style(inactive);
  await page.mouse.move(width - 1, 0);
  await expect.poll(() => inactive.evaluate(el => el.matches(':hover'))).toBe(false);
  await inactive.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(inactive).toBeFocused();
  expect(await inactive.evaluate(el => el.matches(':focus-visible'))).toBe(true);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  if (!before) {
    await expect(inactive).toHaveCSS('outline-width', '2px');
    await expect(inactive).toHaveCSS('outline-offset', '2px');
  }
  result.focus = await style(inactive);
  return result;
}

for (const width of [1440, 768, 390]) {
  test(`post-F7 sidebar y módulos ${width}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const owner = await browser.newPage({ viewport: { width, height: 1000 } });
    const reception = await browser.newPage({ viewport: { width, height: 1000 } });
    const ownerFixture = await uiUnificationFixture(owner, 'OWNER');
    const receptionFixture = await uiUnificationFixture(reception, 'RECEPTIONIST');
    const measurements: Record<string, unknown> = {};
    try {
      await open(reception, '/scheduling');
      const reference = await chrome(reception, width);
      for (const route of routes) {
        await open(owner, route);
        const overflow = await owner.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        measurements[`${route}:overflow`] = overflow;
        if (['/scheduling', '/clinic'].includes(route)) expect(overflow, route).toBeLessThanOrEqual(1);
        const actual = await chrome(owner, width);
        measurements[route] = actual;
        if (!before) expect.soft(actual, route).toEqual(reference);
        if (['/scheduling', '/clinic'].includes(route)) {
          if (width < 768) await owner.getByRole('button', { name: 'Cerrar menú' }).click();
          await owner.mouse.move(0, 0);
          await owner.locator('h1').click();
          if (!process.env.DC_POST_F7_NO_CAPTURE) await owner.screenshot({ path: `${out}/${before ? 'before' : 'after'}-${route.slice(1)}-${width}.png`, fullPage: true });
          if (route === '/scheduling') {
            const fieldset = owner.locator('#schedule-clinic form > fieldset').first();
            measurements.week = await style(fieldset);
            if (!before) {
              expect((await style(fieldset))['background-color']).toBe('rgba(0, 0, 0, 0)');
              await expect(owner.locator('main')).not.toContainText(/franquicia/i);
              await expect(owner.getByRole('heading', { name: 'Ausencias', exact: true })).toBeVisible();
            }
          }
        }
      }
      if (width < 768) await reception.getByRole('button', { name: 'Cerrar menú' }).click();
      if (!process.env.DC_POST_F7_NO_CAPTURE) await reception.screenshot({ path: `${out}/${before ? 'before' : 'after'}-reception-scheduling-${width}.png`, fullPage: true });
      for (const route of shared.filter(route => route !== '/scheduling')) {
        await open(reception, route);
        if (!before) expect.soft(await chrome(reception, width), route).toEqual(reference);
      }
      expect(ownerFixture.violations, ownerFixture.manifest()).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
      expect(receptionFixture.violations, receptionFixture.manifest()).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
      writeFileSync(`${out}/${before ? 'before' : 'after'}-styles-${width}.json`, JSON.stringify({ reference, measurements }, null, 2));
    } finally { await owner.close(); await reception.close(); }
  });
}
