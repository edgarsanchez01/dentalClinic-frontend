import { expect, test, type Page } from '@playwright/test';

const NOW = '2026-10-25T12:00:00Z';
const patients = Array.from({ length: 23 }, (_, index) => ({
  id: index + 1, firstName: index < 2 ? 'Ana' : `Paciente ${index + 1}`, lastName: 'Pérez',
  email: index === 1 ? null : `paciente${index + 1}@example.test`, phone: index === 1 ? null : '555-0101',
  birthDate: index === 1 ? null : '1990-03-14', active: index !== 1, createdAt: NOW,
}));
const empty = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };

async function fixture(page: Page, role: string) {
  const state = { error: false, pending: false };
  const requests: Array<{ path: string; method: string }> = [];
  let release = () => {};
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // All APIs are intercepted, including unknown routes. Never reach a real backend.
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    requests.push({ path: url.pathname + url.search, method: route.request().method() });
    let body: unknown;
    if (url.pathname === '/api/auth/refresh') body = { accessToken: 'synthetic-patients-token' };
    else if (url.pathname === '/api/auth/me') body = { id: 10, role, email: 'synthetic@example.test', active: true, dentistId: 7, createdAt: NOW };
    else if (url.pathname === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (url.pathname === '/api/notifications/unread-count') body = { unread: 0 };
    else if (url.pathname === '/api/patients') {
      if (state.pending) await new Promise<void>((resolve) => { release = resolve; });
      if (state.error) {
        await route.fulfill({ status: 503, json: { message: 'Listado temporalmente no disponible.' } });
        return;
      }
      const search = (url.searchParams.get('search') ?? '').toLowerCase();
      const filtered = patients.filter((patient) => `${patient.firstName} ${patient.lastName} ${patient.email ?? ''} ${patient.phone ?? ''}`.toLowerCase().includes(search)
        && (!url.searchParams.has('active') || String(patient.active) === url.searchParams.get('active')));
      const current = Number(url.searchParams.get('page') ?? 0);
      body = { content: filtered.slice(current * 20, (current + 1) * 20), page: current, size: 20, totalElements: filtered.length, totalPages: Math.ceil(filtered.length / 20) };
    } else if (url.pathname === '/api/patients/1') body = patients[0];
    else if (url.pathname === '/api/patients/1/clinical') body = { patientId: 1, medicalBackground: 'Antecedente sintético', allergies: 'Alergia sintética' };
    else if (url.pathname.includes('/clinical/medical-intake/declarations')) body = { ...empty, size: 10 };
    else if (url.pathname.startsWith('/api/patients/1/clinical/') || url.pathname.startsWith('/api/patients/1/odontogram')) body = [];
    else if (url.pathname === '/api/services') body = [];
    else if (url.pathname === '/api/appointments') body = empty;
    else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ json: body });
  });
  return { state, requests, release: () => release() };
}

async function ready(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
}

test('BUILD02 regresión visual de recepción, OWNER y expediente profesional', async ({ page }) => {
  test.skip(!process.env.DC_PATIENTS_CAPTURE, 'Capturas previas/posteriores opt-in con configuración aislada.');
  for (const role of ['RECEPTIONIST', 'OWNER', 'DENTIST']) {
    await page.unrouteAll({ behavior: 'wait' });
    await fixture(page, role);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const view of role === 'DENTIST' ? ['record'] : ['list', 'create']) {
        await page.goto(view === 'record' ? '/patients/1' : view === 'create' ? '/patients?create=1' : '/patients');
        if (view === 'record') await expect(page.getByLabel('Alergias', { exact: true })).toHaveValue('Alergia sintética');
        else if (view === 'create') await expect(page.getByLabel('Nombre', { exact: true })).toBeVisible();
        else await expect(page.getByText('23 pacientes', { exact: true })).toBeVisible();
        await ready(page);
        await expect(page).toHaveScreenshot(`${role}-${view}-${width}.png`, { fullPage: true, animations: 'disabled', threshold: 0.2, maxDiffPixels: 0 });
      }
    }
  }
});

for (const width of [1440, 768, 390, 320]) {
  test(`BUILD02 listado compartido DENTIST/RECEPTIONIST a ${width}px`, async ({ page, context }) => {
    const reception = await context.newPage();
    await page.setViewportSize({ width, height: 1000 });
    await reception.setViewportSize({ width, height: 1000 });
    const api = await fixture(page, 'DENTIST');
    await fixture(reception, 'RECEPTIONIST');
    await Promise.all([page.goto('/patients?create=1'), reception.goto('/patients')]);
    for (const target of [page, reception]) {
      await expect(target.getByText('23 pacientes', { exact: true })).toBeVisible();
      await ready(target);
    }
    await expect(page.locator('.dentist-shell')).toHaveCount(1);
    await expect(page.locator('.reception-shell')).toHaveCount(0);
    await expect(page.getByRole('form')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Nuevo paciente|Crear paciente|Editar datos|Desactivar|Reactivar/ })).toHaveCount(0);
    // Only the heading's permitted actions/copy differ. The actual list blocks share DOM and pixels.
    // Normalize only the excluded heading's height so subpixel origins agree, and hide
    // fixed navigation that would otherwise overlay these independently captured blocks.
    const comparisonStyle = '.reception-page-heading { height: 200px !important; } nav[aria-label="Navegación rápida"] { visibility: hidden !important; }';
    for (const selector of ['.reception-filters', '.reception-list', '.reception-pagination']) {
      const actual = page.locator(selector), reference = reception.locator(selector);
      expect(await actual.innerHTML()).toBe(await reference.innerHTML());
      const expectedImage = await reference.screenshot({ path: test.info().outputPath(`reception-${selector.slice(1)}-${width}.png`), animations: 'disabled', style: comparisonStyle });
      const actualImage = await actual.screenshot({ path: test.info().outputPath(`dentist-${selector.slice(1)}-${width}.png`), animations: 'disabled', style: comparisonStyle });
      expect(actualImage.equals(expectedImage), `${selector}: mismos píxeles`).toBe(true);
    }
    await page.screenshot({ path: test.info().outputPath(`dentist-full-${width}.png`), fullPage: true });
    await reception.screenshot({ path: test.info().outputPath(`reception-full-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.reception-list-row').first()).toHaveAttribute('href', '/patients/1');
    await page.locator('.reception-list-row').first().click();
    await expect(page).toHaveURL(/\/patients\/1$/);
    await expect(page.getByRole('heading', { name: 'Expediente clínico', exact: true })).toBeVisible();
    await expect(page.getByLabel('Alergias', { exact: true })).toHaveValue('Alergia sintética');
    await expect(page.getByRole('button', { name: 'Guardar expediente' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tratamientos', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Editar datos', exact: true })).toHaveCount(0);
    expect(api.requests.filter(({ path }) => path.startsWith('/api/patients')).every(({ method }) => method === 'GET')).toBe(true);
    await reception.close();
  });
}

test('BUILD02 DENTIST busca con debounce, pagina, filtra y limpia sin escrituras', async ({ page }) => {
  await page.clock.install({ time: new Date(NOW) });
  const api = await fixture(page, 'DENTIST');
  await page.goto('/patients');
  await expect(page.getByText('Página 1 de 2')).toBeVisible();
  // El efecto inicial existente también aplica el debounce y resetea la página.
  // Consumirlo con reloj controlado antes de probar paginación, sin sleeps reales.
  await page.clock.runFor(300);
  await page.getByRole('button', { name: 'Siguientes' }).click();
  await expect(page.getByText('Página 2 de 2')).toBeVisible();
  await page.getByRole('button', { name: 'Anteriores' }).click();
  await expect(page.getByText('Página 1 de 2')).toBeVisible();
  const search = page.getByLabel('Buscar', { exact: true });
  await search.fill('A');
  await search.fill('Ana');
  await expect(page.getByText('2 pacientes', { exact: true })).toBeVisible();
  expect(api.requests.some(({ path }) => /search=A&/.test(path))).toBe(false);
  await page.getByLabel('Estado', { exact: true }).selectOption('inactive');
  await expect(page.getByText('1 paciente', { exact: true })).toBeVisible();
  await expect(page.locator('.reception-list-row')).toHaveCount(1);
  await search.fill('sin-coincidencias');
  await expect(page.getByText('No hay pacientes que coincidan con la búsqueda.')).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar búsqueda y filtros' }).click();
  await expect(search).toHaveValue('');
  await expect(page.getByLabel('Estado', { exact: true })).toHaveValue('all');
  await expect(page.getByText('23 pacientes', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Limpiar', exact: true })).toBeDisabled();
  expect(api.requests.filter(({ path }) => path.startsWith('/api/patients')).every(({ method }) => method === 'GET')).toBe(true);
});

test('BUILD02 DENTIST conserva skeleton, error y reintento', async ({ page }) => {
  const api = await fixture(page, 'DENTIST');
  api.state.pending = true;
  await page.goto('/patients?create=1');
  await expect(page.getByText('Cargando pacientes…')).toBeVisible();
  await expect(page.locator('.reception-patients-skeleton-row')).toHaveCount(3);
  api.state.error = true;
  api.state.pending = false;
  api.release();
  await expect(page.getByRole('alert')).toContainText('Listado temporalmente no disponible.');
  api.state.error = false;
  await page.getByRole('button', { name: 'Reintentar el listado' }).click();
  await expect(page.getByText('23 pacientes', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo paciente' })).toHaveCount(0);
  expect(api.requests.filter(({ path }) => path.startsWith('/api/patients')).every(({ method }) => method === 'GET')).toBe(true);
});
