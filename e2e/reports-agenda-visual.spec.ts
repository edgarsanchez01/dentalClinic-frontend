import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { uiUnificationFixture } from './uiUnificationFixture';

const out = '/tmp/opencode/dc-reports-agenda-visual';
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('h1')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}
async function figures(page: Page, columns: number) {
  const grid = page.locator('.financial-report-figures');
  await expect(grid).toBeVisible();
  await expect.poll(() => grid.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(columns);
  for (const figure of await page.locator('.reception-finances-report-figure').all()) {
    const value = figure.locator('.report-figure-number');
    await expect(value).toBeVisible();
    expect(await value.textContent()).toMatch(/MXN|^\d+$/);
    const geometry = await value.evaluate(el => {
      const css = getComputedStyle(el), range = document.createRange(); range.selectNodeContents(el);
      return { overflow: el.scrollWidth - el.clientWidth, mode: css.overflowX, font: parseFloat(css.fontSize), textWidth: Math.max(...[...range.getClientRects()].map(r => r.width)), width: el.getBoundingClientRect().width };
    });
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(geometry.mode).toBe('visible');
    expect(geometry.textWidth).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.font).toBeGreaterThanOrEqual(20);
    await expect(figure.locator('[tabindex]')).toHaveCount(0);
    expect(await figure.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  await fits(page);
}

for (const width of [1440, 768, 390]) for (const role of ['OWNER', 'RECEPTIONIST'] as const) {
  test(`Reportes y navegación ${role} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const api = await uiUnificationFixture(page, role);
    await page.route(url => url.pathname === '/api/financial/reports/portfolio', async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const url = new URL(route.request().url());
      api.calls.push({ method: 'GET', path: url.pathname, params: url.searchParams, body: null, role, declared: true, allowed: true });
      return route.fulfill({ json: { asOf: '2026-10-26T07:00:00Z', billedAmount: '12345678.90', appliedAmount: '345678.90', pendingBalance: '12000000.00', confirmedCharges: 12345, statusCounts: { pendiente: 12340, parcial: 2, pagado: 2, anulado: 1 } } });
    });
    const columns = width === 1440 ? 4 : width === 768 ? 2 : 1;
    await open(page, '/finances/reports');
    await figures(page, columns);
    await expect(page.getByText('$12,345,678.90 MXN', { exact: true })).toBeVisible();
    await expect(page.getByText('$12,000,000.00 MXN', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${out}/reports-${role}-${width}.png`, fullPage: true });
    if (width === 1440) {
      const layout = page.locator('.financial-report-layout');
      await layout.evaluate(el => { (el as HTMLElement).style.maxWidth = '440px'; });
      await figures(page, 2);
      await layout.evaluate(el => { (el as HTMLElement).style.maxWidth = '300px'; });
      await figures(page, 1);
      await layout.evaluate(el => { (el as HTMLElement).style.removeProperty('max-width'); });
    }
    await page.getByRole('tab', { name: 'Cobros por período' }).click();
    await expect(page.getByRole('tab', { name: 'Cobros por período' })).toHaveAttribute('aria-selected', 'true');
    await figures(page, width === 1440 ? 3 : columns);
    const period = page.getByRole('form', { name: 'Filtrar cobros por período' });
    await period.getByLabel('Desde (fecha de movimiento)').fill('2026-10-01');
    await period.getByLabel('Hasta (incluye ese día)').fill('2026-10-26');
    await period.getByRole('button', { name: 'Aplicar período', exact: true }).click();
    await expect(page.locator('.reception-finances-period')).toContainText(role === 'OWNER' ? 'fin exclusivo' : 'incluye el último día');
    await expect(page.getByRole('region', { name: 'Cobros por método' })).toBeVisible();
    await figures(page, width === 1440 ? 3 : columns);
    if (width !== 768) await page.screenshot({ path: `${out}/period-${role}-${width}.png`, fullPage: true });
    await page.getByRole('tab', { name: 'Cargos y saldos' }).click();
    await expect(page.getByRole('tab', { name: 'Cargos y saldos' })).toHaveAttribute('aria-selected', 'true');
    await figures(page, columns);
    await expect(page.getByRole('region', { name: 'Saldos por paciente' })).toBeVisible();
    expect(new URL(page.url()).searchParams.has('from')).toBe(true);
    expect(new URL(page.url()).searchParams.has('to')).toBe(true);

    const agenda = '/appointments?date=2026-10-26&view=week&status=SCHEDULED&dentistId=8';
    await open(page, agenda);
    const heading = page.locator('.reception-agenda-heading');
    const views = page.getByRole('group', { name: 'Vista', exact: true });
    if (role === 'OWNER') {
      const context = page.getByRole('navigation', { name: 'Ámbito de trabajo' });
      await expect(context).toHaveClass('agenda-choice');
      expect(Math.abs((await context.boundingBox())!.x - (await heading.boundingBox())!.x)).toBeLessThanOrEqual(1);
      const first = context.getByRole('link', { name: 'Clínica', exact: true });
      const view = views.getByRole('button', { name: 'Semana', exact: true });
      const recipe = async (selector: typeof first) => selector.evaluate(el => {
        const c = getComputedStyle(el); return { height: el.getBoundingClientRect().height, padding: c.padding, background: c.backgroundColor, color: c.color };
      });
      await expect(first).toHaveAttribute('aria-current', 'page');
      expect(await recipe(first)).toEqual(await recipe(view));
      expect(await context.evaluate(el => getComputedStyle(el).borderRadius)).toBe(await views.evaluate(el => getComputedStyle(el).borderRadius));
      const navBox = (await context.boundingBox())!, toolbar = (await page.locator('.reception-agenda-controls').boundingBox())!;
      expect(toolbar.y - navBox.y - navBox.height).toBe(12);
      await context.getByRole('link', { name: 'Mi actividad clínica', exact: true }).click();
      await expect(context.getByRole('link', { name: 'Mi actividad clínica', exact: true })).toHaveAttribute('aria-current', 'page');
      let params = new URL(page.url()).searchParams;
      expect(params.get('scope')).toBe('mine'); expect(params.get('view')).toBe('week'); expect(params.get('status')).toBe('SCHEDULED'); expect(params.has('dentistId')).toBe(false);
      await context.getByRole('link', { name: 'Clínica', exact: true }).click();
      params = new URL(page.url()).searchParams; expect(params.has('scope')).toBe(false); expect(params.get('date')).toBe('2026-10-26');
    } else {
      await expect(page.getByRole('navigation', { name: 'Ámbito de trabajo' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Mi actividad clínica', exact: true })).toHaveCount(0);
    }
    if (width >= 768 || role === 'OWNER') {
      await views.getByRole('button', { name: 'Mes', exact: true }).click();
      await expect(views.getByRole('button', { name: 'Mes', exact: true })).toHaveAttribute('aria-pressed', 'true');
      expect(new URL(page.url()).searchParams.get('view')).toBe('month');
      await views.getByRole('button', { name: 'Semana', exact: true }).click();
    }
    const navigation = page.getByRole('group', { name: 'Navegación', exact: true });
    await navigation.getByRole('button', { name: 'Siguiente' }).click();
    expect(new URL(page.url()).searchParams.get('date')).not.toBe('2026-10-26');
    await navigation.getByRole('button', { name: 'Anterior' }).click();
    expect(new URL(page.url()).searchParams.get('date')).toBe('2026-10-26');
    await expect(page.getByLabel('Fecha', { exact: true })).toHaveValue('2026-10-26');
    await page.waitForLoadState('networkidle');
    await fits(page);
    await page.screenshot({ path: `${out}/agenda-${role}-${width}.png`, fullPage: true });
    await writeFile(`${out}/calls-${role}-${width}.json`, api.manifest());
    expect(api.calls.filter(call => call.method !== 'GET' && call.path !== '/api/auth/refresh')).toEqual([]);
    expect(api.violations, api.manifest()).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
  });
}
