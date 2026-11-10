import { expect, test, type Page } from '@playwright/test';

/**
 * UX-04 comprobación de tokens y proporciones del sistema editorial de recepción.
 */
const NOW = '2026-10-18T12:00:00Z';

async function fixture(page: Page) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    switch (url.pathname) {
      case '/api/auth/refresh': body = { accessToken: 'x' }; break;
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
      case '/api/notifications': body = { content: [{ id: 1, title: 'Aviso', body: 'Cuerpo', priority: 'HIGH', read: false, createdAt: NOW }], page: 0, size: 20, totalElements: 1, totalPages: 1 }; break;
      case '/api/notifications/unread-count': body = { unread: 1 }; break;
      case '/api/charges': body = { content: [{ id: 99, patientId: 10, appointmentId: null, totalAmount: '300.00', appliedAmount: '140.00', pendingBalance: '160.00', status: 'PARCIAL', confirmedAt: NOW }], page: 0, size: 20, totalElements: 1, totalPages: 1 }; break;
      case '/api/financial/reports/portfolio': body = { asOf: NOW, confirmedCharges: 1, billedAmount: '300.00', appliedAmount: '140.00', pendingBalance: '160.00', statusCounts: { pendiente: 0, parcial: 1, pagado: 0, anulado: 0 } }; break;
      case '/api/appointments': body = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }; break;
      case '/api/availability': body = { dentistId: 7, durationMinutes: 30, timezone: 'America/Mexico_City', slots: [] }; break;
      case '/api/feedback': body = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0, count: 0, average: null }; break;
      case '/api/users': body = []; break;
      default: await route.fulfill({ status: 404, json: {} }); return;
    }
    await route.fulfill({ status: 200, json: body });
  });
}

test('UX-04 tokens: petróleo #193F43 en títulos y acciones, sin desbordes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  const petrol = 'rgb(25, 63, 67)';
  for (const [path, title] of [['/patients', 'Pacientes'], ['/finances', 'Finanzas'], ['/finances/reports', 'Reportes financieros'], ['/notifications', 'Notificaciones'], ['/services', 'Servicios dentales']] as const) {
    await page.goto(path);
    const heading = page.getByRole('heading', { name: title, exact: true }).first();
    await expect(heading).toBeVisible();
    expect(await heading.evaluate((el) => getComputedStyle(el).color), `${path} título`).toBe(petrol);
    const pageEl = page.locator('.reception-page').first();
    expect(await pageEl.evaluate((el) => getComputedStyle(el).backgroundColor || 'transparent'), `${path} fondo`).not.toBe(petrol);
  }
});

test('UX-04 notificaciones: lista, no leída, fecha y paginación presentes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  await page.goto('/notifications');
  const list = page.getByRole('list', { name: 'Listado de notificaciones' });
  await expect(list).toBeVisible();
  await expect(page.getByText('No leída', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Marcar como leída', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Paginación de notificaciones' })).toBeVisible();
  await expect(page.getByText(/UTC/)).toBeVisible();
  // La tarjeta no leída se distingue por un borde interno de acento.
  const unread = page.locator('.reception-notification-unread');
  await expect(unread).toHaveCount(1);
  expect(await unread.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none');
});

test('UX-04 pacientes: fila con acceso evidente a la ficha', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  await page.goto('/patients');
  const row = page.locator('.reception-list-row').first();
  await expect(row).toBeVisible();
  await expect(row.getByText('Ver ficha', { exact: true })).toBeVisible();
  await expect(row).toHaveAttribute('href', /\/patients\//);
});

test('UX-04 finanzas: los filtros avanzados están plegados por defecto', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  await page.goto('/finances');
  const advanced = page.locator('details.reception-advanced');
  await expect(advanced).toBeVisible();
  expect(await advanced.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
  await expect(page.getByLabel('Estado del cargo')).toBeHidden();
  await advanced.locator('summary').click();
  await expect(page.getByLabel('Estado del cargo')).toBeVisible();
});
