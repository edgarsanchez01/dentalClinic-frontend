import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const NOW = '2026-10-25T12:00:00Z';
const services = [
  { id: 1, name: 'Consulta de valoración', description: 'Revisión inicial y orientación sobre las opciones de atención.', referencePrice: '450.1234', durationMinutes: 45, active: true, createdAt: NOW, updatedAt: null },
  { id: 2, name: 'Revisión de seguimiento', description: null, referencePrice: '0.0000', durationMinutes: 20, active: false, createdAt: NOW, updatedAt: null },
  { id: 3, name: 'Consulta de orientación para tratamientos de larga duración', description: 'Información de referencia del servicio.\nEl catálogo no constituye un cargo ni un tratamiento registrado.', referencePrice: '999999999999999.1234', durationMinutes: 90, active: true, createdAt: NOW, updatedAt: null },
];

async function fixture(page: Page, role: string) {
  const state = { error: false, empty: false, pending: false };
  const requests: Array<{ path: string; method: string }> = [];
  let release = () => {};
  await page.clock.setFixedTime(new Date(NOW));
  // Every API request is intercepted: no real backend or persistent database is used.
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    requests.push({ path: url.pathname + url.search, method: route.request().method() });
    let body: unknown;
    if (url.pathname === '/api/auth/refresh') body = { accessToken: 'synthetic-services-token' };
    else if (url.pathname === '/api/auth/me') body = { id: 1, email: 'synthetic@example.test', role, active: true, dentistId: 7, createdAt: NOW };
    else if (url.pathname === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (url.pathname === '/api/notifications/unread-count') body = { unread: 0 };
    else if (url.pathname === '/api/services') {
      if (state.pending) await new Promise<void>((resolve) => { release = resolve; });
      if (state.error) {
        await route.fulfill({ status: 503, json: { message: 'Consulta temporalmente no disponible.' } });
        return;
      }
      body = state.empty ? [] : services.filter((item) => !url.searchParams.has('active') || String(item.active) === url.searchParams.get('active'));
    } else {
      await route.fulfill({ status: 404, json: {} });
      return;
    }
    await route.fulfill({ json: body });
  });
  return { state, requests, release: () => release() };
}

async function loaded(page: Page) {
  await expect(page.getByRole('article', { name: 'Servicio Consulta de valoración', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}

test('BUILD01 capturas de regresión RECEPTIONIST/OWNER antes y después', async ({ page }) => {
  const stage = process.env.DC_SERVICES_CAPTURE_STAGE;
  test.skip(!stage, 'Captura de regresión opt-in, sin actualizar imágenes de referencia automáticamente.');
  const root = '/tmp/opencode/dc-dent-reuse-01-services';
  await mkdir(`${root}/${stage}`, { recursive: true });
  for (const role of ['RECEPTIONIST', 'OWNER']) {
    await page.unrouteAll({ behavior: 'wait' });
    await fixture(page, role);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/services');
      await loaded(page);
      const name = `${role}-${width}.png`;
      const image = await page.screenshot({ path: `${root}/${stage}/${name}`, fullPage: true, animations: 'disabled' });
      // Playwright's visual comparator ignores rasterization noise in native controls;
      // no differing pixels above its standard perceptual threshold are permitted.
      if (stage === 'after') expect(image).toMatchSnapshot(name, { threshold: 0.2, maxDiffPixels: 0 });
    }
  }
});

for (const width of [1440, 768, 390, 320]) {
  test(`BUILD01 misma composición y píxeles de Servicios para DENTIST/RECEPTIONIST a ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    const reception = await context.newPage();
    await reception.setViewportSize({ width, height: 1000 });
    const dentistApi = await fixture(page, 'DENTIST');
    const receptionApi = await fixture(reception, 'RECEPTIONIST');
    await Promise.all([page.goto('/services'), reception.goto('/services')]);
    await Promise.all([loaded(page), loaded(reception)]);
    const module = page.locator('.reception-services');
    await expect(page.locator('.dentist-shell')).toHaveCount(1);
    await expect(page.locator('.reception-shell')).toHaveCount(0);
    await expect(module).toHaveCount(1);
    expect(await module.innerHTML()).toBe(await reception.locator('.reception-services').innerHTML());
    const reference = await reception.locator('.reception-services').screenshot({ path: test.info().outputPath(`reception-${width}.png`), animations: 'disabled' });
    const actual = await module.screenshot({ path: test.info().outputPath(`dentist-${width}.png`), animations: 'disabled' });
    expect(actual.equals(reference), 'El módulo compartido debe renderizar los mismos píxeles').toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(module.getByText('3 servicios en el catálogo')).toBeVisible();
    await expect(module.getByRole('button', { name: /Nuevo servicio|Editar|Desactivar|Reactivar/ })).toHaveCount(0);
    const filter = page.getByLabel('Estado', { exact: true });
    await filter.focus();
    await expect(filter).toBeFocused();
    await expect(filter).toHaveCSS('outline-style', 'solid');
    await filter.selectOption('active');
    await expect(module.getByText('2 servicios con este estado')).toBeVisible();
    await expect(module.getByRole('article')).toHaveCount(2);
    await filter.selectOption('inactive');
    await expect(module.getByText('1 servicio con este estado')).toBeVisible();
    await expect(module.getByRole('article')).toHaveCount(1);
    expect(dentistApi.requests.filter(({ path }) => path.startsWith('/api/services')).every(({ method }) => method === 'GET')).toBe(true);
    expect(receptionApi.requests.filter(({ path }) => path.startsWith('/api/services')).every(({ method }) => method === 'GET')).toBe(true);
    await reception.close();
  });
}

for (const role of ['DENTIST', 'RECEPTIONIST']) {
  test(`BUILD01 ${role}: carga, error, reintento, vacío y limpieza sin escrituras`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const api = await fixture(page, role);
    api.state.pending = true;
    await page.goto('/services');
    await expect(page.getByRole('status', { name: 'Cargando servicios' })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Cargando servicios' })).toHaveCSS('min-height', '100px');
    api.state.pending = false;
    api.state.error = true;
    api.release();
    await expect(page.getByRole('alert')).toContainText('Consulta temporalmente no disponible.');
    api.state.error = false;
    api.state.empty = true;
    await page.getByRole('button', { name: 'Reintentar servicios' }).click();
    await expect(page.getByText('El catálogo está vacío')).toBeVisible();
    await page.getByLabel('Estado', { exact: true }).selectOption('inactive');
    await expect(page.getByText('No hay servicios con este estado')).toBeVisible();
    await page.getByRole('button', { name: 'Ver todos los servicios' }).click();
    await expect(page.getByLabel('Estado', { exact: true })).toHaveValue('all');
    await expect(page.getByText('El catálogo está vacío')).toBeVisible();
    await expect(page.getByRole('button', { name: /Nuevo servicio|Editar|Desactivar|Reactivar/ })).toHaveCount(0);
    expect(api.requests.filter(({ path }) => path.startsWith('/api/services')).every(({ method }) => method === 'GET')).toBe(true);
  });
}
