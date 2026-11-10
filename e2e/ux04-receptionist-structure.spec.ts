import { expect, test, type Page } from '@playwright/test';

/**
 * UX-04 RECEPCIONISTA — comprobaciones de estructura visual (sin juicio estético
 * automático): orden de lectura, jerarquía tipográfica, ausencia de controles
 * deshabilitados en Horarios, y separación entre secciones.
 */
const NOW = '2026-10-18T12:00:00Z';
const empty = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };

async function fixture(page: Page) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    switch (url.pathname) {
      case '/api/auth/refresh': body = { accessToken: 'ux04-t' }; break;
      case '/api/auth/me': body = { id: 1, role: 'RECEPTIONIST', email: 'r@t.test', active: true, createdAt: NOW }; break;
      case '/api/onboarding/status': body = { status: 'COMPLETED', clinicConfigured: true }; break;
      case '/api/availability/policy': body = { timezone: 'America/Mexico_City', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 }; break;
      case '/api/public/schedule':
      case '/api/schedules/clinic': body = { timezone: 'America/Mexico_City', days: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, open: i < 5, startTime: i < 5 ? '09:00:00' : null, endTime: i < 5 ? '18:00:00' : null, breaks: [] })), exceptions: [], dentists: [{ dentistId: 7, firstName: 'Ana', lastName: 'Uno', days: [] }] }; break;
      case '/api/schedules/clinic/exceptions': body = []; break;
      case '/api/schedules/dentist/7': body = { dentistId: 7, timezone: 'America/Mexico_City', days: Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, open: i < 4, startTime: i < 4 ? '09:00:00' : null, endTime: i < 4 ? '14:00:00' : null, breaks: [] })) }; break;
      case '/api/schedules/dentist/7/exceptions': body = []; break;
      case '/api/schedules/dentist/7/time-off': body = []; break;
      case '/api/services': body = [{ id: 1, name: 'Limpieza dental', description: null, referencePrice: 75, durationMinutes: 35, active: true, createdAt: NOW, updatedAt: null }]; break;
      case '/api/patients': body = { content: [{ id: 1, firstName: 'Ana', lastName: 'Pérez', email: null, phone: null, active: true }], page: 0, size: 20, totalElements: 1, totalPages: 1 }; break;
      case '/api/notifications': body = empty; break;
      case '/api/notifications/unread-count': body = { unread: 0 }; break;
      case '/api/charges': body = empty; break;
      case '/api/charges/99': body = { id: 99, patientId: 10, appointmentId: null, totalAmount: '300.00', appliedAmount: '140.00', pendingBalance: '160.00', status: 'PARCIAL', confirmedAt: NOW, confirmedByUserId: 1, notes: null, cancelledAt: null, cancelledByUserId: null, cancellationReason: null, items: [{ id: 1, description: 'Limpieza dental', quantity: 1, unitPrice: '300.00', lineTotal: '300.00' }], movements: [] }; break;
      case '/api/financial/reports/portfolio': body = { asOf: NOW, confirmedCharges: 0, billedAmount: '0.00', appliedAmount: '0.00', pendingBalance: '0.00', statusCounts: { pendiente: 0, parcial: 0, pagado: 0, anulado: 0 } }; break;
      case '/api/appointments': body = empty; break;
      case '/api/availability': body = { dentistId: 7, durationMinutes: 30, timezone: 'America/Mexico_City', slots: [] }; break;
      case '/api/feedback': body = { ...empty, count: 0, average: null }; break;
      case '/api/users': body = []; break;
      default: await route.fulfill({ status: 404, json: {} }); return;
    }
    await route.fulfill({ status: 200, json: body });
  });
}

test('UX-04 Horarios: consulta sin controles deshabilitados y con composición semanal', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  await page.goto('/scheduling');
  const clinic = page.locator('section', { has: page.getByRole('heading', { name: 'Horario de la clínica', exact: true }) });
  // Ninguna casilla ni input deshabilitado como presentación principal.
  await expect(clinic.locator('input:disabled')).toHaveCount(0);
  await expect(clinic.locator('input[type="time"]')).toHaveCount(0);
  await expect(clinic.locator('input[type="checkbox"]')).toHaveCount(0);
  // La semana se lee como composición por días.
  await expect(clinic.locator('.reception-week-row')).toHaveCount(7);
  await expect(clinic.getByText('Cerrado', { exact: true }).first()).toBeVisible();
  await expect(clinic.getByRole('button', { name: /Guardar|Añadir|Eliminar/ })).toHaveCount(0);
  // El editor editable no aparece para recepción.
  await expect(page.getByRole('button', { name: 'Guardar horario', exact: true })).toHaveCount(0);
  // Política de reservas en solo lectura.
  await expect(page.getByRole('button', { name: 'Guardar política', exact: true })).toHaveCount(0);
});

test('UX-04 Citas: la agenda es protagonista y el asistente se abre bajo demanda', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  await page.goto('/appointments');
  await expect(page.getByRole('heading', { name: 'Nueva cita', exact: true })).toBeHidden();
  const cta = page.getByRole('button', { name: 'Crear cita', exact: true });
  await expect(cta).toBeVisible();
  await cta.click();
  await expect(page).toHaveURL(/create=1/);
  await expect(page.getByRole('heading', { name: 'Nueva cita', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Volver a la agenda', exact: true }).click();
  await expect(page).toHaveURL(/\/appointments$/);
  await expect(page.getByRole('heading', { name: 'Nueva cita', exact: true })).toBeHidden();
});

test('UX-04 cargos: alta y detalle usan el encabezado y tarjetas de recepción', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  // Alta de cargo manual: encabezado editorial + regreso a finanzas.
  await page.goto('/finances/new');
  await expect(page.getByRole('heading', { name: 'Crear cargo manual', exact: true }).first()).toBeVisible();
  await expect(page.locator('.reception-page').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Volver a finanzas', exact: true })).toBeVisible();
  await expect(page.locator('form.reception-section')).toHaveCount(1);
  await page.screenshot({ path: '/tmp/opencode/ux04/evidence/ux04-recepcion-cargo-nuevo-1440.png', fullPage: true });
  // Detalle del cargo: encabezado editorial con el identificador.
  await page.goto('/finances/99');
  await expect(page.getByRole('heading', { name: 'Cargo #99', exact: true }).first()).toBeVisible();
  await expect(page.locator('.reception-page').first()).toBeVisible();
  await page.screenshot({ path: '/tmp/opencode/ux04/evidence/ux04-recepcion-cargo-detalle-1440.png', fullPage: true });
});

test('UX-04 jerarquía: título de página mayor que los encabezados de sección', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  for (const [path, heading] of [['/patients', 'Pacientes'], ['/finances', 'Finanzas'], ['/finances/reports', 'Reportes financieros'], ['/notifications', 'Notificaciones']] as const) {
    await page.goto(path);
    const size = await page.getByRole('heading', { name: heading, exact: true }).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size, `${path} título`).toBeGreaterThanOrEqual(28);
    const sectionSizes = await page.evaluate(() => Array.from(document.querySelectorAll('.reception-section-heading h2, .reception-card h2')).map((el) => parseFloat(getComputedStyle(el as HTMLElement).fontSize)));
    for (const sectionSize of sectionSizes) expect(sectionSize).toBeLessThan(size);
  }
});

test('UX-04 Escritorio: contenido dentro del ancho de la ventana en todas las pantallas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  for (const path of ['/', '/appointments', '/patients', '/finances', '/finances/new', '/finances/99', '/finances/reports', '/notifications', '/services', '/scheduling', '/change-password']) {
    await page.goto(path);
    await page.waitForTimeout(80);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} desborda`).toBe(true);
  }
});
