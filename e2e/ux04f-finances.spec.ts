import { expect, test, type Page } from '@playwright/test';

/**
 * UX-04F — Finanzas de Recepción.
 *
 * Todo `/api/**` se intercepta con datos sintéticos: ninguna prueba toca la base
 * de datos ni servicios externos. Los contratos existentes (etiquetas, regiones,
 * conteos del servidor, idempotencia) se comprueban sin debilitarlos; además se
 * verifica que OWNER conserve la presentación anterior.
 */
const NOW = '2026-10-18T16:00:00Z';
const empty = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };

const CHARGES = [
  { id: 101, patientId: 10, appointmentId: 7, totalAmount: '300.00', appliedAmount: '0.00', pendingBalance: '300.00', status: 'PENDIENTE', confirmedAt: NOW },
  { id: 102, patientId: 11, appointmentId: null, totalAmount: '1250.50', appliedAmount: '400.00', pendingBalance: '850.50', status: 'PARCIAL', confirmedAt: '2026-10-16T18:30:00Z' },
  { id: 103, patientId: 12, appointmentId: null, totalAmount: '750.00', appliedAmount: '750.00', pendingBalance: '0.00', status: 'PAGADO', confirmedAt: '2026-10-12T15:00:00Z' },
  { id: 104, patientId: 13, appointmentId: null, totalAmount: '420.00', appliedAmount: '0.00', pendingBalance: '0.00', status: 'ANULADO', confirmedAt: '2026-10-10T11:00:00Z' },
];

const PATIENTS = [
  { id: 10, firstName: 'Ana', lastName: 'Pérez', email: 'ana@ejemplo.test', phone: '555-0101', active: true },
  { id: 11, firstName: 'Luis', lastName: 'Gómez', email: 'luis@ejemplo.test', phone: '555-0102', active: true },
];

const PATIENT = { id: 10, firstName: 'Ana', lastName: 'Pérez', email: 'ana@ejemplo.test', phone: '555-0101', active: true, birthDate: null, address: null, notes: null, createdAt: NOW, updatedAt: null };

function chargeDetail(id: number) {
  const base = CHARGES.find((charge) => charge.id === id) ?? CHARGES[0]!;
  const items = [{ id: 1, chargeId: id, description: 'Limpieza dental y pulido', quantity: 1, unitPrice: base.totalAmount, lineTotal: base.totalAmount, createdAt: NOW }];
  const movements = base.status === 'PENDIENTE' || base.status === 'ANULADO' ? [] : [
    { id: 5, chargeId: id, patientId: base.patientId, type: 'PAYMENT', amount: base.appliedAmount, paymentMethod: 'CASH', reversesMovementId: null, reason: null, performedByUserId: 1, performedAt: '2026-10-17T16:00:00Z', createdAt: NOW },
  ];
  return {
    ...base, currency: 'MXN', notes: 'Pago acordado en recepción.', confirmedByUserId: 1, createdAt: NOW,
    cancelledAt: base.status === 'ANULADO' ? '2026-10-10T12:00:00Z' : null,
    cancelledByUserId: base.status === 'ANULADO' ? 1 : null,
    cancellationReason: base.status === 'ANULADO' ? 'Captura duplicada.' : null,
    version: 1, items, movements,
  };
}

const CREATED = {
  id: 105, patientId: 10, appointmentId: null, currency: 'MXN', totalAmount: '650.00', appliedAmount: '0.00',
  pendingBalance: '650.00', status: 'PENDIENTE', notes: null, confirmedAt: NOW, confirmedByUserId: 1,
  cancelledAt: null, cancelledByUserId: null, cancellationReason: null, version: 1, createdAt: NOW, updatedAt: null,
  items: [{ id: 9, chargeId: 105, description: 'Consulta de valoración', quantity: 1, unitPrice: '650.00', lineTotal: '650.00', createdAt: NOW }],
  movements: [],
};

type Write = { path: string; method: string; key: string | undefined; body: string | null };

export async function fixture(page: Page, role: 'OWNER' | 'RECEPTIONIST' = 'RECEPTIONIST', writes: Write[] = [],
  options: { patientPages?: boolean; chargePages?: boolean; dropFirstCharge?: boolean } = {}) {
  const intents = new Map<string, { operation: string; intentId: string; state: string; registeredAt: string; effect?: { chargeId: number; movementId?: number } }>();
  let dropped = false, dropRead = false;
  await page.clock.setFixedTime(new Date(NOW));
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/api/financial-intents') {
      if (method === 'GET') {
        await route.fulfill({ json: { items: [...intents.values()].filter(row => url.searchParams.get('view') === 'recent' || row.state === 'REGISTERED') } }); return;
      }
      const body = route.request().postDataJSON() as { operation: string; intentId: string };
      writes.push({ path: url.pathname, method, key: body.intentId, body: route.request().postData() });
      const row = { operation: body.operation, intentId: body.intentId, state: 'REGISTERED', registeredAt: NOW };
      intents.set(body.intentId, row); await route.fulfill({ status: 201, json: row }); return;
    }
    if (url.pathname.startsWith('/api/financial-intents/')) {
      const [, , , , id, action] = url.pathname.split('/');
      const row = intents.get(id!);
      if (!row) { await route.fulfill({ status: 404, json: {} }); return; }
      if (method === 'GET') {
        if (dropRead) { dropRead = false; await route.abort('failed'); return; }
        await route.fulfill({ json: row }); return;
      }
      if (action === 'execute') {
        row.state = 'CONFIRMED'; row.effect = row.operation === 'FIN_CONFIRM_CHARGE' ? { chargeId: 105 } : { chargeId: 101, movementId: 77 };
        if (options.dropFirstCharge && !dropped) { dropped = true; dropRead = true; await route.abort('failed'); return; }
        await route.fulfill({ json: row }); return;
      }
    }
    if (method !== 'GET' && url.pathname.startsWith('/api/charges')) {
      writes.push({ path: url.pathname, method, key: route.request().headers()['idempotency-key'], body: route.request().postData() });
      if (url.pathname === '/api/charges') {
        // Simula una respuesta perdida: el servidor committed el cargo pero el cliente no la recibe.
        if (options.dropFirstCharge && writes.filter((write) => write.path === '/api/charges').length === 1) {
          await route.abort('failed'); return;
        }
        await route.fulfill({ status: 201, json: CREATED }); return;
      }
      if (url.pathname === '/api/charges/101/payments') {
        await route.fulfill({ status: 201, json: {
          id: 77, chargeId: 101, patientId: 10, type: 'PAYMENT', amount: '100.00', paymentMethod: 'CASH',
          reversesMovementId: null, reason: null, performedByUserId: 1, performedAt: NOW, createdAt: NOW,
        } });
        return;
      }
    }
    let body: unknown;
    switch (url.pathname) {
      case '/api/auth/refresh': body = { accessToken: 'ux04f' }; break;
      case '/api/auth/me': body = { id: 1, role, email: `${role.toLowerCase()}@clinica.test`, active: true, createdAt: NOW }; break;
      case '/api/onboarding/status': body = { status: 'COMPLETED', clinicConfigured: true }; break;
      case '/api/clinic': body = { name: 'Clínica Dental de prueba', timezone: 'America/Mexico_City' }; break;
      case '/api/availability/policy': body = { timezone: 'America/Mexico_City', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 }; break;
      case '/api/public/schedule':
      case '/api/schedules/clinic': body = { timezone: 'America/Mexico_City', days: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, open: i < 5, startTime: i < 5 ? '09:00:00' : null, endTime: i < 5 ? '18:00:00' : null, breaks: [] })), exceptions: [], dentists: [{ dentistId: 7, firstName: 'Ana', lastName: 'Uno', days: [] }] }; break;
      case '/api/schedules/clinic/exceptions': body = []; break;
      case '/api/schedules/dentist/7': body = { dentistId: 7, timezone: 'America/Mexico_City', days: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, open: i < 4, startTime: i < 4 ? '09:00:00' : null, endTime: i < 4 ? '14:00:00' : null, breaks: [] })) }; break;
      case '/api/schedules/dentist/7/exceptions': body = []; break;
      case '/api/schedules/dentist/7/time-off': body = []; break;
      case '/api/services': body = [{ id: 1, name: 'Limpieza dental', description: null, referencePrice: 75, durationMinutes: 35, active: true, createdAt: NOW, updatedAt: null }]; break;
      case '/api/patients': {
        const search = url.searchParams.get('search') ?? '';
        const pageParam = Number(url.searchParams.get('page') ?? 0);
        if (options.patientPages) {
          const pages = [
            [PATIENTS[0]!],
            [PATIENTS[1]!],
          ];
          body = { content: pages[pageParam] ?? [], page: pageParam, size: 1, totalElements: PATIENTS.length, totalPages: pages.length };
        } else if (search === 'sin-resultados') {
          body = { ...empty };
        } else {
          const term = search.trim().toLowerCase();
          const content = PATIENTS.filter((patient) => `${patient.firstName} ${patient.lastName} ${patient.email} ${patient.phone}`.toLowerCase().includes(term));
          body = { content, page: 0, size: 10, totalElements: content.length, totalPages: content.length ? 1 : 0 };
        }
        break;
      }
      case '/api/patients/10': body = PATIENT; break;
      case '/api/patients/11': body = { ...PATIENT, id: 11, firstName: 'Luis', lastName: 'Gómez' }; break;
      case '/api/patients/12': body = { ...PATIENT, id: 12, firstName: 'María', lastName: 'Ruiz' }; break;
      case '/api/patients/13': body = { ...PATIENT, id: 13, firstName: 'Jorge', lastName: 'Santos' }; break;
      case '/api/notifications': body = empty; break;
      case '/api/notifications/unread-count': body = { unread: 0 }; break;
      case '/api/appointments': body = { ...empty, content: [{ id: 7, patientId: 10, patientFirstName: 'Ana', patientLastName: 'Pérez', dentistId: 7, dentistFirstName: 'Ana', dentistLastName: 'Uno', startAt: '2026-10-18T16:00:00Z', endAt: '2026-10-18T16:30:00Z', durationMinutes: 30, status: 'COMPLETED', occurrenceVersion: 1, createdByUserId: 1, createdAt: NOW }] }; break;
      case '/api/appointments/7': body = { id: 7, patientId: 10, dentistId: 7, patientFirstName: 'Ana', patientLastName: 'Pérez', dentistFirstName: 'Ana', dentistLastName: 'Uno', startAt: '2026-10-18T16:00:00Z', endAt: '2026-10-18T16:30:00Z', durationMinutes: 30, status: 'COMPLETED', occurrenceVersion: 1, createdByUserId: 1, createdAt: NOW }; break;
      case '/api/availability': body = { dentistId: 7, durationMinutes: 30, timezone: 'America/Mexico_City', slots: [] }; break;
      case '/api/feedback': body = { ...empty, count: 0, average: null }; break;
      case '/api/users': body = []; break;
      case '/api/charges': body = options.chargePages
        ? { content: [CHARGES[0]!], page: Number(url.searchParams.get('page') ?? 0), size: 1, totalElements: CHARGES.length, totalPages: CHARGES.length }
        : { content: CHARGES, page: 0, size: 20, totalElements: CHARGES.length, totalPages: 1 }; break;
      case '/api/charges/101': body = chargeDetail(101); break;
      case '/api/charges/102': body = chargeDetail(102); break;
      case '/api/charges/103': body = chargeDetail(103); break;
      case '/api/charges/104': body = chargeDetail(104); break;
      case '/api/charges/105': body = CREATED; break;
      case '/api/financial/reports/portfolio': body = { asOf: NOW, confirmedCharges: 4, billedAmount: '2720.50', appliedAmount: '1150.00', pendingBalance: '1150.50', statusCounts: { pendiente: 1, parcial: 1, pagado: 1, anulado: 1 } }; break;
      case '/api/financial/reports/cash-flow': body = { from: null, to: null, grossAmount: '2500.50', reversalAmount: '150.00', netAmount: '2350.50', methods: [
        { method: 'CASH', grossAmount: '1400.00', reversalAmount: '0.00', netAmount: '1400.00' },
        { method: 'CARD', grossAmount: '800.50', reversalAmount: '150.00', netAmount: '650.50' },
        { method: 'TRANSFER', grossAmount: '300.00', reversalAmount: '0.00', netAmount: '300.00' },
      ] }; break;
      case '/api/financial/reports/charges': body = { patientId: null, status: null, from: null, to: null, confirmedCharges: 4, billedAmount: '2720.50', appliedAmount: '1150.00', pendingBalance: '1150.50', byPatient: [
        { patientId: 10, chargeCount: 1, billedAmount: '300.00', appliedAmount: '0.00', pendingBalance: '300.00' },
        { patientId: 11, chargeCount: 1, billedAmount: '1250.50', appliedAmount: '400.00', pendingBalance: '850.50' },
        { patientId: 12, chargeCount: 1, billedAmount: '750.00', appliedAmount: '750.00', pendingBalance: '0.00' },
        { patientId: 13, chargeCount: 1, billedAmount: '420.00', appliedAmount: '0.00', pendingBalance: '0.00' },
      ] }; break;
      default: await route.fulfill({ status: route.request().method() === 'GET' ? 404 : 200, json: {} }); return;
    }
    await route.fulfill({ status: 200, json: body });
  });
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function selectReceptionPatient(page: Page) {
  const input = page.getByRole('combobox', { name: /^Paciente/ });
  await input.fill('Ana');
  await page.getByRole('option', { name: /Ana Pérez.*Paciente #10/ }).click();
  await expect(input).toHaveValue('Ana Pérez');
  await expect(page.getByText('Verificando paciente seleccionado…')).toHaveCount(0);
}

const MONO = 'IBM Plex Mono';

test('UX-04F recepción: listado editorial con estado textual, importes legibles y filtros plegados', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  await page.goto('/finances');

  await expect(page.getByRole('heading', { name: 'Finanzas', exact: true })).toBeVisible();
  // Contrato previo: el conteo sigue siendo una sola frase con cifra del servidor.
  await expect(page.getByText('4 cargos autorizados con estos filtros. No es un reporte de ingresos o saldo global.')).toBeVisible();
  const table = page.getByRole('region', { name: 'Tabla de cargos autorizados' });
  await expect(table.locator('tbody tr')).toHaveCount(4);

  // El nombre accesible del estado no depende del glifo decorativo.
  for (const label of ['Pendiente', 'Parcial', 'Pagado', 'Anulado']) {
    await expect(table.getByRole('cell', { name: label, exact: true })).toBeVisible();
  }
  await expect(table.locator('.reception-finances-chip-marker').first()).toBeVisible();

  // Importes en monoespaciada y alineados a la derecha.
  const amount = table.locator('td.reception-finances-amount').first();
  expect(await amount.evaluate((el) => getComputedStyle(el).fontFamily)).toContain(MONO);
  expect(await amount.evaluate((el) => getComputedStyle(el).textAlign)).toBe('right');

  // Los filtros avanzados siguen plegados y se anuncian cuando hay filtros activos.
  const advanced = page.getByRole('form', { name: 'Filtrar cargos' }).locator('details.reception-advanced');
  expect(await advanced.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
  await advanced.locator('summary').click();
  await page.getByLabel('Estado del cargo').selectOption('PARCIAL');
  await expect(advanced.locator('summary')).toHaveText(/1 activo/);
  await page.getByRole('form', { name: 'Filtrar cargos' }).getByRole('button', { name: 'Aplicar filtros' }).last().click();
  await expect(page).toHaveURL(/[?&]status=PARCIAL/);
  await noOverflow(page);
});

test('UX-04F.1 recepción: la búsqueda de paciente se aplica como un solo control y su paginación no se confunde con la de cargos', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page, 'RECEPTIONIST', [], { patientPages: true, chargePages: true });
  await page.goto('/finances');

  // Los pacientes se cargan dentro del desplegable; la tabla mantiene su paginación.
  const input = page.getByRole('combobox', { name: 'Paciente', exact: true });
  const chargeNav = page.getByRole('navigation', { name: 'Paginación de cargos' });
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await input.fill('paciente');
  await expect(page.getByRole('option', { name: /Ana Pérez/ })).toBeVisible();
  await expect(chargeNav).toBeVisible();
  await expect(chargeNav).toContainText('Página 1 de 4');

  // La búsqueda de pacientes es un control aparte: avanzar no toca la tabla.
  await page.getByRole('button', { name: 'Cargar más pacientes' }).click();
  await expect(page.getByRole('option', { name: /Luis Gómez/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Ana Pérez/ })).toBeVisible();
  await expect(chargeNav).toContainText('Página 1 de 4');
  await expect(page).not.toHaveURL(/page=/);

  // Seleccionar al paciente deja una confirmación explícita y avisa que falta aplicar.
  await page.getByRole('option', { name: /Luis Gómez/ }).click();
  const selected = page.getByLabel('Paciente seleccionado');
  await expect(selected).toContainText('Gómez, Luis · Paciente #11');
  await expect(page.getByText(/Filtros sin aplicar/)).toBeVisible();
  // Aún no se ha aplicado: la tabla sigue con los filtros vigentes (sin patientId en la URL).
  await expect(page).not.toHaveURL(/patientId=/);

  await page.getByRole('form', { name: 'Filtrar cargos' }).getByRole('button', { name: 'Aplicar filtros' }).first().click();
  await expect(page).toHaveURL(/[?&]patientId=11/);
  await expect(page.getByText(/Filtros sin aplicar/)).toHaveCount(0);

  // Quitar la selección vuelve a mostrar la búsqueda y deja el borrador sin aplicar.
  await page.getByRole('button', { name: 'Quitar selección' }).click();
  await expect(page.getByLabel('Paciente seleccionado')).toHaveCount(0);
  await expect(page.getByText(/Filtros sin aplicar/)).toBeVisible();
  await noOverflow(page);
});

test('UX-04F.1 recepción: la revisión no permite confirmar sin concepto válido y no envía nada', async ({ page }) => {
  const writes: Write[] = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page, 'RECEPTIONIST', writes);
  await page.goto('/finances/new');
  await selectReceptionPatient(page);
  await page.getByRole('button', { name: 'Continuar a conceptos' }).click();
  await page.getByLabel('Descripción del concepto 1').fill('Consulta de valoración');
  await page.getByLabel('Cantidad del concepto 1').fill('1');
  await page.getByLabel('Precio unitario del concepto 1 (MXN)').fill('0');
  await page.getByRole('button', { name: 'Revisar cargo' }).click();
  // Sigue en la etapa de conceptos, con error y sin POST.
  await expect(page.getByRole('region', { name: 'Revisión antes de confirmar' })).toHaveCount(0);
  await expect(page.getByText('El total debe ser positivo y estar dentro del importe admitido.')).toBeVisible();
  expect(writes).toHaveLength(0);
});

test('UX-04F propietario: la presentación de Finanzas no cambia fuera de Recepción', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page, 'OWNER');
  await page.goto('/finances');
  await expect(page.getByRole('link', { name: 'Cargo #101' })).toBeVisible();
  await expect(page.locator('.reception-finances-chip')).toHaveCount(0);
  await expect(page.locator('.reception-finances-chip-marker')).toHaveCount(0);
  await expect(page.locator('td.reception-finances-amount')).toHaveCount(0);

  await page.goto('/finances/new');
  await expect(page.getByRole('heading', { name: 'Crear cargo manual', exact: true }).first()).toBeVisible();
  await expect(page.locator('.reception-finances-steps')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Revisión antes de confirmar' })).toHaveCount(0);

  await page.goto('/finances/reports');
  await expect(page.getByRole('heading', { name: 'Reportes financieros' })).toBeVisible();
  await expect(page.locator('.reception-finances-report-figure')).toHaveCount(0);
});

test('UX-04F recepción: alta guiada en tres etapas, sin cambiar el contrato del cargo ni la idempotencia', async ({ page }) => {
  const writes: Write[] = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page, 'RECEPTIONIST', writes);
  await page.goto('/finances/new');

  const steps = page.getByRole('list', { name: 'Pasos para crear el cargo manual' });
  await expect(steps).toBeVisible();
  await expect(steps.locator('li')).toHaveCount(3);
  await expect(steps.locator('[aria-current="step"]')).toContainText('Paciente');

  // Etapa 1: los conceptos y la confirmación todavía no existen en el DOM.
  await expect(page.getByRole('heading', { name: 'Seleccionar paciente', exact: true })).toBeVisible();
  await expect(page.getByLabel('Descripción del concepto 1')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirmar cargo manual' })).toHaveCount(0);

  // No se avanza sin un paciente verificado por la API.
  await expect(page.getByRole('button', { name: 'Continuar a conceptos' })).toBeDisabled();
  await expect(page.getByLabel('Descripción del concepto 1')).toHaveCount(0);
  await expect(steps.locator('[aria-current="step"]')).toContainText('Paciente');

  await selectReceptionPatient(page);
  await expect(page.getByText('Verificando paciente seleccionado…')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continuar a conceptos' }).click();
  await expect(steps.locator('[aria-current="step"]')).toContainText('Conceptos');
  await expect(page.getByRole('region', { name: 'Contexto del paciente' })).toContainText('Pérez, Ana');

  await page.getByLabel('Descripción del concepto 1').fill('Consulta de valoración');
  await page.getByLabel('Cantidad del concepto 1').fill('1');
  await page.getByLabel('Precio unitario del concepto 1 (MXN)').fill('650');
  await expect(page.getByText('Total de vista previa: $650.00 MXN')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar cargo manual' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Revisar cargo' }).click();
  await expect(steps.locator('[aria-current="step"]')).toContainText('Revisión y confirmación');

  const review = page.getByRole('region', { name: 'Revisión antes de confirmar' });
  await expect(review).toContainText('Pérez, Ana');
  await expect(review).toContainText('Consulta de valoración');
  await expect(review).toContainText('Total de vista previa: $650.00 MXN');

  // Volver conserva los datos capturados y oculta de nuevo la confirmación.
  await page.getByRole('button', { name: 'Volver a conceptos' }).click();
  await expect(page.getByLabel('Descripción del concepto 1')).toHaveValue('Consulta de valoración');
  await expect(page.getByRole('button', { name: 'Confirmar cargo manual' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Revisar cargo' }).click();

  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Confirmar cargo manual' }).click();
  await expect(page.getByRole('heading', { name: 'Cargo #105' })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]!.path).toBe('/api/financial-intents');
  expect(writes[0]!.key).toBeTruthy();
  expect(JSON.parse(writes[0]!.body!).command).toEqual({
    patientId: 10, appointmentId: null,
    items: [{ description: 'Consulta de valoración', quantity: 1, unitPrice: 650 }],
    notes: null,
  });
  await noOverflow(page);
});

test('UX-04F.1 recepción: un resultado ambiguo conserva la solicitud y la clave al navegar y reintentar', async ({ page }) => {
  const writes: Write[] = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page, 'RECEPTIONIST', writes, { dropFirstCharge: true });
  await page.goto('/finances/new');
  await selectReceptionPatient(page);
  await page.getByRole('button', { name: 'Continuar a conceptos' }).click();
  await page.getByLabel('Descripción del concepto 1').fill('Consulta de valoración');
  await page.getByLabel('Cantidad del concepto 1').fill('1');
  await page.getByLabel('Precio unitario del concepto 1 (MXN)').fill('650');
  await page.getByRole('button', { name: 'Revisar cargo' }).click();
  await page.getByRole('button', { name: 'Confirmar cargo manual' }).click();

  // El cliente no recibió respuesta: no inventa confirmación y ofrece reintentar el mismo envío.
  const retry = page.getByRole('button', { name: 'Consultar operación' });
  await expect(retry).toBeVisible();
  await expect(page.getByText('Resultado incierto', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cargo #105' })).toHaveCount(0);
  const firstKey = writes[0]!.key;
  expect(firstKey).toBeTruthy();

  await page.getByRole('link', { name: 'Volver a finanzas' }).click();
  await expect(page.getByRole('dialog', { name: 'Operación pendiente de verificar' })).toContainText('Recupera la solicitud en Finanzas');
  await page.getByRole('button', { name: 'Salir de esta vista' }).click();
  await page.getByRole('link', { name: 'Crear cargo manual' }).click();
  await expect(page.getByRole('region', { name: 'Revisión antes de confirmar' })).toContainText('Consulta de valoración');
  expect(writes).toHaveLength(1);
  await retry.click();
  await expect(page.getByRole('heading', { name: 'Cargo #105' })).toBeVisible();
  expect(writes).toHaveLength(1); // La recuperacion solo consulto; no registro ni ejecuto otra vez.
  expect(writes[0]!.key).toBe(firstKey);
});

test('UX-04F recepción: detalle con saldo protagonista, pago manual trazable y sin acciones de propietario', async ({ page }) => {
  const writes: Write[] = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page, 'RECEPTIONIST', writes);
  await page.goto('/finances/101');

  // Identificación humana del paciente desde `GET /api/patients`, sin inventar datos.
  await expect(page.locator('.reception-page-heading')).toContainText('Pérez, Ana · Paciente #10');
  await expect(page.getByRole('button', { name: 'Consultar estado vigente', exact: true })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Estado vigente: Pendiente', exact: true })).toBeVisible();
  const status = page.getByRole('region', { name: 'Estado financiero vigente' });
  await expect(status.locator('.reception-finances-chip')).toHaveText(/Pendiente/);
  const figures = status.locator('.reception-finances-figure');
  await expect(figures).toHaveCount(3);
  const balance = figures.last();
  await expect(balance).toContainText('Saldo pendiente');
  await expect(balance).toContainText('$300.00 MXN');
  expect(await balance.locator('.reception-finances-figure-value').evaluate((el) => getComputedStyle(el).fontFamily)).toContain(MONO);

  await page.getByLabel('Importe del pago (MXN)').fill('100');
  await page.getByRole('button', { name: 'Registrar pago', exact: true }).click();
  await expect(page.getByText('Pago registrado. El saldo mostrado procede de una nueva consulta.')).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]!.path).toBe('/api/financial-intents');
  expect(writes[0]!.key).toBeTruthy();
  expect(JSON.parse(writes[0]!.body!).command).toEqual({ chargeId: 101, amount: 100, method: 'CASH', reason: null });

  // Recepción no anula cargos ni reversa pagos: eso sigue siendo exclusivo de OWNER.
  await expect(page.getByRole('button', { name: 'Anular cargo', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Reversar pago/ })).toHaveCount(0);
  await noOverflow(page);
});

test('UX-04F recepción: reportes con cifras del servidor y período aplicado legible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  await page.goto('/finances/reports');

  await expect(page.getByRole('heading', { name: 'Reportes financieros' })).toBeVisible();
  await expect(page.getByText('$2,720.50 MXN', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.reception-finances-report-figure')).toHaveCount(4);
  expect(await page.locator('.reception-finances-report-figure .reception-kpi-value').first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain(MONO);
  await expect(page.getByRole('cell', { name: 'Anulado', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Cobros por período' }).click();
  await expect(page.getByText('$2,350.50 MXN', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Desde (fecha de movimiento)').fill('2026-10-01');
  await page.getByLabel('Hasta (incluye ese día)').fill('2026-10-18');
  await page.getByRole('button', { name: 'Aplicar período' }).click();
  await expect(page.locator('.reception-finances-period')).toContainText('Período aplicado:');
  await expect(page.getByRole('region', { name: 'Cobros por método' })).toBeVisible();

  await page.getByRole('tab', { name: 'Cargos y saldos' }).click();
  await expect(page.getByRole('region', { name: 'Saldos por paciente' })).toBeVisible();
  await expect(page.locator('.reception-finances-report-figure')).toHaveCount(4);
  await noOverflow(page);
});

test('UX-04F.2 recepción: móvil 390 sin desbordes y con progreso compacto de tres etapas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);

  await page.goto('/finances');
  await expect(page.getByRole('link', { name: 'Cargo #101' })).toBeVisible();
  await noOverflow(page);

  await page.goto('/finances/new');
  const steps = page.locator('.reception-finances-steps');
  await expect(steps).toBeVisible();
  expect((await steps.evaluate((el) => getComputedStyle(el).gridTemplateColumns)).split(' ')).toHaveLength(3);
  await noOverflow(page);

  await page.goto('/finances/102');
  await expect(page.getByRole('heading', { name: 'Cargo #102' })).toBeVisible();
  await noOverflow(page);

  await page.goto('/finances/reports');
  await expect(page.getByRole('heading', { name: 'Reportes financieros' })).toBeVisible();
  await noOverflow(page);
});

test('UX-04F recepción: sin datos financieros persistidos en el navegador ni en la URL', async ({ page }) => {
  await fixture(page);
  await page.goto('/finances');
  await expect(page.getByRole('link', { name: 'Cargo #101' })).toBeVisible();
  await page.goto('/finances/102');
  await expect(page.getByRole('heading', { name: 'Cargo #102' })).toBeVisible();

  const dump = await page.evaluate(() => JSON.stringify({
    local: { ...localStorage }, session: { ...sessionStorage }, href: location.href,
  }));
  expect(dump).not.toMatch(/1250\.50|850\.50|2720\.50|Cargo #102/);
  expect(new URL(page.url()).searchParams.toString()).toBe('');
  // La aplicación no usa IndexedDB; se comprueba que tampoco aparezca tras navegar.
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name))).toEqual([]);
});

test('UX-04F.2 teclado: campo único, flechas, Enter, Escape, Tab y cambio sin aplicar automáticamente', async ({ page }) => {
  await fixture(page);
  await page.goto('/finances');
  const input = page.getByRole('combobox', { name: 'Paciente', exact: true });
  await input.fill('Ana');
  await expect(page.getByRole('listbox', { name: 'Resultados de pacientes' })).toBeVisible();
  await input.press('ArrowDown');
  const active = await input.getAttribute('aria-activedescendant');
  expect(active).toBeTruthy();
  await expect(page.locator(`[id="${active}"]`)).toHaveClass(/is-active/);
  await input.press('Enter');
  await expect(input).toHaveValue('Ana Pérez');
  await expect(input).toBeFocused();
  await expect(page).not.toHaveURL(/patientId=/);
  await input.click();
  await input.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await input.click();
  await input.press('Tab'); // Acción de limpiar dentro del control.
  await page.keyboard.press('Tab'); // Sale del control sin capturar el foco.
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Quitar selección' }).click();
  await input.fill('Luis');
  await page.getByRole('option', { name: /Luis Gómez/ }).click();
  await expect(input).toHaveValue('Luis Gómez');
  await expect(page).not.toHaveURL(/patientId=/);
});

test('UX-04F.2 no permite avanzar con paciente rechazado por la API y no hace POST', async ({ page }) => {
  const writes: Write[] = [];
  await fixture(page, 'RECEPTIONIST', writes);
  await page.route('**/api/patients/10', (route) => route.fulfill({ status: 403, json: { message: 'Paciente no autorizado' } }));
  await page.goto('/finances/new');
  await page.getByRole('combobox', { name: 'Paciente (obligatorio)', exact: true }).fill('Ana');
  await page.getByRole('option', { name: /Ana Pérez/ }).click();
  await expect(page.getByText('No se pudo verificar el paciente seleccionado.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar a conceptos' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Confirmar cargo manual' })).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test('UX-04F.2 reportes: selección explícita, período inclusivo y Atrás/Adelante', async ({ page }) => {
  await fixture(page);
  await page.goto('/finances/reports?tab=cargos');
  const input = page.getByRole('combobox', { name: 'Paciente', exact: true });
  await input.fill('Ana');
  await page.getByRole('option', { name: /Ana Pérez/ }).click();
  await page.getByLabel('Estado del cargo').selectOption('PARCIAL');
  await page.getByLabel('Desde (fecha de confirmación)').fill('2026-10-01');
  await page.getByLabel('Hasta (incluye ese día)').fill('2026-10-18');
  await expect(page).not.toHaveURL(/patientId=/);
  await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).click();
  await expect(page).toHaveURL(/patientId=10/);
  await expect(page.locator('.reception-finances-period')).toContainText('01/10/2026 — 18/10/2026');
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await expect(input).toHaveValue('');
  await page.goBack();
  await expect(input).toHaveValue('Ana Pérez');
  await expect(page.getByLabel('Estado del cargo')).toHaveValue('PARCIAL');
  await page.goForward();
  await expect(input).toHaveValue('');
});

for (const route of ['/finances', '/finances/new', '/finances/reports?tab=cargos']) {
  test(`UX-04F.3 listado inicial, filtrar, borrar e invalidar selección: ${route}`, async ({ page }) => {
    const writes: Write[] = [];
    const financialReads: string[] = [];
    const patientReads: URL[] = [];
    await fixture(page, 'RECEPTIONIST', writes);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && (url.pathname === '/api/charges' || url.pathname === '/api/financial/reports/charges')) financialReads.push(url.href);
      if (request.method() === 'GET' && url.pathname === '/api/patients') patientReads.push(url);
    });
    await page.goto(route);
    const wizard = route === '/finances/new';
    const input = page.getByRole('combobox', { name: wizard ? 'Paciente (obligatorio)' : 'Paciente', exact: true });
    if (!wizard) await expect(page.getByRole('region', { name: route.includes('reports') ? 'Saldos por paciente' : 'Tabla de cargos autorizados' })).toBeVisible();
    const initialReads = financialReads.length;
    await input.click();
    await expect(page.getByRole('option', { name: /Ana Pérez.*Paciente #10/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Luis Gómez.*Paciente #11/ })).toBeVisible();
    await expect(input).toHaveValue('');
    await expect(input).not.toHaveAttribute('aria-activedescendant');
    await expect(page.getByLabel('Paciente seleccionado')).toHaveCount(0);
    expect(patientReads[0]!.searchParams.has('search')).toBe(false);
    expect(patientReads[0]!.searchParams.get('size')).toBe('10');
    await input.fill('luis@ejemplo.test');
    await expect(page.getByRole('listbox', { name: 'Resultados de pacientes' }).getByRole('option')).toHaveCount(1);
    await expect(page.getByRole('option', { name: /Luis Gómez/ })).toBeVisible();
    await input.fill('');
    await expect(page.getByRole('option', { name: /Ana Pérez/ })).toBeVisible();
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.getByRole('option', { name: /Luis Gómez/ }).click();
    await expect(input).toHaveValue('Luis Gómez');
    await expect(page.getByLabel('Paciente seleccionado')).toContainText('Paciente #11');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    expect(financialReads).toHaveLength(initialReads);
    // Enfocar no borra identidad; editar sí, aunque el nombre introducido sea válido.
    await input.click();
    await expect(input).toHaveValue('Luis Gómez');
    await input.fill('Ana');
    await expect(page.getByLabel('Paciente seleccionado')).toHaveCount(0);
    if (wizard) await expect(page.getByRole('button', { name: 'Continuar a conceptos' })).toBeDisabled();
    expect(financialReads).toHaveLength(initialReads);
    await page.getByRole('option', { name: /Ana Pérez.*Paciente #10/ }).click();
    await expect(input).toHaveValue('Ana Pérez');
    await expect(page.getByLabel('Paciente seleccionado')).toContainText('Paciente #10');
    if (wizard) {
      await page.getByRole('button', { name: 'Continuar a conceptos' }).click();
      await expect(page.getByRole('region', { name: 'Contexto del paciente' })).toContainText('Paciente #10');
      expect(writes).toHaveLength(0);
    } else {
      expect(financialReads).toHaveLength(initialReads);
      await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).first().click();
      await expect(page).toHaveURL(/patientId=10/);
      await expect.poll(() => financialReads.at(-1)).toContain('patientId=10');
      const appliedReads = financialReads.length;
      await input.fill('sin-resultados');
      await expect(page.getByText(/No hay pacientes que coincidan/)).toBeVisible();
      await expect(page.getByLabel('Paciente seleccionado')).toHaveCount(0);
      // El ID sale del borrador al editar, pero no de la consulta vigente hasta aplicar.
      await expect(page).toHaveURL(/patientId=10/);
      expect(financialReads).toHaveLength(appliedReads);
      await input.press('Escape'); // Cierra la capa antes de activar controles situados debajo.
      await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).first().click();
      await expect(page).not.toHaveURL(/patientId=/);
      await expect.poll(() => new URL(financialReads.at(-1)!).searchParams.has('patientId')).toBe(false);
    }
    await noOverflow(page);
  });
}

test('UX-04F.3 general paginado, homónimos, teclado y cero selección automática', async ({ page }) => {
  await fixture(page, 'RECEPTIONIST', [], { patientPages: true });
  const homonym = { ...PATIENT, id: 11, phone: '555-0202' };
  await page.route('**/api/patients/11', (route) => route.fulfill({ json: homonym }));
  await page.route((url) => url.pathname === '/api/patients', (route) => {
    const pageIndex = Number(new URL(route.request().url()).searchParams.get('page') ?? 0);
    return route.fulfill({ json: { content: pageIndex ? [homonym] : [PATIENT], page: pageIndex, size: 10, totalElements: 11, totalPages: 2 } });
  });
  await page.goto('/finances');
  const input = page.getByRole('combobox', { name: 'Paciente', exact: true });
  await input.click();
  await expect(page.getByRole('option', { name: /Ana Pérez.*Paciente #10/ })).toBeVisible();
  await input.press('Enter');
  await expect(page.getByLabel('Paciente seleccionado')).toHaveCount(0);
  await input.press('Tab');
  await expect(page.getByRole('button', { name: 'Cargar más pacientes' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('option', { name: /Ana Pérez.*Paciente #11.*555-0202/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Ana Pérez.*Paciente #10.*555-0101/ })).toBeVisible();
  await expect(input).toBeFocused();
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveValue('Ana Pérez');
  await expect(page.getByLabel('Paciente seleccionado')).toContainText('Paciente #11');
  await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).first().click();
  await expect(page).toHaveURL(/patientId=11/);
});
