import { expect, test, type Page } from '@playwright/test';

async function backend(page: Page, role: string) {
  const items = [{ id: 1, name: 'Limpieza dental', description: 'Profilaxis y cuidado preventivo.', referencePrice: '75.1234', durationMinutes: 35,
    active: true, createdAt: '2026-10-10T00:00:00Z', updatedAt: null }];
  const writes: Array<{ path: string; method: string; body: string }> = [];
  const reads: string[] = [];
  const json = (value: unknown) => JSON.stringify(value).replace(/"referencePrice":"([\d.]+)"/g, '"referencePrice":$1');
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    let body: unknown;
    if (path === '/api/auth/refresh') body = { accessToken: 'catalog-test-token' };
    else if (path === '/api/auth/me') body = { id: 1, email: 'staff@clinic.com', role, active: true, patientId: role === 'PATIENT' ? 1 : null, createdAt: '2026-01-01T00:00:00Z' };
    else if (path === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (path.startsWith('/api/services')) {
      if (method === 'GET') {
        reads.push(path);
        body = path === '/api/services' ? items.filter((item) => !url.searchParams.has('active') || String(item.active) === url.searchParams.get('active'))
          : items.find((item) => item.id === Number(path.split('/')[3]));
      } else {
        writes.push({ path, method, body: route.request().postData()! });
        const changes = route.request().postDataJSON() as Partial<typeof items[number]>;
        if (method === 'POST') { body = { ...items[0], ...changes, referencePrice: String(changes.referencePrice), id: 2, active: true }; items.push(body as typeof items[number]); }
        else { const index = items.findIndex((item) => item.id === Number(path.split('/')[3]));
          items[index] = { ...items[index]!, ...changes, referencePrice: changes.referencePrice === undefined ? items[index]!.referencePrice : String(changes.referencePrice) };
          body = items[index]; }
      }
    } else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ status: method === 'POST' && path === '/api/services' ? 201 : 200, contentType: 'application/json', body: json(body) });
  });
  return { writes, reads };
}

for (const width of [320, 1280]) {
  test(`F7.2 OWNER administra servicios y navega a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const api = await backend(page, 'OWNER');
    await page.goto('/services');
    await expect(page.getByRole('heading', { name: 'Servicios dentales' })).toBeVisible();
    if (width < 768) {
      await page.getByRole('button', { name: 'Abrir menú de navegación' }).click();
      await page.getByRole('dialog').getByRole('link', { name: 'Servicios', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
    } else await expect(page.getByRole('navigation').getByRole('link', { name: 'Servicios', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('75,1234', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('catalog-list.png'), fullPage: true });
    await page.getByRole('button', { name: 'Nuevo servicio' }).click();
    await expect(page.getByLabel('Nombre', { exact: true })).toBeFocused();
    await page.getByLabel('Nombre', { exact: true }).fill('Consulta preventiva');
    await page.getByLabel('Descripción (opcional)').fill('Orientación y valoración inicial.');
    await page.getByLabel('Precio de referencia', { exact: true }).fill('80,1234');
    await page.getByLabel('Duración (minutos)').fill('40');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('catalog-form.png'), fullPage: true });
    await page.getByRole('button', { name: 'Guardar servicio' }).click();
    await expect(page.getByRole('article', { name: 'Servicio Consulta preventiva' })).toBeVisible();
    await page.getByRole('button', { name: 'Editar Consulta preventiva', exact: true }).click();
    await page.getByLabel('Nombre', { exact: true }).fill('Consulta de revisión');
    await page.getByRole('button', { name: 'Guardar servicio' }).click();
    await expect(page.getByRole('article', { name: 'Servicio Consulta de revisión' })).toBeVisible();
    await page.getByRole('button', { name: 'Desactivar Consulta de revisión', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirmar desactivación' })).toBeFocused();
    await page.getByRole('button', { name: 'Confirmar desactivación' }).click();
    await expect(page.getByRole('article', { name: 'Servicio Consulta de revisión' }).getByText('Inactivo', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reactivar Consulta de revisión', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar reactivación' }).click();
    await expect(page.getByRole('article', { name: 'Servicio Consulta de revisión' }).getByText('Activo', { exact: true })).toBeVisible();
    expect(api.writes.map((request) => request.method)).toEqual(['POST', 'PUT', 'PATCH', 'PATCH']);
    expect(api.writes[0]!.body).toContain('"referencePrice":80.1234');
  });
}

for (const role of ['DENTIST', 'RECEPTIONIST', 'PATIENT']) {
  test(`F7.2 ruta administrativa y controles para ${role}`, async ({ page }) => {
    const api = await backend(page, role);
    await page.goto('/services');
    if (role === 'PATIENT') {
      await expect(page.getByRole('heading', { name: 'Sin acceso' })).toBeVisible();
      expect(api.reads).toEqual([]);
      await expect(page.getByRole('link', { name: 'Servicios', exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByRole('article', { name: 'Servicio Limpieza dental' })).toBeVisible();
      await expect(page.getByRole('button', { name: /Nuevo servicio|Editar|Desactivar|Reactivar/ })).toHaveCount(0);
      await expect(page.getByRole('navigation').getByRole('link', { name: 'Servicios', exact: true })).toBeVisible();
    }
    expect(api.writes).toEqual([]);
  });
}
