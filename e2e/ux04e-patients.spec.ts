import { expect, test, type Page } from '@playwright/test';

/**
 * UX-04E / UX-04E.1 — Pacientes de Recepción (RECEPTIONIST).
 *
 * Cubre el listado editorial (nombres en orden natural, datos secundarios para
 * desambiguar homónimos), la barra de búsqueda y filtros, el alta por URL como
 * tarea enfocada, la ficha en modo consulta con edición explícita y la ausencia
 * de consultas clínicas para recepción. Todas las APIs quedan interceptadas: no
 * se escribe en la base de datos.
 */
const NOW = '2026-10-18T12:00:00Z';
const empty = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
const patient = {
  id: 1,
  firstName: 'Ana',
  lastName: 'Pérez',
  email: 'ana@ejemplo.test',
  phone: '555-0101',
  birthDate: '1990-03-14',
  administrativeNotes: 'Referida por la dra. Ruiz.',
  active: true,
  userId: 44,
  createdAt: NOW,
};
const list = {
  // Dos personas con el mismo nombre y apellidos: deben poder distinguirse.
  content: [
    patient,
    {
      id: 2,
      firstName: 'Ana',
      lastName: 'Pérez',
      email: null,
      phone: '555-0202',
      birthDate: '1985-11-02',
      active: false,
      createdAt: NOW,
    },
  ],
  page: 0,
  size: 20,
  totalElements: 21,
  totalPages: 2,
};

async function fixture(page: Page) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    let body: unknown;
    switch (url.pathname) {
      case '/api/auth/refresh': body = { accessToken: 'ux04e' }; break;
      case '/api/auth/me': body = { id: 1, role: 'RECEPTIONIST', email: 'recepcion@clinica.test', active: true, createdAt: NOW }; break;
      case '/api/onboarding/status': body = { status: 'COMPLETED', clinicConfigured: true }; break;
      case '/api/availability/policy': body = { timezone: 'America/Mexico_City', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 }; break;
      case '/api/public/schedule':
      case '/api/schedules/clinic': body = { timezone: 'America/Mexico_City', days: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, open: i < 5, startTime: i < 5 ? '09:00:00' : null, endTime: i < 5 ? '18:00:00' : null, breaks: [] })), exceptions: [], dentists: [] }; break;
      case '/api/patients':
        if (method === 'POST') {
          body = { id: 3, ...JSON.parse(String(route.request().postData())) };
          break;
        }
        if (url.searchParams.get('search') === 'vacio') { body = empty; break; }
        body = list;
        break;
      case '/api/patients/1':
        if (method === 'PATCH') {
          body = { ...patient, ...JSON.parse(String(route.request().postData())) };
          break;
        }
        body = patient;
        break;
      case '/api/charges': body = empty; break;
      case '/api/patients/1/odontogram/reception-summary': body = []; break;
      case '/api/notifications': body = empty; break;
      case '/api/notifications/unread-count': body = { unread: 0 }; break;
      default: await route.fulfill({ status: method === 'GET' ? 404 : 200, json: {} }); return;
    }
    await route.fulfill({ status: 200, json: body });
  });
}

const dir = process.env.UX04E1_DIR ?? '/tmp/opencode/ux04e1/after';

test('UX-04E.1 listado: nombre natural, homónimos distinguibles, recuento, paginación y vacío', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  await page.goto('/patients');
  await expect(page.getByRole('heading', { name: 'Pacientes', exact: true })).toBeVisible();

  const rows = page.locator('.reception-list-row');
  await expect(rows).toHaveCount(2);
  const first = rows.first();
  await expect(first.getByText('Ana Pérez', { exact: true })).toBeVisible();
  await expect(first.getByText('ana@ejemplo.test · 555-0101', { exact: true })).toBeVisible();
  await expect(first.getByText('14 mar 1990', { exact: true })).toBeVisible();
  await expect(first.getByText('Activo', { exact: true })).toBeVisible();
  await expect(first.getByText('Ver ficha', { exact: true })).toBeVisible();
  await expect(first).toHaveAttribute('href', /\/patients\/1$/);

  // El homónimo se distingue por fecha de nacimiento y contacto reales.
  const second = rows.nth(1);
  await expect(second.getByText('Ana Pérez', { exact: true })).toBeVisible();
  await expect(second.getByText('2 nov 1985', { exact: true })).toBeVisible();
  await expect(second.getByText('555-0202', { exact: true })).toBeVisible();
  await expect(second.getByText('Inactivo', { exact: true })).toBeVisible();

  await expect(page.getByText('21 pacientes', { exact: true })).toBeVisible();
  await expect(page.getByText('Página 1 de 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Limpiar', exact: true })).toBeDisabled();

  await page.getByLabel('Buscar').fill('vacio');
  await expect(page.getByText('No hay pacientes que coincidan con la búsqueda.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar búsqueda y filtros', exact: true }).click();
  await expect(page.locator('.reception-list-row')).toHaveCount(2);
  await page.screenshot({ path: `${dir}/listado-1440.png`, fullPage: true });
});

test('UX-04E.1 alta: es una tarea enfocada y oculta listado, búsqueda y filtros', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const created: Array<Record<string, unknown>> = [];
  await fixture(page);
  await page.route('**/api/patients', async (route) => {
    if (route.request().method() === 'POST') {
      created.push(JSON.parse(String(route.request().postData())) as Record<string, unknown>);
      await route.fulfill({ status: 201, json: { id: 3, firstName: 'Marta', lastName: 'Ruiz', active: true, createdAt: NOW } });
      return;
    }
    await route.fallback();
  });
  await page.goto('/patients?create=1');
  await expect(page.getByRole('heading', { name: 'Nuevo paciente', exact: true })).toBeVisible();
  await expect(page.getByText('Registra los datos administrativos de una persona sin crearle una cuenta de acceso.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Nombre', { exact: true })).toBeFocused();
  // Mientras se registra, el listado y sus controles no compiten por la atención.
  await expect(page.getByRole('heading', { name: 'Pacientes', exact: true })).toBeHidden();
  await expect(page.getByLabel('Buscar')).toBeHidden();
  await expect(page.locator('.reception-list-row')).toHaveCount(0);

  // Validación en español junto al campo, sin invocar la API.
  await page.getByRole('button', { name: 'Crear paciente', exact: true }).click();
  await expect(page.getByText('Indica el nombre del paciente.', { exact: true })).toBeVisible();
  await expect(page.getByText('Indica los apellidos del paciente.', { exact: true })).toBeVisible();
  expect(created).toHaveLength(0);

  // Cancelar regresa al listado sin guardar.
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pacientes', exact: true })).toBeVisible();
  expect(created).toHaveLength(0);

  // Alta real.
  await page.goto('/patients?create=1');
  await page.getByLabel('Nombre', { exact: true }).fill('Marta');
  await page.getByLabel('Apellidos', { exact: true }).fill('Ruiz');
  await page.getByRole('button', { name: 'Crear paciente', exact: true }).click();
  await expect(page.getByText(/Paciente Marta Ruiz creado\./)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver ficha de Marta', exact: true })).toBeVisible();
  expect(created).toEqual([{ firstName: 'Marta', lastName: 'Ruiz' }]);
  await expect(page.getByRole('heading', { name: 'Nuevo paciente', exact: true })).toBeHidden();
  await page.screenshot({ path: `${dir}/alta-1440.png`, fullPage: true });
});

test('UX-04E.1 ficha: consulta por defecto, edición explícita y sin consultas clínicas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const clinical: string[] = [];
  const patches: Array<Record<string, unknown>> = [];
  await page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    // UX-05F permits only the reduced current summary, never the clinical namespace.
    if (/\/api\/patients\/1\/(clinical|odontogram)/.test(path)
      && path !== '/api/patients/1/odontogram/reception-summary') {
      clinical.push(request.url());
    }
  });
  await fixture(page);
  await page.route('**/api/patients/1', async (route) => {
    if (route.request().method() === 'PATCH') {
      patches.push(JSON.parse(String(route.request().postData())) as Record<string, unknown>);
    }
    await route.fallback();
  });
  await page.goto('/patients/1');

  // Estado inicial: lectura, no formulario editable.
  await expect(page.getByRole('heading', { name: 'Ana Pérez', exact: true })).toBeVisible();
  await expect(page.getByText('14 mar 1990', { exact: true })).toBeVisible();
  await expect(page.getByText('ana@ejemplo.test', { exact: true })).toBeVisible();
  await expect(page.getByText('Referida por la dra. Ruiz.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Acciones relacionadas', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver cargos de este paciente', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '← Volver al listado', exact: true })).toHaveAttribute('href', '/patients');
  await expect(page.getByLabel('Teléfono (opcional)')).toBeHidden();
  await page.screenshot({ path: `${dir}/ficha-consulta-1440.png`, fullPage: true });

  // Cancelar edición descarta el borrador sin persistir.
  await page.getByRole('button', { name: 'Editar datos', exact: true }).click();
  await expect(page.getByLabel('Teléfono (opcional)')).toHaveValue('555-0101');
  await page.getByLabel('Teléfono (opcional)').fill('555-9999');
  await page.getByRole('button', { name: 'Cancelar edición', exact: true }).click();
  await expect(page.getByLabel('Teléfono (opcional)')).toBeHidden();
  expect(patches).toHaveLength(0);

  // Guardado real y vuelta a consulta.
  await page.getByRole('button', { name: 'Editar datos', exact: true }).click();
  await expect(page.getByLabel('Teléfono (opcional)')).toHaveValue('555-0101');
  await page.getByLabel('Teléfono (opcional)').fill('555-0102');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.getByText('Datos actualizados.', { exact: true })).toBeVisible();
  await expect(page.getByText('555-0102', { exact: true })).toBeVisible();
  expect(patches).toEqual([expect.objectContaining({ phone: '555-0102', active: true })]);
  expect(clinical).toEqual([]);
});

test('UX-04E.1 responsive 320/390/768/1280/1440 sin desbordes horizontales', async ({ page }) => {
  await fixture(page);
  const captures: Array<[number, string]> = [
    [390, 'listado-390'],
    [390, 'alta-390'],
    [390, 'ficha-390'],
  ];
  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/patients', '/patients?create=1', '/patients/1']) {
      await page.goto(path);
      await page.waitForTimeout(120);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${path} desborda a ${width}px`,
      ).toBe(true);
    }
    if (width === 390) {
      for (const [captureWidth, name] of captures) {
        expect(captureWidth).toBe(width);
        await page.goto(name.startsWith('listado') ? '/patients' : name.startsWith('alta') ? '/patients?create=1' : '/patients/1');
        await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
      }
    }
  }
});

test('UX-04E.1 zoom 200 %: la información sigue disponible sin desbordes', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const path of ['/patients', '/patients?create=1', '/patients/1']) {
    await page.goto(path);
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await page.waitForTimeout(120);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `${path} desborda al 200 %`,
    ).toBe(true);
  }
});
