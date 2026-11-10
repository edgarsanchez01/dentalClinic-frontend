import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { NOW, uiUnificationFixture, type UiRole } from './uiUnificationFixture';

const stage = process.env.DC_UI_F1_STAGE;
if (stage !== 'before' && stage !== 'after') throw new Error('DC_UI_F1_STAGE debe ser before o after. No se sobrescribe la baseline.');
const root = '/tmp/opencode/dc-ui-unification-f1';
const day = '/appointments?view=day&date=2026-10-26';
const week = '/appointments?view=week&date=2026-10-26';
const routes: Record<UiRole, string[]> = {
  PATIENT: ['/', '/appointments', '/patients/4', '/patient-profile', '/notifications'],
  RECEPTIONIST: ['/', '/patients', '/services', '/notifications', '/scheduling', '/finances', '/collections'],
  DENTIST: ['/', '/patients', '/services', '/notifications', '/reviews', '/scheduling'],
  OWNER: ['/', '/?scope=mine', day, week, `${day}&scope=mine`, `${week}&scope=mine`, '/collections', '/patients/4', '/clinic'],
};

async function compare(page: Page, key: string, calls: () => string[]) {
  // En `/` existe un h1 público transitorio antes de hidratar. No es la pantalla privada.
  if (!key.startsWith('auth-')) {
    const role = key.split('-')[0];
    const shell = role === 'receptionist' ? 'reception' : role;
    await expect(page.locator(`.${shell}-shell main h1`)).toHaveCount(1);
  }
  await expect(page.locator('h1')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('status', { name: /^Cargando / })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: /^(?:Cargando|Consultando|Restaurando)/ })).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  const metrics = await page.evaluate(() => {
    const properties = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'background-color', 'border-radius', 'padding', 'margin', 'gap', 'display', 'min-height', 'border', 'box-shadow', 'overflow-x'];
    const tokens = ['--auth-petrol', '--auth-secondary', '--auth-sage', '--auth-canvas', '--auth-paper', '--auth-ink', '--auth-muted', '--auth-border', '--auth-divider', '--auth-hover', '--auth-radius', '--primary', '--foreground-secondary', '--surface-sunken', '--shadow-card'];
    return {
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      elements: Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !['SCRIPT', 'STYLE'].includes(el.tagName);
      }).map(el => {
        const css = getComputedStyle(el), r = el.getBoundingClientRect();
        return {
          tag: el.tagName, class: el.getAttribute('class'), role: el.getAttribute('role'),
          text: Array.from(el.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim(),
          rect: [r.x, r.y, r.width, r.height].map(n => Math.round(n * 1000) / 1000),
          styles: Object.fromEntries([...properties, ...tokens].map(p => [p, css.getPropertyValue(p)])),
        };
      }),
    };
  });
  const data = { metrics, calls: [...new Set(calls())].sort() };
  await mkdir(path.join(root, stage!), { recursive: true });
  const destination = path.join(root, stage!, key);
  if (stage === 'after') {
    const previous: unknown = JSON.parse(await readFile(path.join(root, 'before', `${key}.json`), 'utf8'));
    expect(data, `DOM visible/estilos/geometría/lecturas ${key}`).toEqual(previous);
  }
  await writeFile(`${destination}.json`, JSON.stringify(data), { flag: 'wx' });
  await writeFile(`${destination}.png`, await page.screenshot({ fullPage: true }), { flag: 'wx' });
}

for (const width of [1440, 768, 390, 320]) {
  for (const role of Object.keys(routes) as UiRole[]) {
    test(`${role} · preservación F1 ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const fixture = await uiUnificationFixture(page, role);
      for (const [index, route] of routes[role].entries()) {
        fixture.calls.length = 0;
        await page.goto(route);
        await compare(page, `${role.toLowerCase()}-${index}-${width}`, () => fixture.calls.map(call => `${call.method} ${call.path}?${call.params}`));
        expect(fixture.violations.undeclared, fixture.manifest()).toEqual([]);
        expect(fixture.violations.forbidden, fixture.manifest()).toEqual([]);
        expect(fixture.violations.blockedWrites, fixture.manifest()).toEqual([]);
      }
    });
  }
  test(`AUTH · preservación F1 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date(NOW));
    const calls: string[] = [];
    await page.route(url => url.pathname.startsWith('/api/'), async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      calls.push(`${request.method()} ${pathname}`);
      if (request.method() === 'POST' && pathname === '/api/auth/refresh') { await route.fulfill({ status: 401 }); return; }
      if (request.method() === 'GET' && pathname === '/api/onboarding/status') { await route.fulfill({ json: { status: 'COMPLETED', clinicConfigured: true } }); return; }
      throw new Error(`API no declarada: ${request.method()} ${pathname}`);
    });
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login$/);
    await compare(page, `auth-0-${width}`, () => calls);
  });
}
