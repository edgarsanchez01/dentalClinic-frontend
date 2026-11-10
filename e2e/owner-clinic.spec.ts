import { expect, test, type Page } from '@playwright/test';
import type { Role } from '../src/api/auth';
import type { ClinicDto, UpdateClinicInput } from '../src/api/clinic';

const original: ClinicDto = {
  id: 1, name: 'Clínica de prueba', timezone: 'Europe/Madrid', description: null, address: 'Dirección operativa',
  phone: null, email: null, logoUrl: null, brandColor: null, publicInfo: null,
  socialNetworks: { instagram: 'https://instagram.com/prueba', facebook: 'https://facebook.com/prueba', website: 'https://example.test', extra: 'valor adicional', blank: '' },
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

async function fixture(page: Page, { role = 'OWNER', delayedPut, failRead = false }: { role?: Role; delayedPut?: Promise<void>; failRead?: boolean } = {}) {
  let clinic = structuredClone(original);
  let rejectNext = false;
  const calls: { method: string; path: string; body: unknown }[] = [];
  const unexpected: string[] = [];
  await page.route(url => url.pathname.startsWith('/api/') || url.pathname.startsWith('/actuator/'), async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body: unknown = request.postData() ? request.postDataJSON() : undefined;
    calls.push({ path, method, body });
    if (path === '/api/auth/refresh') return route.fulfill({ json: { accessToken: 'clinic-intercepted-test' } });
    if (path === '/api/auth/me') return route.fulfill({ json: { id: 1, role, email: 'owner@example.test', active: true, createdAt: original.createdAt } });
    if (path === '/api/onboarding/status') return route.fulfill({ json: { status: 'COMPLETED', clinicConfigured: true } });
    if (path === '/api/notifications/unread-count') return route.fulfill({ json: { unread: 0 } });
    if (path === '/api/clinic' && method === 'GET') {
      if (failRead) { failRead = false; return route.fulfill({ status: 503, json: { message: 'Lectura de prueba fallida.' } }); }
      return route.fulfill({ json: clinic });
    }
    if (path === '/api/clinic' && method === 'PUT') {
      if (delayedPut) await delayedPut;
      const input = body as UpdateClinicInput;
      if (rejectNext) {
        rejectNext = false;
        return route.fulfill({ status: 400, json: { status: 400, error: 'Bad Request', message: 'No se pudo guardar la configuración.',
          path, timestamp: original.updatedAt, fieldErrors: { timezone: 'Zona rechazada por el servidor.' } } });
      }
      if (input.brandColor != null && !/^#[0-9A-Fa-f]{6}$/.test(input.brandColor)) {
        return route.fulfill({ status: 400, json: { message: 'Color inválido: esta prueba exige preservar null.' } });
      }
      // Emulate replacement, not a PATCH that could hide omitted fields in the test.
      clinic = { ...original, name: input.name, timezone: input.timezone, description: input.description ?? null,
        address: input.address ?? null, phone: input.phone ?? null, email: input.email ?? null,
        logoUrl: input.logoUrl ?? null, brandColor: input.brandColor ?? null, publicInfo: input.publicInfo ?? null,
        socialNetworks: input.socialNetworks ?? null, updatedAt: '2026-10-26T12:00:00Z' };
      return route.fulfill({ json: clinic });
    }
    unexpected.push(`${method} ${path}`);
    return route.fulfill({ status: 404, json: { message: 'API no prevista en esta prueba interceptada.' } });
  });
  return { calls, unexpected, rejectNext: () => { rejectNext = true; }, puts: () => calls.filter(call => call.method === 'PUT') };
}

async function navigate(page: Page, name: string, mobile: boolean) {
  if (mobile) {
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await page.getByRole('dialog', { name: 'Menú de navegación' }).getByRole('link', { name, exact: true }).click();
  } else {
    const link = page.getByRole('navigation', { name: 'Navegación de escritorio' }).getByRole('link', { name, exact: true });
    await link.focus();
    await link.press('Enter');
  }
}

for (const width of [1440, 390]) {
  test(`DC-OWNER-03: lectura recuperable, campos simplificados y PUT seguro a ${width}px (API interceptada)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const response = gate();
    const api = await fixture(page, { failRead: true, delayedPut: response.promise });
    await page.goto('/clinic');
    await expect(page.getByRole('alert')).toHaveText('No se pudo cargar la configuración de la clínica.');
    await page.getByRole('button', { name: 'Reintentar lectura' }).focus();
    await page.keyboard.press('Enter');
    const form = page.getByRole('form', { name: 'Configuración de la clínica' });
    await expect(form.getByLabel('Nombre', { exact: true })).toHaveValue(original.name);
    for (const label of ['URL del logo', 'Color de marca (#RRGGBB)', 'Información pública']) await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
    await expect(form.getByRole('textbox')).toHaveCount(9);
    await form.getByLabel('Nombre', { exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(form.getByLabel('Zona horaria (IANA)')).toBeFocused();
    await form.getByLabel('Nombre', { exact: true }).fill('Nombre operativo nuevo');
    await form.getByLabel('Instagram').fill('https://instagram.com/nueva');
    await page.screenshot({ path: `/tmp/opencode/dc-owner-03/clinica-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await form.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect.poll(() => api.puts().length).toBe(1);
    expect(api.puts()[0]).toEqual({ path: '/api/clinic', method: 'PUT', body: {
      name: 'Nombre operativo nuevo', timezone: original.timezone, description: null, address: original.address,
      phone: null, email: null, logoUrl: null, brandColor: null, publicInfo: null,
      socialNetworks: { ...original.socialNetworks, instagram: 'https://instagram.com/nueva' },
    } });
    await expect(form.getByLabel('Nombre', { exact: true })).toBeDisabled();
    await expect(form.getByLabel('Sitio web')).toBeDisabled();
    await expect(form.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    response.release();
    await expect(form.getByText('Configuración guardada.')).toBeVisible();
    await expect(form.getByRole('button', { name: 'Guardar cambios' })).toBeFocused();
    await navigate(page, 'Contraseña', width < 768);
    await expect(page.getByRole('heading', { name: 'Cambiar contraseña', exact: true })).toBeVisible();
    await expect(page.locator('dialog[data-unsaved-dialog][open]')).toHaveCount(0);
    expect(api.puts()).toHaveLength(1);
    expect(api.unexpected).toEqual([]);
  });

  test(`DC-OWNER-03: error, teclado, descarte, Back y recarga protegidos a ${width}px (API interceptada)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const api = await fixture(page);
    await page.goto('/change-password');
    await expect(page.getByRole('heading', { name: 'Cambiar contraseña', exact: true })).toBeVisible();
    await navigate(page, 'Clínica', width < 768);
    const form = page.getByRole('form', { name: 'Configuración de la clínica' });
    await expect(form.getByLabel('Nombre', { exact: true })).toHaveValue(original.name);
    await form.getByLabel('Zona horaria (IANA)').fill('Zona incorrecta');
    api.rejectNext();
    await form.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(form.getByText('Zona rechazada por el servidor.')).toBeVisible();
    await expect(form.getByLabel('Zona horaria (IANA)')).toBeFocused();
    await expect(form.getByLabel('Zona horaria (IANA)')).toHaveAttribute('aria-invalid', 'true');
    await page.goBack();
    const confirmation = page.getByRole('dialog', { name: 'Tienes cambios sin guardar' });
    await expect(confirmation.getByRole('button', { name: 'Seguir aquí' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(form.getByLabel('Zona horaria (IANA)')).toHaveValue('Zona incorrecta');
    await expect(form.getByText('Zona rechazada por el servidor.')).toBeVisible();
    const unloading = page.waitForEvent('dialog');
    // Trigger the native reload without waiting for a load event that a cancelled
    // beforeunload intentionally prevents.
    const reload = page.evaluate(() => window.location.reload());
    const dialog = await unloading;
    expect(dialog.type()).toBe('beforeunload');
    await dialog.dismiss();
    await reload;
    await expect(form.getByLabel('Zona horaria (IANA)')).toHaveValue('Zona incorrecta');
    await form.getByLabel('Zona horaria (IANA)').fill('Europe/Paris');
    await form.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(form.getByText('Configuración guardada.')).toBeVisible();
    await form.getByLabel('Nombre', { exact: true }).fill('Borrador no enviado');
    await navigate(page, 'Contraseña', width < 768);
    await page.getByRole('dialog', { name: 'Tienes cambios sin guardar' }).getByRole('button', { name: 'Seguir aquí' }).click();
    await expect(form.getByLabel('Nombre', { exact: true })).toHaveValue('Borrador no enviado');
    await navigate(page, 'Contraseña', width < 768);
    await page.getByRole('dialog', { name: 'Tienes cambios sin guardar' }).getByRole('button', { name: 'Salir sin guardar' }).click();
    await expect(page.getByRole('heading', { name: 'Cambiar contraseña', exact: true })).toBeVisible();
    expect(api.puts()).toHaveLength(2);
    expect(api.unexpected).toEqual([]);
  });

  test(`DC-OWNER-03: respuesta antigua no reemplaza un editor nuevo a ${width}px (API interceptada)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const response = gate();
    const api = await fixture(page, { delayedPut: response.promise });
    await page.goto('/clinic');
    const form = page.getByRole('form', { name: 'Configuración de la clínica' });
    await form.getByLabel('Nombre', { exact: true }).fill('Nombre enviado');
    await form.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect.poll(() => api.puts().length).toBe(1);
    await navigate(page, 'Contraseña', width < 768);
    await page.getByRole('dialog', { name: 'Guardado en curso' }).getByRole('button', { name: 'Salir de esta vista' }).click();
    await expect(page.getByRole('heading', { name: 'Cambiar contraseña', exact: true })).toBeVisible();
    await expect(page.locator('dialog[data-unsaved-dialog][open]')).toHaveCount(0);
    await page.goBack();
    await expect(form.getByLabel('Nombre', { exact: true })).toBeEnabled();
    await form.getByLabel('Nombre', { exact: true }).fill('Borrador nuevo');
    response.release();
    await expect.poll(() => api.calls.filter(call => call.path === '/api/clinic' && call.method === 'GET').length).toBeGreaterThanOrEqual(3);
    await expect(form.getByLabel('Nombre', { exact: true })).toHaveValue('Borrador nuevo');
    await expect(form.getByText('Configuración guardada.')).toHaveCount(0);
    await expect(form.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
    expect(api.puts()).toHaveLength(1);
    expect(api.unexpected).toEqual([]);
  });
}

for (const role of ['DENTIST', 'RECEPTIONIST', 'PATIENT'] as const) {
  test(`DC-OWNER-03: ${role} no accede a Clínica ni solicita su API`, async ({ page }) => {
    const api = await fixture(page, { role });
    await page.goto('/clinic');
    await expect(page.getByRole('heading', { name: 'Sin acceso' })).toBeVisible();
    expect(api.calls.filter(call => call.path === '/api/clinic')).toEqual([]);
    expect(api.unexpected).toEqual([]);
  });
}
