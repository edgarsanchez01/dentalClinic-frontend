import { expect, test, type Page } from '@playwright/test';

const now = '2026-10-30T12:00:00Z';
const empty = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
const patients = Array.from({ length: 23 }, (_, i) => ({
  id: i + 1, firstName: i === 0 ? 'Ana' : `Paciente ${i + 1}`, lastName: 'Pérez',
  email: `paciente${i + 1}@example.test`, phone: '555-0101', birthDate: '1990-03-14',
  active: i !== 1, administrativeNotes: 'Contacto administrativo', createdAt: now,
}));

async function fixture(page: Page, role = 'OWNER') {
  const requests: Array<{ path: string; method: string; body: unknown }> = [];
  let patient = { ...patients[0] };
  let clinical = { patientId: 1, allergies: 'Penicilina', medicalBackground: '', clinicalHistory: '', generalObservations: '' };
  await page.clock.setFixedTime(new Date(now));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const body: unknown = request.postData() ? request.postDataJSON() : undefined;
    requests.push({ path: url.pathname + url.search, method, body });
    let result: unknown;
    if (url.pathname === '/api/auth/refresh') result = { accessToken: 'synthetic-owner-patients' };
    else if (url.pathname === '/api/auth/me') result = { id: 10, role, email: 'synthetic@example.test', active: true, dentistId: 7, createdAt: now };
    else if (url.pathname === '/api/onboarding/status') result = { status: 'COMPLETED', clinicConfigured: true };
    else if (url.pathname === '/api/notifications/unread-count') result = { unread: 0 };
    else if (url.pathname === '/api/patients') {
      if (method === 'POST') result = { ...patient, ...body as object, id: 24 };
      else {
        const search = (url.searchParams.get('search') ?? '').toLowerCase();
        const filtered = patients.filter(p => `${p.firstName} ${p.lastName} ${p.email} ${p.phone}`.toLowerCase().includes(search)
          && (!url.searchParams.has('active') || String(p.active) === url.searchParams.get('active')));
        const current = Number(url.searchParams.get('page') ?? 0);
        result = { content: filtered.slice(current * 20, (current + 1) * 20), page: current, size: 20, totalElements: filtered.length, totalPages: Math.ceil(filtered.length / 20) };
      }
    } else if (url.pathname === '/api/patients/1') {
      if (method === 'PATCH') patient = { ...patient, ...body as object };
      result = patient;
    } else if (url.pathname === '/api/patients/1/clinical') {
      if (method === 'PUT') clinical = { ...clinical, ...body as object };
      result = clinical;
    } else if (url.pathname.includes('/medical-intake/declarations')) result = empty;
    else if (url.pathname.startsWith('/api/patients/1/clinical/') || url.pathname.startsWith('/api/patients/1/odontogram')) result = [];
    else if (url.pathname === '/api/services') result = [];
    else if (url.pathname === '/api/appointments') result = empty;
    else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ json: result });
  });
  return requests;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [1440, 768, 390, 320]) {
  test(`OWNER listado compacto, búsqueda, filtros, alta y navegación a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const requests = await fixture(page);
    await page.goto('/patients');
    await expect(page.getByText('23 pacientes', { exact: true })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: test.info().outputPath(`list-${width}.png`), fullPage: true });
    expect(await page.locator('.reception-list').evaluate(el => getComputedStyle(el).rowGap)).toBe('4px');
    await page.getByRole('button', { name: 'Siguientes' }).click();
    await expect(page.getByText('Página 2 de 2')).toBeVisible();
    await page.getByLabel('Buscar').fill('Ana');
    await expect(page.getByText('1 paciente', { exact: true })).toBeVisible();
    await page.getByLabel('Estado', { exact: true }).selectOption('inactive');
    await expect(page.getByText('No hay pacientes que coincidan con la búsqueda.')).toBeVisible();
    await page.getByRole('button', { name: 'Limpiar', exact: true }).click();
    await expect(page.getByText('Página 1 de 2')).toBeVisible();
    await page.getByRole('button', { name: 'Nuevo paciente' }).click();
    await expect(page).toHaveURL(/create=1/);
    await expect(page.getByLabel('Nombre', { exact: true })).toBeFocused();
    await page.getByLabel('Nombre', { exact: true }).fill('Marta');
    await page.getByLabel('Apellidos').fill('Ruiz');
    await noOverflow(page);
    await page.screenshot({ path: test.info().outputPath(`create-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Crear paciente' }).click();
    await expect(page.getByText('Paciente Marta Ruiz creado.')).toBeVisible();
    expect(requests.filter(r => r.method === 'POST' && r.path === '/api/patients')).toEqual([
      { path: '/api/patients', method: 'POST', body: { firstName: 'Marta', lastName: 'Ruiz' } },
    ]);
    await page.locator('.reception-list-row').first().click();
    await expect(page.getByRole('heading', { name: 'Ana Pérez', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Volver al listado' }).click();
    await expect(page.getByRole('heading', { name: 'Pacientes', exact: true })).toBeVisible();
  });

  test(`OWNER ficha: paneles y borradores persistentes a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const requests = await fixture(page);
    await page.goto('/patients/1');
    await expect(page.getByRole('heading', { name: 'Ana Pérez', exact: true })).toBeVisible();
    const select = async (name: string) => {
      await page.getByRole('tab', { name, exact: true }).click();
      await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
      await noOverflow(page);
    };
    await page.screenshot({ path: test.info().outputPath(`administration-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Editar datos' }).click();
    await page.getByLabel('Nombre', { exact: true }).fill('Ana pendiente');
    await select('Declaraciones del paciente');
    await expect(page.getByText(/Declaraciones confirmadas e inmutables/)).toBeVisible();
    await expect(page.getByText('No hay declaraciones confirmadas.')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`declarations-${width}.png`), fullPage: true });
    await select('Expediente clínico');
    await expect(page.getByLabel('Alergias', { exact: true })).toHaveValue('Penicilina');
    await page.getByLabel('Alergias', { exact: true }).fill('Alergia pendiente');
    await page.screenshot({ path: test.info().outputPath(`clinical-${width}.png`), fullPage: true });
    await select('Notas clínicas');
    await page.getByLabel('Nueva nota clínica').fill('Nota pendiente');
    await page.screenshot({ path: test.info().outputPath(`notes-${width}.png`), fullPage: true });
    await select('Tratamientos');
    await page.getByRole('button', { name: 'Nuevo tratamiento' }).click();
    await page.getByLabel('Descripción', { exact: true }).fill('Tratamiento pendiente');
    await page.screenshot({ path: test.info().outputPath(`treatments-${width}.png`), fullPage: true });
    await select('Odontograma');
    await page.getByRole('button', { name: /Pieza 16 Superior derecho Permanente: sin registro/ }).click();
    await page.getByLabel('Observaciones (opcional)', { exact: true }).fill('Pieza pendiente');
    await page.screenshot({ path: test.info().outputPath(`odontogram-${width}.png`), fullPage: true });
    await select('Administración');
    await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Ana pendiente');
    await select('Expediente clínico');
    await expect(page.getByLabel('Alergias', { exact: true })).toHaveValue('Alergia pendiente');
    await select('Notas clínicas');
    await expect(page.getByLabel('Nueva nota clínica')).toHaveValue('Nota pendiente');
    await select('Tratamientos');
    await expect(page.getByLabel('Descripción', { exact: true })).toHaveValue('Tratamiento pendiente');
    await select('Odontograma');
    await expect(page.getByLabel('Observaciones (opcional)', { exact: true })).toHaveValue('Pieza pendiente');
    // La vista alternativa del odontograma se mantiene funcional; no cambia la pieza ni guarda.
    await page.getByRole('button', { name: 'Lista', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Registrar pieza 16', exact: true })).toBeVisible();
    await expect(page.getByLabel('Observaciones (opcional)', { exact: true })).toHaveValue('Pieza pendiente');
    await noOverflow(page);
    expect(requests.filter(r => r.path.startsWith('/api/patients')).every(r => r.method === 'GET')).toBe(true);
  });
}

test('OWNER pestañas: teclado manual y guardado separado', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/patients/1');
  const administration = page.getByRole('tab', { name: 'Administración' });
  await administration.focus();
  await page.keyboard.press('ArrowLeft');
  const notes = page.getByRole('tab', { name: 'Notas clínicas' });
  await expect(notes).toBeFocused();
  await expect(administration).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Space');
  await expect(notes).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(administration).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Editar datos' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Ana María');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Datos actualizados.')).toBeVisible();
  await page.getByRole('tab', { name: 'Expediente clínico' }).click();
  await page.getByLabel('Alergias', { exact: true }).fill('Actualizada');
  await page.getByRole('button', { name: 'Guardar expediente' }).click();
  await expect(page.getByText('Expediente guardado.')).toBeVisible();
  expect(requests.filter(r => r.path.startsWith('/api/patients') && r.method !== 'GET').map(r => [r.path, r.method])).toEqual([
    ['/api/patients/1', 'PATCH'], ['/api/patients/1/clinical', 'PUT'],
  ]);
});

test('OWNER conserva validaciones nativas de alta y edición administrativa', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('/patients?create=1');
  await page.getByRole('button', { name: 'Crear paciente' }).click();
  await expect(page.getByLabel('Nombre', { exact: true })).toBeFocused();
  await page.getByLabel('Nombre', { exact: true }).fill('Marta');
  await page.getByLabel('Apellidos').fill('Ruiz');
  await page.getByLabel('Email (opcional)', { exact: true }).fill('correo-invalido');
  await page.getByRole('button', { name: 'Crear paciente' }).click();
  await expect(page.getByLabel('Email (opcional)', { exact: true })).toBeFocused();
  expect(requests.filter(r => r.path === '/api/patients' && r.method === 'POST')).toHaveLength(0);
  await page.getByLabel('Email (opcional)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Crear paciente' }).click();
  await expect(page.getByText('Paciente Marta Ruiz creado.')).toBeVisible();
  await page.goto('/patients/1');
  await page.getByRole('button', { name: 'Editar datos' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByLabel('Nombre', { exact: true })).toBeFocused();
  expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(0);
});

// Comparación con la copia pre-tarea, no con capturas generadas por esta implementación.
for (const width of [1440, 768, 390, 320]) {
  test(`RECEPTIONIST y DENTIST conservados frente a referencia a ${width}px`, async ({ page, context }) => {
    const baseline = await context.newPage();
    for (const role of ['RECEPTIONIST', 'DENTIST']) {
      for (const target of [page, baseline]) {
        await target.unrouteAll({ behavior: 'wait' });
        await target.setViewportSize({ width, height: 1000 });
        await fixture(target, role);
      }
      for (const path of role === 'RECEPTIONIST' ? ['/patients', '/patients?create=1', '/patients/1'] : ['/patients', '/patients/1']) {
        await Promise.all([page.goto(path), baseline.goto(`http://127.0.0.1:5295${path}`)]);
        for (const target of [page, baseline]) {
          if (path.includes('create')) await expect(target.getByLabel('Nombre', { exact: true })).toBeVisible();
          else if (path.endsWith('/1')) await expect(target.getByRole('heading', { name: role === 'RECEPTIONIST' ? 'Ana Pérez' : 'Pérez, Ana', exact: true })).toBeVisible();
          else await expect(target.getByText('23 pacientes', { exact: true })).toBeVisible();
          await target.evaluate(() => document.fonts.ready);
          await target.mouse.move(0, 0);
        }
        const snapshot = (target: Page) => target.locator('main').evaluate(main => {
          const elements = Array.from(main.querySelectorAll<HTMLElement>('*')).filter(el => el.getClientRects().length);
          return elements.map(el => {
            const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
            return [el.tagName, el.innerText, rect.x, rect.y, rect.width, rect.height, css.color, css.backgroundColor, css.fontSize, css.padding, css.gap, css.borderRadius];
          });
        });
        expect(await snapshot(page), `${role} ${path}`).toEqual(await snapshot(baseline));
        await noOverflow(page);
      }
    }
    await baseline.close();
  });
}
