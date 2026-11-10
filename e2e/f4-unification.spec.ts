import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { uiUnificationFixture, type UiRole } from './uiUnificationFixture';

const stage = process.env.DC_UI_F4_STAGE;
if (stage !== 'before' && stage !== 'after') throw new Error('Explicit F4 stage required');
const root = '/tmp/opencode/dc-ui-f4';
const cases: Array<[UiRole, string, number]> = [
  ['RECEPTIONIST', '/finances', 1440], ['OWNER', '/finances', 390], ['DENTIST', '/finances', 320],
  ['OWNER', '/finances', 768], ['RECEPTIONIST', '/finances', 768],
  ['OWNER', '/finances/reports', 1440], ['RECEPTIONIST', '/finances/reports?tab=cobros', 390],
  ['OWNER', '/finances/1', 1440], ['RECEPTIONIST', '/finances/1', 390], ['DENTIST', '/finances/1', 320],
  ['OWNER', '/finances/new?patientId=4', 390], ['RECEPTIONIST', '/finances/new?patientId=4', 1440],
  ['OWNER', '/collections', 1440], ['RECEPTIONIST', '/collections', 390], ['OWNER', '/collections/20', 390],
];
for (const [role, route, width] of cases) test(`${role} ${route} ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
  const f = await uiUnificationFixture(page, role);
  await page.goto(route);
  await expect(page.locator('main h1')).toHaveCount(1);
  if (route === '/finances') await expect(page.getByRole('link', { name: 'Cargo #1', exact: true })).toBeVisible();
  if (route === '/finances/1') await expect(page.getByRole('heading', { name: 'Estado vigente: Parcial' })).toBeVisible();
  if (route.includes('new?')) await expect(page.getByLabel('Paciente seleccionado', { exact: true })).toContainText('Paciente #4');
  if (route === '/collections') await expect(page.getByRole('list', { name: 'Atenciones completadas' })).toBeVisible();
  if (route === '/collections/20') await expect(page.getByText('Cargo activo #1', { exact: true })).toBeVisible();
  if (route.includes('reports')) await expect(page.getByRole('region', { name: /Conteo de cargos|Cobros por método/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready); await page.waitForLoadState('networkidle'); await page.mouse.move(0, 0);
  const metrics = await page.locator('main').evaluate(el => ({ viewport: [innerWidth, innerHeight], width: document.documentElement.scrollWidth,
    elements: Array.from(el.querySelectorAll('h1,h2,dt,dd,table,article,fieldset')).map(node => {
      const r = node.getBoundingClientRect(), css = getComputedStyle(node);
      return { tag: node.tagName, text: node.textContent, rect: [r.x, r.y, r.width, r.height], font: css.font, color: css.color };
    }) }));
  const folder = path.join(root, stage!); await mkdir(folder, { recursive: true });
  const key = `${role}-${route.replace(/[^a-z0-9]/gi, '_')}-${width}`;
  await writeFile(path.join(folder, `${key}.json`), JSON.stringify(metrics), { flag: 'wx' });
  await writeFile(path.join(folder, `${key}.png`), await page.screenshot({ fullPage: false }), { flag: 'wx' });
  if (stage === 'after') {
    // The two 768px Finance debts are measured, not silently fixed or waived globally.
    if (!(route === '/finances' && width === 768)) expect(metrics.width).toBeLessThanOrEqual(width);
    if (role === 'DENTIST') {
      await expect(page.getByRole('button', { name: /Registrar pago|Reversar|Anular/ })).toHaveCount(0);
      await expect(page.getByRole('link', { name: /Crear cargo|Reportes financieros|Atenciones por cobrar/ })).toHaveCount(0);
    }
    if (route === '/finances') {
      const count = f.calls.filter(c => c.path === '/api/charges').length;
      await page.getByText('Filtros avanzados', { exact: false }).click();
      await page.getByLabel('Estado del cargo', { exact: true }).selectOption('PARCIAL');
      expect(f.calls.filter(c => c.path === '/api/charges')).toHaveLength(count);
      await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).first().click();
      await expect.poll(() => f.calls.some(c => c.path === '/api/charges' && c.params.get('status') === 'PARCIAL')).toBe(true);
    }
    if (route === '/finances/1' && role === 'OWNER') {
      await page.getByRole('button', { name: 'Reversar pago #21', exact: true }).click();
      await expect(page.getByRole('form', { name: 'Confirmar corrección financiera' })).toBeVisible();
      await page.getByRole('button', { name: 'Volver sin operar', exact: true }).click();
    }
    if (route.includes('new?') && role === 'RECEPTIONIST') {
      await page.getByRole('button', { name: 'Continuar a conceptos' }).click();
      await page.getByLabel('Descripción del concepto 1', { exact: true }).fill('Captura sin envío');
      await page.getByLabel('Precio unitario del concepto 1 (MXN)', { exact: true }).fill('10.25');
      await page.getByRole('button', { name: 'Revisar cargo' }).click();
      await expect(page.getByRole('region', { name: 'Revisión antes de confirmar' })).toContainText('Captura sin envío');
    }
    if (route === '/collections') {
      const checkbox = page.getByRole('checkbox', { name: 'Incluir liquidados' });
      const size = await checkbox.boundingBox(); expect(size!.width).toBe(20); expect(size!.height).toBe(20);
      const count = f.calls.filter(c => c.path.includes('collection-queue')).length;
      await checkbox.check(); expect(f.calls.filter(c => c.path.includes('collection-queue'))).toHaveLength(count);
    }
    if (route === '/collections/20') {
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Revisar cobro', exact: true }).click();
      await expect(page.getByText('Revisión sin efectos: todavía no se ha creado el cargo ni registrado el pago.')).toBeVisible();
    }
  }
  expect(f.violations, f.manifest()).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
});

if (stage === 'after') {
  for (const [role, route] of [['PATIENT', '/finances'], ['DENTIST', '/finances/new'], ['DENTIST', '/finances/reports'], ['DENTIST', '/collections']] as Array<[UiRole, string]>) {
    test(`permission ${role} ${route}`, async ({ page }) => {
      const f = await uiUnificationFixture(page, role); await page.goto(route);
      await expect(page.getByRole('heading', { name: 'Sin acceso' })).toBeVisible();
      expect(f.calls.filter(c => /charges|collection|financial\//.test(c.path))).toHaveLength(0);
      expect(f.violations).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
    });
  }
  test('error financiero no inventa saldo ni registra operación', async ({ page }) => {
    const f = await uiUnificationFixture(page, 'OWNER');
    await page.route('**/api/charges/1', route => route.fulfill({ status: 503, json: {} }));
    await page.goto('/finances/1'); await expect(page.getByRole('button', { name: 'Reintentar detalle' })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Registrar pago manual' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Reintentar detalle' }).click();
    expect(f.violations).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
  });
}
