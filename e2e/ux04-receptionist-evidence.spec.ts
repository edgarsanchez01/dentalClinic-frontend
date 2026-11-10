import { expect, test, type Page } from '@playwright/test';

/**
 * UX-04 RECEPCIONISTA — evidencias visuales y verificación del asistente de tres pasos.
 *
 * Todas las APIs quedan interceptadas (proxy sin servicios persistentes): el spec solo
 * genera capturas de escritorio/móvil y comprueba que, en un navegador real, el paso activo
 * es el único visible. No crea citas ni cargos reales.
 */
const NOW = '2026-10-18T12:00:00Z';
const empty = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
const service = { id: 1, name: 'Consulta de valoración', description: 'Revisión general y orientación.', referencePrice: 850, durationMinutes: 30, active: true, createdAt: NOW, updatedAt: null };
const week = {
  timezone: 'America/Mexico_City',
  days: Array.from({ length: 7 }, (_, index) => ({ dayOfWeek: index + 1, open: true, startTime: '09:00:00', endTime: '17:00:00', breaks: [] })),
  exceptions: [],
  dentists: [{ dentistId: 7, firstName: 'Ana', lastName: 'Uno', days: [] }, { dentistId: 8, firstName: 'Luis', lastName: 'Dos', days: [] }],
};
const appointment = {
  id: 7, patientId: 1, patientUserId: null, patientFirstName: 'Ana', patientLastName: 'Pérez',
  dentistId: 7, dentistFirstName: 'Ana', dentistLastName: 'Uno',
  startAt: '2026-10-18T16:00:00Z', endAt: '2026-10-18T16:30:00Z', durationMinutes: 30,
  service, status: 'SCHEDULED', occurrenceVersion: 1, createdByUserId: 1, createdAt: NOW,
};

async function fixture(page: Page) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    let status = 200;
    let body: unknown;
    switch (url.pathname) {
      case '/api/auth/refresh': body = { accessToken: 'ux04-reception' }; break;
      case '/api/auth/me': body = { id: 1, role: 'RECEPTIONIST', email: 'recepcion@clinica.test', active: true, createdAt: NOW }; break;
      case '/api/onboarding/status': body = { status: 'COMPLETED', clinicConfigured: true }; break;
      case '/api/clinic': body = { name: 'Clínica Dental de prueba', timezone: 'America/Mexico_City' }; break;
      case '/api/availability/policy': body = { timezone: 'America/Mexico_City', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 }; break;
      case '/api/public/schedule': body = week; break;
      case '/api/schedules/clinic': body = week; break;
      case '/api/services': body = [service]; break;
      case '/api/public/services': body = [service]; break;
      case '/api/patients': body = { content: [{ id: 1, firstName: 'Ana', lastName: 'Pérez', active: true }], totalElements: 1 }; break;
      case '/api/availability':
        body = { dentistId: Number(url.searchParams.get('dentistId')), durationMinutes: 30, timezone: 'America/Mexico_City', slots: [
          { startDate: '2026-10-20', startTime: '09:00:00', endTime: '09:30:00', start: '2026-10-20T15:00:00Z', end: '2026-10-20T15:30:00Z' },
          { startDate: '2026-10-20', startTime: '10:00:00', endTime: '10:30:00', start: '2026-10-20T16:00:00Z', end: '2026-10-20T16:30:00Z' },
        ] };
        break;
      case '/api/appointments':
        if (method === 'POST') {
          status = 201;
          body = { id: 9, ...JSON.parse(route.request().postData() ?? '{}'), service, durationMinutes: 30,
            patientFirstName: 'Ana', patientLastName: 'Pérez', dentistFirstName: 'Ana', dentistLastName: 'Uno',
            status: 'SCHEDULED', occurrenceVersion: 1, createdByUserId: 1, createdAt: NOW };
        } else body = { ...empty, content: [appointment], totalElements: 1, totalPages: 1 };
        break;
      case '/api/appointments/9/events': body = []; break;
      case '/api/financial/reports/portfolio': body = { asOf: NOW, confirmedCharges: 208, billedAmount: 9999, appliedAmount: 2000, pendingBalance: 7999, statusCounts: { pendiente: 107, parcial: 100, pagado: 1, anulado: 0 } }; break;
      case '/api/financial/reports/cash-flow': body = { from: url.searchParams.get('from'), to: url.searchParams.get('to'), grossAmount: 2500.5, reversalAmount: 3000, netAmount: -499.5, methods: [] }; break;
      case '/api/charges': body = empty; break;
      case '/api/feedback': body = { ...empty, count: 0, average: null }; break;
      case '/api/users': body = []; break;
      case '/api/notifications': body = empty; break;
      case '/api/notifications/unread-count': body = { unread: 0 }; break;
      default: await route.fulfill({ status: 404, json: {} }); return;
    }
    await route.fulfill({ status, json: body });
  });
}

const dir = '/tmp/opencode/ux04/evidence';

test('UX-04 recepción: inicio con datos reales del contrato, escritorio y móvil', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await fixture(page);
  await page.goto('/');
  const cartera = page.getByRole('region', { name: 'Cartera pendiente' });
  await expect(cartera.getByText('$7,999.00 MXN', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${dir}/ux04-recepcion-inicio-1440.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.setViewportSize({ width: 390, height: 960 });
  await page.screenshot({ path: `${dir}/ux04-recepcion-inicio-390.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

/** Recorre el asistente completo y comprueba que solo se ve el paso activo. */
async function walkStepper(page: Page, width: number) {
  await page.goto('/appointments?create=1');
  const booking = page.locator('.reception-booking');
  const steps = booking.locator('.reception-step');
  await expect(page.getByRole('heading', { name: 'Nueva cita', exact: true })).toBeVisible();

  // Paso 1: solo paciente y servicio; dentista y revisión ocultos.
  await expect(steps.nth(0)).toBeVisible();
  await expect(steps.nth(1)).toBeHidden();
  await expect(steps.nth(2)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Servicio', exact: true }).selectOption('1');
  await page.getByRole('combobox', { name: 'Paciente', exact: true }).selectOption('1');
  await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeEnabled();
  await page.screenshot({ path: `${dir}/ux04-recepcion-paso1-${width}.png`, fullPage: true });

  // Paso 2: dentista, día y huecos; el paso 1 queda fuera de pantalla.
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(steps.nth(0)).toBeHidden();
  await expect(steps.nth(1)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fecha y horario', exact: true })).toBeFocused();
  await page.getByRole('combobox', { name: 'Dentista', exact: true }).selectOption('7');
  await page.getByRole('button', { name: '09:00–09:30', exact: true }).click();
  await expect(page.getByText('Seleccionado: 09:00–09:30', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reservar cita', exact: true })).toBeHidden();
  await page.screenshot({ path: `${dir}/ux04-recepcion-paso2-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // Paso 3: revisión con lo elegido; atrás no pierde nada.
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(steps.nth(1)).toBeHidden();
  await expect(steps.nth(2)).toBeVisible();
  const review = page.getByRole('group', { name: 'Revisión de la cita' });
  await expect(review.getByText('Ana Pérez', { exact: true })).toBeVisible();
  await expect(review.getByText('Consulta de valoración · 30 min', { exact: true })).toBeVisible();
  await expect(review.getByText('Ana Uno', { exact: true })).toBeVisible();
  await expect(review.getByText('domingo, 18 de octubre de 2026', { exact: true })).toBeVisible();
  await expect(review.getByText('09:00–09:30', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${dir}/ux04-recepcion-paso3-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole('button', { name: 'Atrás', exact: true }).click();
  await expect(steps.nth(1)).toBeVisible();
  await expect(page.getByRole('button', { name: '09:00–09:30', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  // Confirmación: una sola petición y acciones útiles posteriores.
  await page.getByRole('button', { name: 'Reservar cita', exact: true }).click();
  await expect(page.getByText('Cita creada correctamente.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver detalle de la cita', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear otra cita', exact: true })).toBeVisible();
  await page.screenshot({ path: `${dir}/ux04-recepcion-confirmada-${width}.png`, fullPage: true });
}

test('UX-04 recepción: asistente de tres pasos a 1440px (solo paso activo)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await fixture(page);
  await walkStepper(page, 1440);
});

test('UX-04 recepción: asistente de tres pasos a 390px (solo paso activo)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 960 });
  await fixture(page);
  await walkStepper(page, 390);
});

test('UX-04 recepción: sin desbordes a 320px en la agenda', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await fixture(page);
  await page.goto('/appointments?create=1');
  await expect(page.getByRole('heading', { name: 'Nueva cita', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Servicio', exact: true }).selectOption('1');
  await page.getByRole('combobox', { name: 'Paciente', exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.locator('.reception-step').nth(1)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `${dir}/ux04-recepcion-paso2-320.png`, fullPage: true });
});
