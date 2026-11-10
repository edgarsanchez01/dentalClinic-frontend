import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { NOW, uiUnificationFixture, type UiRole } from './uiUnificationFixture';

const stage = process.env.DC_UI_F2B_STAGE;
if (stage !== 'before' && stage !== 'after') throw new Error('Explicit F2b stage required; F2a evidence is preserved.');
const root = '/tmp/opencode/dc-ui-f2b';
const outputFolder = stage === 'after' && process.env.DC_UI_F2B_CONFIRM === '1' ? 'after-confirm' : stage!;
const people = Array.from({ length: 12 }, (_, i) => ({
  id: i + 40, firstName: i === 1 ? 'Ana María de los Ángeles' : 'Ana',
  lastName: i === 1 ? 'Paciente con apellidos extensos' : 'Prueba',
  phone: `555000${i}`, active: i !== 2, createdAt: NOW,
}));

async function fixture(page: Page, role: UiRole) {
  const common = await uiUnificationFixture(page, role);
  const calls: string[] = [];
  const mode = { fail: false };
  // Override only the administrative patient dataset; all other APIs retain the allowlist.
  await page.route(url => /^\/api\/patients(?:\/\d+)?$/.test(url.pathname), async route => {
    const req = route.request(), url = new URL(req.url());
    calls.push(`${req.method()} ${url.pathname}${url.search}`);
    expect(req.method()).toBe('GET');
    expect(role).not.toBe('PATIENT');
    if (url.pathname !== '/api/patients') {
      await route.fulfill({ json: people.find(p => p.id === Number(url.pathname.split('/').at(-1))) }); return;
    }
    expect(url.searchParams.get('size')).toBe('10');
    if (mode.fail) { await route.fulfill({ status: 503, json: { message: 'Synthetic unavailable' } }); return; }
    const index = Number(url.searchParams.get('page') ?? 0);
    const matches = url.searchParams.get('search') === 'ninguno' ? [] : people;
    await route.fulfill({ json: { content: matches.slice(index * 10, index * 10 + 10), page: index, size: 10,
      totalPages: Math.ceil(matches.length / 10), totalElements: matches.length } });
  });
  return { common, calls, mode };
}

async function capture(page: Page, key: string, unchanged: boolean) {
  // F2a §9: pointer and screenshot must not establish a keyboard precondition.
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  const field = page.getByLabel(/^Paciente(?: \(obligatorio\)| \(filtro opcional\))?$/).locator('xpath=ancestor::fieldset[1]');
  await field.scrollIntoViewIfNeeded();
  if (stage === 'after') {
    const input = field.getByRole('combobox', { name: /^Paciente/ });
    await expect(input).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(input).toHaveCSS('color', 'rgb(41, 59, 58)');
    const panel = field.locator('.ce-combobox-panel');
    if (await panel.count()) await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  }
  const metrics = await field.evaluate(el => {
    const props = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'background-color',
      'border', 'border-radius', 'padding', 'margin', 'gap', 'display', 'min-height', 'max-height', 'box-shadow', 'overflow-x', 'overflow-y'];
    const list = el.querySelector('[role=listbox]');
    const panel = list?.parentElement;
    const input = el.querySelector('[role=combobox]');
    return { viewport: [innerWidth, innerHeight], scrollWidth: document.documentElement.scrollWidth,
      popupScroll: panel ? [panel.scrollTop, panel.clientHeight, panel.scrollHeight] : null,
      active: input?.getAttribute('aria-activedescendant') ?? null,
      elements: [el, ...Array.from(el.querySelectorAll('*'))].map(node => {
        const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
        return { tag: node.tagName, role: node.getAttribute('role'),
          text: Array.from(node.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim(),
          rect: [rect.x, rect.y, rect.width, rect.height].map(n => Math.round(n * 1000) / 1000),
          styles: Object.fromEntries(props.map(p => [p, css.getPropertyValue(p)])) };
      }) };
  });
  const destination = path.join(root, outputFolder, key);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(`${destination}.json`, JSON.stringify(metrics), { flag: 'wx' });
  await writeFile(`${destination}.png`, await page.screenshot({ fullPage: false }), { flag: 'wx' });
  const post = await field.evaluate(el => {
    const panel = el.querySelector('[role=listbox]')?.parentElement;
    return { popupScroll: panel ? [panel.scrollTop, panel.clientHeight, panel.scrollHeight] : null,
      active: el.querySelector('[role=combobox]')?.getAttribute('aria-activedescendant') ?? null };
  });
  expect(post).toEqual({ popupScroll: metrics.popupScroll, active: metrics.active });
  if (stage === 'after' && unchanged) expect(metrics, key).toEqual(JSON.parse(await readFile(path.join(root, 'before', `${key}.json`), 'utf8')));
}

const surfaces: Array<{ role: UiRole; route: string; label: string; migrated: boolean; staff?: boolean }> = [
  { role: 'RECEPTIONIST', route: '/finances/new', label: 'r23-cargo', migrated: false },
  { role: 'RECEPTIONIST', route: '/finances', label: 'r23-finanzas', migrated: false },
  { role: 'OWNER', route: '/collections', label: 'r23-collections', migrated: false },
  { role: 'OWNER', route: '/finances/new', label: 'owner-cargo', migrated: true },
  { role: 'OWNER', route: '/finances', label: 'owner-finanzas', migrated: true },
  { role: 'OWNER', route: '/finances/reports?tab=cargos', label: 'owner-reportes', migrated: true },
  { role: 'RECEPTIONIST', route: '/appointments?create=1&date=2026-10-26', label: 'staff-r', migrated: true, staff: true },
  { role: 'DENTIST', route: '/appointments?create=1&date=2026-10-26', label: 'staff-d', migrated: true, staff: true },
  { role: 'OWNER', route: '/appointments?create=1&date=2026-10-26', label: 'staff-o', migrated: true, staff: true },
  { role: 'OWNER', route: '/appointments?scope=mine&create=1&date=2026-10-26', label: 'staff-personal', migrated: true, staff: true },
];

for (const surface of surfaces) {
  const sizes = [[1440, 1000], [390, 844], ...(surface.label === 'r23-cargo' ? [[1366, 768]] : []),
    ...(['owner-cargo', 'staff-d'].includes(surface.label) ? [[320, 740]] : [])];
  for (const [width, height] of sizes) test(`${surface.label} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width: width!, height: height! });
    const f = await fixture(page, surface.role);
    await page.goto(surface.route);
    const shell = surface.role === 'RECEPTIONIST' ? 'reception' : surface.role.toLowerCase();
    await expect(page.locator(`.${shell}-shell main h1`)).toHaveCount(1);
    const field = page.getByLabel(/^Paciente(?: \(obligatorio\)| \(filtro opcional\))?$/);
    const options = page.getByRole('listbox', { name: 'Resultados de pacientes' }).getByRole('option');
    await expect(field).toBeVisible();
    const key = `${surface.label}-${width}`;
    await capture(page, `${key}-closed`, !surface.migrated);
    if (stage === 'before' && surface.migrated) return;
    const input = page.getByRole('combobox', { name: /^Paciente/ });
    expect(f.calls).toEqual([]);
    await input.click();
    await page.mouse.move(0, 0);
    await expect(options).toHaveCount(10);
    await expect(input).not.toHaveAttribute('aria-activedescendant');
    await capture(page, `${key}-open`, !surface.migrated);
    await expect(input).not.toHaveAttribute('aria-activedescendant');
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(input).toHaveValue('Ana Prueba');
    if (!surface.staff) await expect(page.getByLabel('Paciente seleccionado', { exact: true })).toContainText('Paciente #40');
    await expect(page.getByText('Verificando paciente seleccionado…', { exact: true })).toHaveCount(0);
    await capture(page, `${key}-selected`, !surface.migrated);
    if (stage === 'after' && surface.migrated) {
      const reads = f.common.calls.filter(c => /charges|collection-queue|reports\//.test(c.path)).length;
      await input.click(); await page.mouse.move(0, 0);
      await expect(options).toHaveCount(10);
      await page.getByRole('button', { name: 'Cargar más pacientes' }).click();
      await page.mouse.move(0, 0);
      await expect(options).toHaveCount(12);
      await expect(input).toHaveValue('Ana Prueba');
      await capture(page, `${key}-more`, false);
      await input.fill('ninguno'); // D1: editing removes the selected entity immediately.
      await expect(page.getByRole('button', { name: 'Quitar selección' })).toHaveCount(0);
      expect(f.common.calls.filter(c => /charges|collection-queue|reports\//.test(c.path))).toHaveLength(reads);
      if (surface.staff) expect(f.calls.some(c => /\/api\/patients\/\d+/.test(c))).toBe(false);
      await expect(page.getByText(/No hay pacientes que coincidan/)).toBeVisible();
      await capture(page, `${key}-empty`, false);
      f.mode.fail = true;
      await input.fill('fallo');
      await expect(page.getByText('No se pudo consultar la búsqueda de pacientes.')).toBeVisible();
      await capture(page, `${key}-error`, false);
      f.mode.fail = false;
      await page.getByRole('button', { name: 'Reintentar búsqueda' }).click();
      await expect(options).toHaveCount(10);
      await input.focus();
      await input.press('Escape');
      await expect(input).toHaveAttribute('aria-expanded', 'false');
      await input.press('Tab');
      await expect(input).not.toBeFocused();
    }
    expect(f.common.violations, f.common.manifest()).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
    await writeFile(path.join(root, outputFolder, `${key}-calls.json`), JSON.stringify(f.calls), { flag: 'wx' });
    if (stage === 'after' && !surface.migrated) expect(f.calls).toEqual(JSON.parse(await readFile(path.join(root, 'before', `${key}-calls.json`), 'utf8')));
  });
}

if (stage === 'after') {
  for (const route of ['/finances/new', '/appointments?create=1&date=2026-10-26']) {
    test(`responsive selector ${route}`, async ({ page }) => {
      const f = await fixture(page, 'OWNER');
      await page.goto(route);
      const input = page.getByRole('combobox', { name: /^Paciente/ });
      const options = page.getByRole('listbox', { name: 'Resultados de pacientes' }).getByRole('option');
      for (const width of [1366, 768, 767, 320]) {
        await page.setViewportSize({ width, height: 1024 });
        await expect(input).toHaveCount(1);
        await input.click(); await page.mouse.move(0, 0);
        await expect(options).toHaveCount(10);
        const geometry = await input.evaluate(el => {
          const field = el.closest('fieldset')!;
          const panel = field.querySelector('.ce-combobox-panel')!;
          const a = el.getBoundingClientRect(), b = panel.getBoundingClientRect();
          return { width: innerWidth, input: [a.left, a.right], panel: [b.left, b.right], height: b.height, scroll: panel.scrollHeight, visible: panel.clientHeight };
        });
        expect(geometry.input[0]).toBeGreaterThanOrEqual(0);
        expect(geometry.input[1]).toBeLessThanOrEqual(width);
        expect(geometry.panel[0]).toBeGreaterThanOrEqual(0);
        expect(geometry.panel[1]).toBeLessThanOrEqual(width);
        expect(geometry.height).toBeGreaterThan(0);
        expect(geometry.scroll).toBeGreaterThan(geometry.visible);
        await input.press('Escape');
        const folder = path.join(root, process.env.DC_UI_F2B_CONFIRM === '1' ? 'responsive-confirm' : 'responsive'); await mkdir(folder, { recursive: true });
        await writeFile(path.join(folder, `${route.startsWith('/finances') ? 'financial' : 'staff'}-${width}.json`), JSON.stringify(geometry), { flag: 'wx' });
      }
      // CSS zoom is a layout stress simulation, not browser zoom or a real virtual keyboard.
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
      await input.click(); await page.mouse.move(0, 0);
      await expect(page.getByRole('option', { name: /Paciente #41/ })).toBeVisible();
      await page.getByRole('button', { name: 'Cargar más pacientes' }).click();
      await page.mouse.move(0, 0);
      await expect(options).toHaveCount(12);
      await input.press('ArrowDown'); await input.press('Enter');
      await expect(input).toHaveValue('Ana Prueba');
      expect(f.common.violations).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
    });
  }

  for (const route of ['/finances/new', '/appointments?create=1&date=2026-10-26']) {
    test(`session A→B ${route}`, async ({ page }) => {
      const f = await fixture(page, 'OWNER');
      let session = 'A';
      const user = () => ({ id: session === 'A' ? 1 : 99, email: `${session}@example.test`, role: 'OWNER', active: true, createdAt: NOW, dentistId: 7 });
      await page.route('**/api/auth/me', r => r.fulfill({ json: user() }));
      await page.route('**/api/auth/logout', r => r.fulfill({ status: 204 }));
      await page.route('**/api/auth/login', r => r.fulfill({ json: { accessToken: 'session-B', user: user() } }));
      await page.route(url => url.pathname === '/api/patients', r => r.fulfill({ json: {
        content: [{ ...people[0], firstName: `Privado-${session}` }], page: 0, size: 10, totalPages: 1, totalElements: 1,
      } }));
      await page.goto(route);
      const input = page.getByRole('combobox', { name: /^Paciente/ });
      await input.click();
      await page.getByRole('option', { name: /Privado-A/ }).click();
      await input.fill('pendiente-A');
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      let seen!: () => void;
      const requested = new Promise<void>(resolve => { seen = resolve; });
      await page.route(url => url.pathname === '/api/patients' && url.searchParams.get('search') === 'tardio-A', async r => {
        seen(); await held;
        await r.fulfill({ json: { content: [{ ...people[0], firstName: 'Tardio-A' }], page: 0, size: 10, totalPages: 1, totalElements: 1 } });
      });
      await input.fill('tardio-A'); await requested;
      await page.getByRole('button', { name: /Cerrar sesión/ }).click();
      await page.getByRole('banner').getByRole('link', { name: 'Iniciar sesión', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
      session = 'B';
      await page.getByLabel('Correo electrónico').fill('B@example.test');
      await page.getByLabel('Contraseña', { exact: true }).fill('password');
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await expect(page.locator('.owner-shell')).toBeVisible();
      // SPA navigation keeps the actual session boundary under test (no page reload).
      await page.evaluate(destination => { history.pushState({}, '', destination); dispatchEvent(new PopStateEvent('popstate')); }, route);
      await expect(input).toHaveValue('');
      release();
      await input.click();
      await expect(page.getByRole('option', { name: /Privado-B/ })).toBeVisible();
      await expect(page.getByText(/Privado-A|Tardio-A/)).toHaveCount(0);
      expect(f.common.violations).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
    });
  }

  test('staff summary preserves received name without detail', async ({ page }) => {
    const f = await fixture(page, 'RECEPTIONIST');
    await page.goto('/appointments?create=1&date=2026-10-26');
    const input = page.getByRole('combobox', { name: 'Paciente', exact: true });
    await input.click(); await page.getByRole('option', { name: /Paciente #41/ }).click();
    await page.getByRole('combobox', { name: 'Servicio', exact: true }).selectOption('1');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByRole('combobox', { name: 'Dentista', exact: true }).selectOption('7');
    await page.getByRole('group', { name: 'Huecos disponibles' }).getByRole('button', { name: '10:00–11:00', exact: true }).click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByText('Ana María de los Ángeles Paciente con apellidos extensos', { exact: true }).first()).toBeVisible();
    expect(f.calls.some(call => /\/api\/patients\/\d+/.test(call))).toBe(false);
    expect(f.common.violations).toEqual({ undeclared: [], forbidden: [], blockedWrites: [] });
  });
}
