import { expect, test, type Page } from '@playwright/test';

type Role = 'OWNER' | 'RECEPTIONIST' | 'DENTIST' | 'PATIENT';
const APPOINTMENT = { id: 7, patientId: 1, patientUserId: 10, patientFirstName: 'Ana', patientLastName: 'Pérez',
  dentistId: 3, dentistFirstName: 'Olivia', dentistLastName: 'Profesional', startAt: '2026-10-13T16:00:00Z',
  endAt: '2026-10-13T17:00:00Z', durationMinutes: 60, status: 'SCHEDULED', occurrenceVersion: 1,
  createdByUserId: 10, createdAt: '2026-10-12T12:00:00Z' };
const NOTE = { id: 1, content: 'Nota original de prueba', authorDentistId: 3, authorName: 'Olivia Profesional', createdAt: '2026-10-13T16:00:00Z' };
const TREATMENT = { id: 9, patientId: 1, description: 'Tratamiento de prueba', diagnosis: 'Descripción de prueba', status: 'IN_PROGRESS',
  appointmentId: 7, toothFdis: [], createdAt: '2026-10-13T15:00:00Z' };
const DAYS = [1, 2, 3, 4, 5, 6, 7].map(dayOfWeek => ({ dayOfWeek, open: true, startTime: '08:00:00', endTime: '18:00:00', breaks: [] }));
const PAGE = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };

async function fixture(page: Page, role: Role = 'OWNER') {
  const calls: { path: string; method: string }[] = [];
  let authenticated = true;
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    calls.push({ path, method: request.method() });
    let body: unknown;
    if (path === '/api/auth/refresh') {
      await route.fulfill({ status: authenticated ? 200 : 401, json: { accessToken: 'navigation-safe-test' } }); return;
    }
    if (path === '/api/auth/logout') {
      authenticated = false;
      await route.fulfill({ status: 204 }); return;
    }
    if (path === '/api/auth/me') body = { id: 10, role, dentistId: 3, patientId: 1, email: 'actor@dc.test', active: true, createdAt: '2026-01-01T00:00:00Z',
      ...(role === 'PATIENT' ? { medicalOnboarding: { requirement: 'EXEMPT_EXISTING', progress: 'NOT_STARTED', pending: false } } : {}) };
    else if (path === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (path === '/api/notifications/unread-count') body = { unread: 0 };
    else if (path === '/api/notifications') body = { ...PAGE, totalElements: 1, totalPages: 1, content: [{ id: 1,
      title: 'Aviso privado sintético logout', body: 'Visible solo con sesión', priority: 'NORMAL', read: true, createdAt: '2026-10-13T12:00:00Z' }] };
    else if (path === '/api/public/schedule') body = { timezone: 'America/Mexico_City', days: DAYS, exceptions: [], dentists: [{ dentistId: 3, firstName: 'Olivia', lastName: 'Profesional', days: DAYS }] };
    else if (path === '/api/schedules/clinic') body = { timezone: 'America/Mexico_City', days: DAYS };
    else if (path === '/api/services' || path === '/api/public/services') body = [];
    else if (path === '/api/appointments') body = { ...PAGE, content: [APPOINTMENT], totalElements: 1, totalPages: 1 };
    else if (path === '/api/appointments/7') body = APPOINTMENT;
    else if (path === '/api/appointments/7/events') body = [];
    else if (path === '/api/patients') body = PAGE;
    else if (path === '/api/patients/1') body = { id: 1, firstName: 'Ana', lastName: 'Pérez', active: true };
    else if (path === '/api/patients/1/clinical') body = { patientId: 1 };
    else if (path === '/api/patients/1/clinical/notes') body = [NOTE];
    else if (path === '/api/patients/1/clinical/treatments') body = [TREATMENT];
    else if (path.endsWith('/evolution')) body = [];
    else if (path.endsWith('/trace')) {
      const section = url.searchParams.get('section');
      body = { context: { appointmentId: 7, occurrenceVersion: 1, currentOccurrenceVersion: 1, currentStatus: 'SCHEDULED',
        kind: 'CURRENT_UNFROZEN', timezone: 'America/Mexico_City' }, availableSections: ['NOTES', 'EVOLUTIONS'], section, results: PAGE };
    } else if (path.endsWith('/odontogram')) body = [];
    else if (path === '/api/financial/reports/cash-flow') body = { grossAmount: 12, reversalAmount: 0, netAmount: 12, methods: [] };
    else if (path === '/api/financial/reports/portfolio') body = { asOf: '2026-10-01T00:00:00Z', confirmedCharges: 0, billedAmount: 0, appliedAmount: 0,
      pendingBalance: 0, statusCounts: { pendiente: 0, parcial: 0, pagado: 0, anulado: 0 } };
    else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/actuator/**', route => route.fulfill({ status: 200, json: { status: 'UP' } }));
  return calls;
}

for (const role of ['OWNER', 'DENTIST', 'RECEPTIONIST', 'PATIENT'] as const) {
  test(`logout ${role} → landing; Atrás/Adelante y recarga no recuperan información privada`, async ({ page }) => {
    const calls = await fixture(page, role);
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: 'Aviso privado sintético logout' })).toBeVisible();
    await page.getByRole('banner').getByText('Cuenta', { exact: true }).click();
    await page.getByRole('banner').getByRole('link', { name: 'Cambiar contraseña', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Cambiar contraseña', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Tu sonrisa,.*nuestra prioridad/ })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    expect(calls.filter(call => call.path === '/api/auth/logout')).toHaveLength(1);
    const afterLogout = calls.length;
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Iniciar sesión', exact: true })).toBeVisible();
    await expect(page.getByText('Aviso privado sintético logout', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Visible solo con sesión', { exact: true })).toHaveCount(0);
    expect(calls.slice(afterLogout).filter(call => call.path.startsWith('/api/notifications'))).toHaveLength(0);
    await page.goForward();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: /Tu sonrisa,.*nuestra prioridad/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: /Tu sonrisa,.*nuestra prioridad/ })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toHaveCount(0);
  });
}

test('logout lento muestra la landing mientras se confirma el cierre, sin login intermedio', async ({ page }) => {
  await fixture(page);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/auth/logout', async route => { await pending; await route.fallback(); });
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Aviso privado sintético logout' })).toBeVisible();
  const logout = page.waitForResponse(response => response.url().endsWith('/api/auth/logout'));
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Tu sonrisa,.*nuestra prioridad/ })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Iniciar sesión', exact: true })).toHaveCount(0);
  finish(); expect((await logout).status()).toBe(204);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Aviso privado sintético logout', { exact: true })).toHaveCount(0);
});

for (const role of ['OWNER', 'RECEPTIONIST', 'DENTIST', 'PATIENT'] as const) {
  for (const width of [390, 1280]) {
    test(`9A.1 matriz ${role} a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      const calls = await fixture(page, role);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: role === 'OWNER' ? 'Resumen de la clínica' : role === 'RECEPTIONIST' ? 'Recepción' : role === 'DENTIST' ? 'Mi jornada clínica' : 'Tu atención dental', exact: true })).toBeVisible();
      const mobile = width < 768;
      if (mobile) await page.getByRole('button', { name: 'Más', exact: true }).click();
      const nav = page.getByRole('navigation', { name: mobile ? 'Navegación móvil' : 'Navegación de escritorio', exact: true });
      await expect(nav.getByRole('link', { name: 'Equipo', exact: true })).toHaveCount(role === 'OWNER' ? 1 : 0);
      await expect(nav.getByRole('link', { name: 'Clínica', exact: true })).toHaveCount(role === 'OWNER' ? 1 : 0);
      await expect(nav.getByRole('link', { name: 'Reportes financieros', exact: true })).toHaveCount(role === 'OWNER' || role === 'RECEPTIONIST' ? 1 : 0);
      await expect(nav.getByRole('link', { name: 'Finanzas', exact: true })).toHaveCount(role === 'PATIENT' ? 0 : 1);
      await expect(nav.getByRole('link', { name: 'Reseñas', exact: true })).toHaveCount(role === 'OWNER' || role === 'DENTIST' ? 1 : 0);
      expect(calls.some(call => call.path.includes('/clinical'))).toBe(false);
      if (role !== 'OWNER') expect(calls.some(call => call.path === '/api/users' || call.path === '/api/clinic')).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (mobile) await page.getByRole('button', { name: 'Cerrar menú', exact: true }).click();
      await page.getByRole('banner').getByText('Cuenta', { exact: true }).click();
      await expect(page.getByRole('banner').getByRole('link', { name: 'Cambiar contraseña' })).toBeVisible();
      const account = await page.getByRole('banner').getByRole('link', { name: 'Cambiar contraseña' }).boundingBox();
      expect(account!.x).toBeGreaterThanOrEqual(0);
      expect(account!.x + account!.width).toBeLessThanOrEqual(width);
      if (role === 'OWNER') await page.screenshot({ path: test.info().outputPath(`navigation-${width}.png`), fullPage: true });
    });
  }
}

test('9A.1 drawer modal y bottom nav conservan la nota al quedarse y confirman una sola vez', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await fixture(page);
  await page.goto('/appointments/7');
  const draft = page.getByLabel('Nueva nota clínica');
  await draft.fill('Borrador que permanece en memoria');
  await page.getByRole('button', { name: 'Más', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Menú de navegación', exact: true });
  await drawer.getByRole('link', { name: 'Pacientes', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Tienes cambios sin guardar', exact: true });
  await expect(drawer).toBeHidden();
  await expect(confirmation).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  const stay = confirmation.getByRole('button', { name: 'Seguir aquí' });
  await expect(stay).toBeFocused();
  // showModal debe hacer inerte la vista subyacente, no solo pintar encima.
  await draft.evaluate(element => element.focus());
  await expect(stay).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(draft).toHaveValue('Borrador que permanece en memoria');
  await page.getByRole('navigation', { name: 'Navegación rápida' }).getByRole('link', { name: 'Citas' }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Salir sin guardar' }).click();
  await expect(page).toHaveURL(/\/appointments$/);
  await expect(confirmation).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('9A.1 Back y Forward nativos no pierden notas ni fabrican entradas de historial', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await fixture(page);
  await page.goto('/appointments?view=day&date=2026-10-13');
  await page.getByRole('button', { name: /Abrir cita de Ana Pérez/ }).click();
  const draft = page.getByLabel('Nueva nota clínica');
  await draft.fill('Nota antes de Back');
  await page.goBack();
  const confirmation = page.getByRole('dialog', { name: 'Tienes cambios sin guardar' });
  await confirmation.getByRole('button', { name: 'Seguir aquí' }).click();
  await expect(page).toHaveURL(/\/appointments\/7(?:\?returnTo=.*)?$/);
  await expect(draft).toHaveValue('Nota antes de Back');
  await page.goBack();
  await confirmation.getByRole('button', { name: 'Salir sin guardar' }).click();
  await expect(page).toHaveURL(/\/appointments\?view=day&date=2026-10-13$/);
  await page.goForward();
  await expect(draft).toHaveValue('');
  await page.getByRole('link', { name: 'Abrir ficha y expediente', exact: true }).click();
  await expect(page).toHaveURL(/\/patients\/1\?/);
  await page.goBack();
  await draft.fill('Nota antes de Forward');
  await page.goForward();
  await confirmation.getByRole('button', { name: 'Seguir aquí' }).click();
  await expect(draft).toHaveValue('Nota antes de Forward');
  await page.goForward();
  await confirmation.getByRole('button', { name: 'Salir sin guardar' }).click();
  await expect(page).toHaveURL(/\/patients\/1\?/);
});

test('9A.1 corrección clínica y logout global requieren consentimiento antes de cerrar sesión', async ({ page }) => {
  const calls = await fixture(page);
  await page.goto('/patients/1');
  await page.getByRole('button', { name: 'Corregir', exact: true }).click();
  await page.getByLabel('Motivo de la corrección').fill('Motivo aún no guardado');
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Tienes cambios sin guardar' });
  await confirmation.getByRole('button', { name: 'Seguir aquí' }).click();
  expect(calls.filter(call => call.path === '/api/auth/logout')).toHaveLength(0);
  await expect(page.getByLabel('Motivo de la corrección')).toHaveValue('Motivo aún no guardado');
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Salir sin guardar' }).click();
  await expect(page.getByRole('heading', { name: /Tu sonrisa,.*nuestra prioridad/ })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(calls.filter(call => call.path === '/api/auth/logout')).toHaveLength(1);
});

test('9A.1 evolución pendiente permanece al cancelar la navegación', async ({ page }) => {
  await fixture(page, 'DENTIST');
  await page.goto('/appointments/7');
  await page.getByRole('tab', { name: 'Tratamientos', exact: true }).click();
  await page.getByRole('button', { name: 'Evolución', exact: true }).click();
  await page.getByLabel('Nueva nota de evolución').fill('Evolución en borrador');
  await page.getByRole('navigation', { name: 'Navegación de escritorio' }).getByRole('link', { name: 'Citas' }).click();
  await page.getByRole('dialog', { name: 'Tienes cambios sin guardar' }).getByRole('button', { name: 'Seguir aquí' }).click();
  await expect(page.getByLabel('Nueva nota de evolución')).toHaveValue('Evolución en borrador');
});

test('9A.1 reportes mantienen pestaña y período exactos tras recarga y una única opción activa', async ({ page }) => {
  await fixture(page, 'RECEPTIONIST');
  const target = '/finances/reports?tab=cobros&from=2026-10-01T06%3A00%3A00Z&to=2026-11-01T06%3A00%3A00Z';
  await page.goto(target);
  await expect(page.getByRole('tab', { name: 'Cobros por período' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('$12.00 MXN', { exact: true }).first()).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Navegación de escritorio' });
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(nav.getByRole('link', { name: 'Reportes financieros' })).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Cobros por período' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(new RegExp('from=2026-10-01T06%3A00%3A00Z'));
});
