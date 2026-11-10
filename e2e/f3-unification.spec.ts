import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { NOW, uiUnificationFixture, type UiRole } from './uiUnificationFixture';

const stage = process.env.DC_UI_F3_STAGE;
if (stage !== 'before' && stage !== 'after') throw new Error('Explicit F3 stage required');
const folder = `/tmp/opencode/dc-ui-f3/${stage}`;
const cases: Array<[UiRole, string, number, number]> = [
  ['DENTIST', '/services', 1440, 1000], ['OWNER', '/services', 390, 844],
  ['DENTIST', '/reviews', 1440, 1000], ['OWNER', '/reviews', 390, 844],
  ['RECEPTIONIST', '/notifications', 1440, 1000], ['OWNER', '/notifications', 1440, 1000], ['PATIENT', '/notifications', 390, 844],
  ['OWNER', '/change-password', 1440, 1000], ['RECEPTIONIST', '/change-password', 390, 844],
  ['DENTIST', '/change-password', 768, 1024], ['PATIENT', '/change-password', 320, 740],
];

for (const [role, route, width, height] of cases) test(`${role} ${route} ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  const f = await uiUnificationFixture(page, role);
  let read = false, marks = 0;
  const notification = () => ({ id: 501, title: 'Aviso sintético F3', body: 'Contenido literal.\nSegunda línea.', priority: 'HIGH', read, createdAt: NOW });
  if (route === '/notifications') {
    await page.route(url => url.pathname === '/api/notifications', async r => {
      expect(r.request().method()).toBe('GET');
      await r.fulfill({ json: { content: [notification()], page: 0, size: 20, totalPages: 1, totalElements: 1 } });
    });
    await page.route('**/api/notifications/501/read', async r => {
      expect(r.request().method()).toBe('POST'); expect(r.request().postData()).toBeNull();
      marks++; read = true; await r.fulfill({ json: notification() });
    });
  }
  await page.goto(route);
  const main = page.locator('main').first();
  await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1);
  if (route === '/services') await expect(page.getByRole('article').first()).toBeVisible();
  if (route === '/reviews') await expect(page.getByText('Reseñas recibidas', { exact: true })).toBeVisible();
  if (route === '/notifications') await expect(page.getByRole('heading', { name: notification().title })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  await page.mouse.move(0, 0);
  const metrics = await main.evaluate(el => ({
    viewport: [innerWidth, innerHeight], scrollWidth: document.documentElement.scrollWidth,
    elements: Array.from(el.querySelectorAll('h1,h2,h3,article,dt,dd,input,select,time,button')).map(node => {
      const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
      return { tag: node.tagName, text: node.textContent, rect: [rect.x, rect.y, rect.width, rect.height],
        font: css.font, color: css.color, background: css.backgroundColor };
    }),
  }));
  await mkdir(folder, { recursive: true });
  const key = `${role}-${route.slice(1)}-${width}`;
  await writeFile(path.join(folder, `${key}.json`), JSON.stringify(metrics), { flag: 'wx' });
  await writeFile(path.join(folder, `${key}.png`), await page.screenshot({ fullPage: false }), { flag: 'wx' });
  if (stage === 'after') {
    await expect(page.locator('main')).toHaveCount(1);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(width);
    if (route === '/services') {
      await page.getByLabel('Estado', { exact: true }).selectOption('active');
      await expect.poll(() => f.calls.some(c => c.path === '/api/services' && c.params.get('active') === 'true')).toBe(true);
      if (role === 'OWNER') {
        const edit = page.getByRole('button', { name: /^Editar / }).first();
        await edit.click(); await expect(page.getByRole('form', { name: 'Editar servicio' })).toBeVisible();
        await page.getByRole('button', { name: 'Cancelar', exact: true }).click(); await expect(edit).toBeFocused();
      } else await expect(page.getByRole('button', { name: /^Editar |Nuevo servicio/ })).toHaveCount(0);
    }
    if (route === '/reviews') await expect(page.getByRole('article').first()).toHaveAttribute('aria-label', /Reseña:/);
    if (route === '/notifications') {
      expect(marks).toBe(0);
      if (role !== 'PATIENT') await expect(page.locator('main time')).toContainText('UTC');
      else await expect(page.locator('main time')).not.toContainText('UTC');
      await page.getByRole('button', { name: 'Marcar como leída', exact: true }).click();
      await expect(page.getByRole('article')).toContainText('Leída'); expect(marks).toBe(1);
      await expect(page.getByRole('button', { name: 'Marcar como leída', exact: true })).toHaveCount(0);
    }
    if (route === '/change-password') {
      const bounds = await page.locator('.auth-content').evaluate(el => {
        const r = el.getBoundingClientRect(), container = el.closest('.ce-page')!.getBoundingClientRect();
        return { width: r.width, left: r.left - container.left, right: container.right - r.right };
      });
      expect(bounds.width).toBeLessThanOrEqual(560); expect(Math.abs(bounds.left - bounds.right)).toBeLessThan(1);
      await page.getByLabel('Nueva contraseña', { exact: true }).fill('clave sintética');
      await page.getByLabel('Repite la nueva contraseña', { exact: true }).fill('distinta');
      await page.getByRole('button', { name: 'Cambiar contraseña', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Las contraseñas no coinciden.');
    }
  }
  expect(f.violations, f.manifest()).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
});
