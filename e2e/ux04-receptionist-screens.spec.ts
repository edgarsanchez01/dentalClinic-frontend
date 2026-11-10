import { expect, test, type Page } from '@playwright/test';

/**
 * UX-04 RECEPCIONISTA — capturas de validación de las pantallas rediseñadas
 * (notificaciones, horarios, pacientes, finanzas, reportes, servicios, cargos y
 * contraseña). Todas las APIs quedan interceptadas; no se crean citas ni cargos.
 */
const NOW = '2026-10-18T12:00:00Z';
const empty = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
const service = { id: 1, name: 'Limpieza dental', description: 'Profilaxis y revisión.', referencePrice: 75.1234, durationMinutes: 35, active: true, createdAt: NOW, updatedAt: null };

async function fixture(page: Page) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    let body: unknown;
    switch (url.pathname) {
      case '/api/auth/refresh': body = { accessToken: 'ux04-validation' }; break;
      case '/api/auth/me': body = { id: 1, role: 'RECEPTIONIST', email: 'recepcion@clinica.test', active: true, createdAt: NOW }; break;
      case '/api/onboarding/status': body = { status: 'COMPLETED', clinicConfigured: true }; break;
      case '/api/clinic': body = { name: 'Clínica Dental de prueba', timezone: 'America/Mexico_City' }; break;
      case '/api/availability/policy': body = { timezone: 'America/Mexico_City', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 }; break;
      case '/api/public/schedule':
      case '/api/schedules/clinic':
        body = { timezone: 'America/Mexico_City', days: [
          { dayOfWeek: 1, open: true, startTime: '09:00:00', endTime: '18:00:00', breaks: [{ startTime: '14:00:00', endTime: '15:00:00' }] },
          { dayOfWeek: 2, open: true, startTime: '09:00:00', endTime: '18:00:00', breaks: [] },
          { dayOfWeek: 3, open: true, startTime: '09:00:00', endTime: '18:00:00', breaks: [] },
          { dayOfWeek: 4, open: true, startTime: '09:00:00', endTime: '18:00:00', breaks: [] },
          { dayOfWeek: 5, open: true, startTime: '09:00:00', endTime: '15:00:00', breaks: [] },
          { dayOfWeek: 6, open: false, startTime: null, endTime: null, breaks: [] },
          { dayOfWeek: 7, open: false, startTime: null, endTime: null, breaks: [] },
        ], exceptions: [], dentists: [{ dentistId: 7, firstName: 'Ana', lastName: 'Uno', days: [] }, { dentistId: 8, firstName: 'Luis', lastName: 'Dos', days: [] }] };
        break;
      case '/api/schedules/clinic/exceptions': body = [{ date: '2026-11-02', closed: true, startTime: null, endTime: null, reason: 'Festivo' }]; break;
      case '/api/schedules/dentist/7':
        body = { dentistId: 7, timezone: 'America/Mexico_City', days: [
          { dayOfWeek: 1, open: true, startTime: '09:00:00', endTime: '14:00:00', breaks: [] },
          { dayOfWeek: 2, open: true, startTime: '09:00:00', endTime: '14:00:00', breaks: [] },
          { dayOfWeek: 3, open: false, startTime: null, endTime: null, breaks: [] },
          { dayOfWeek: 4, open: true, startTime: '15:00:00', endTime: '19:00:00', breaks: [] },
          { dayOfWeek: 5, open: false, startTime: null, endTime: null, breaks: [] },
          { dayOfWeek: 6, open: false, startTime: null, endTime: null, breaks: [] },
          { dayOfWeek: 7, open: false, startTime: null, endTime: null, breaks: [] },
        ] };
        break;
      case '/api/schedules/dentist/7/exceptions': body = []; break;
      case '/api/schedules/dentist/7/time-off': body = [{ id: 40, startDate: '2026-10-20', endDate: '2026-10-21', allDay: true, startTime: null, endTime: null, reason: 'Congreso' }]; break;
      case '/api/services': body = [service]; break;
      case '/api/public/services': body = [service]; break;
      case '/api/patients':
        body = { content: [
          { id: 1, firstName: 'Ana', lastName: 'Pérez', email: 'ana@ejemplo.test', phone: '555-0101', active: true },
          { id: 2, firstName: 'Luis', lastName: 'Gómez', email: null, phone: null, active: false },
        ], page: 0, size: 20, totalElements: 21, totalPages: 2 };
        break;
      case '/api/notifications':
        body = { content: [
          { id: 1, title: 'Recordatorio de cita', body: 'Ana Pérez tiene cita mañana a las 09:00.', priority: 'HIGH', read: false, createdAt: NOW },
          { id: 2, title: 'Cargo confirmado', body: 'El cargo #10 quedó confirmado.', priority: 'NORMAL', read: true, createdAt: NOW },
        ], page: 0, size: 20, totalElements: 2, totalPages: 1 };
        break;
      case '/api/notifications/unread-count': body = { unread: 1 }; break;
      case '/api/feedback': body = { ...empty, count: 0, average: null }; break;
      case '/api/users': body = []; break;
      case '/api/charges':
        body = { content: [
          { id: 99, patientId: 10, appointmentId: null, totalAmount: '300.00', appliedAmount: '140.00', pendingBalance: '160.00', status: 'PARCIAL', confirmedAt: NOW },
        ], page: 0, size: 20, totalElements: 1, totalPages: 1 };
        break;
      case '/api/charges/99':
        body = { id: 99, patientId: 10, appointmentId: null, totalAmount: '300.00', appliedAmount: '140.00', pendingBalance: '160.00', status: 'PARCIAL', confirmedAt: NOW, confirmedByUserId: 1, notes: null, cancelledAt: null, cancelledByUserId: null, cancellationReason: null,
          items: [{ id: 1, description: 'Limpieza dental', quantity: 1, unitPrice: '300.00', lineTotal: '300.00' }],
          movements: [{ id: 5, type: 'PAYMENT', amount: '140.00', paymentMethod: 'CASH', performedAt: NOW, performedByUserId: 1, reversesMovementId: null, reason: null }] };
        break;
      case '/api/financial/reports/portfolio': body = { asOf: NOW, confirmedCharges: 208, billedAmount: '9999.00', appliedAmount: '2000.00', pendingBalance: '7999.00', statusCounts: { pendiente: 107, parcial: 100, pagado: 1, anulado: 0 } }; break;
      case '/api/financial/reports/cash-flow': body = { from: null, to: null, grossAmount: '2500.50', reversalAmount: '0.00', netAmount: '2500.50', methods: [{ method: 'CASH', grossAmount: '2500.50', reversalAmount: '0.00', netAmount: '2500.50' }] }; break;
      case '/api/financial/reports/charges': body = { asOf: NOW, billedAmount: '300.00', appliedAmount: '140.00', pendingBalance: '160.00', confirmedCharges: 1, byPatient: [{ patientId: 10, chargeCount: 1, billedAmount: '300.00', appliedAmount: '140.00', pendingBalance: '160.00' }] }; break;
      case '/api/appointments': body = { ...empty, content: [{ id: 7, patientId: 1, patientFirstName: 'Ana', patientLastName: 'Pérez', dentistId: 7, dentistFirstName: 'Ana', dentistLastName: 'Uno', startAt: '2026-10-18T16:00:00Z', endAt: '2026-10-18T16:30:00Z', durationMinutes: 30, service, status: 'SCHEDULED', occurrenceVersion: 1, createdByUserId: 1, createdAt: NOW }], totalElements: 1, totalPages: 1 }; break;
      case '/api/availability': body = { dentistId: Number(url.searchParams.get('dentistId')), durationMinutes: 30, timezone: 'America/Mexico_City', slots: [] }; break;
      case '/api/feedback/reviews': body = { ...empty, count: 0, average: null }; break;
      default: await route.fulfill({ status: method === 'GET' ? 404 : 200, json: {} }); return;
    }
    await route.fulfill({ status: 200, json: body });
  });
}

const dir = '/tmp/opencode/ux04/evidence';

const SCREENS: Array<{ name: string; path: string; heading: string }> = [
  { name: 'pacientes', path: '/patients', heading: 'Pacientes' },
  { name: 'pacientes-vacio', path: '/patients?q=vacio', heading: 'Pacientes' },
  { name: 'finanzas', path: '/finances', heading: 'Finanzas' },
  { name: 'cargo-nuevo', path: '/finances/new', heading: 'Crear cargo manual' },
  { name: 'cargo-detalle', path: '/finances/99', heading: 'Cargo #99' },
  { name: 'reportes', path: '/finances/reports', heading: 'Reportes financieros' },
  { name: 'notificaciones', path: '/notifications', heading: 'Notificaciones' },
  { name: 'servicios', path: '/services', heading: 'Servicios dentales' },
  { name: 'horarios', path: '/scheduling', heading: 'Horarios' },
  { name: 'contrasena', path: '/change-password', heading: 'Cambiar contraseña' },
];

test('UX-04 recepción: capturas de todas las pantallas rediseñadas (escritorio y móvil)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  for (const screen of SCREENS) {
    await page.goto(screen.path);
    await expect(page.getByRole('heading', { name: screen.heading, exact: true }).first()).toBeVisible();
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${dir}/ux04-recepcion-${screen.name}-1440.png`, fullPage: true });
    const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(desktopOverflow, `${screen.path} desborda a 1440px`).toBe(false);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(80);
    await page.screenshot({ path: `${dir}/ux04-recepcion-${screen.name}-390.png`, fullPage: true });
    const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(mobileOverflow, `${screen.path} desborda a 390px`).toBe(false);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
});
