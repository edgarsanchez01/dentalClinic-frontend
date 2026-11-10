import { expect, test, type Page } from '@playwright/test';

const NOW = '2026-11-01T01:00:00Z';
const empty = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
async function fixture(page: Page, role: 'OWNER' | 'RECEPTIONIST', options: { fail?: string; empty?: boolean } = {}) {
  await page.clock.setFixedTime(new Date(NOW));
  const calls: URL[] = [];
  const appointment = { id: 7, patientId: 1, patientFirstName: 'Ana', patientLastName: 'Paciente de prueba',
    dentistId: 3, dentistFirstName: 'Olivia', dentistLastName: 'Profesional de prueba',
    startAt: '2026-11-01T02:00:00Z', endAt: '2026-11-01T03:00:00Z', durationMinutes: 60,
    status: 'SCHEDULED', occurrenceVersion: 1, createdByUserId: 1, createdAt: NOW };
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const url = new URL(route.request().url()); calls.push(url);
    if (url.pathname === options.fail) { await route.fulfill({ status: 503, json: {} }); return; }
    let body: unknown;
    switch (url.pathname) {
      case '/api/auth/refresh': body = { accessToken: 'dashboard-browser-mock' }; break;
      case '/api/auth/me': body = { id: 1, role, email: 'actor@dashboard.test', active: true, dentistId: 3, createdAt: NOW }; break;
      case '/api/onboarding/status': body = { status: 'COMPLETED', clinicConfigured: true }; break;
      case '/api/clinic': body = { name: 'Clínica de prueba con un nombre extenso para revisión responsive', timezone: 'America/Mexico_City' }; break;
      case '/api/availability/policy': body = { timezone: 'America/Mexico_City', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 }; break;
      case '/api/public/schedule': body = { timezone: 'America/Mexico_City', days: [], dentists: [], exceptions: [] }; break;
      case '/api/schedules/clinic': body = { timezone: 'America/Mexico_City', days: [] }; break;
      case '/api/appointments': body = { ...empty, size: Number(url.searchParams.get('size') ?? 20),
        content: options.empty ? [] : [appointment], totalElements: options.empty ? 0 : 107, totalPages: options.empty ? 0 : 107 }; break;
      case '/api/appointments/7': body = appointment; break;
      case '/api/appointments/7/events': body = []; break;
      case '/api/patients': body = empty; break;
      case '/api/services': body = []; break;
      case '/api/financial/reports/portfolio': body = { asOf: NOW, confirmedCharges: 208,
        billedAmount: 9999, appliedAmount: 2000, pendingBalance: 7999,
        statusCounts: { pendiente: 107, parcial: 100, pagado: 1, anulado: 0 } }; break;
      case '/api/financial/reports/cash-flow': body = { from: url.searchParams.get('from'), to: url.searchParams.get('to'),
        grossAmount: 2500.50, reversalAmount: 3000, netAmount: -499.50, methods: [] }; break;
      case '/api/charges': body = empty; break;
      case '/api/feedback': body = { ...empty, count: options.empty ? 0 : 120, average: options.empty ? null : 4.25 }; break;
      case '/api/users': body = options.empty ? [] : [{ role: 'RECEPTIONIST', status: 'PENDING' }]; break;
      case '/api/notifications': body = empty; break;
      case '/api/notifications/unread-count': body = { unread: 0 }; break;
      default: await route.fulfill({ status: 404, json: {} }); return;
    }
    await route.fulfill({ status: 200, json: body });
  });
  return calls;
}

for (const role of ['OWNER', 'RECEPTIONIST'] as const) {
  for (const width of [320, 768, 1280]) {
    test(`9A.2 ${role}: datos, permisos, teclado y geometría a ${width}px (API interceptada)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      const calls = await fixture(page, role);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: role === 'OWNER' ? 'Resumen de la clínica' : 'Recepción', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: role === 'OWNER' ? 'Citas de hoy' : 'Citas programadas hoy' }).getByText('107', { exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Cartera pendiente' }).getByText('$7,999.00 MXN', { exact: true })).toBeVisible();
      await expect(page.getByText(/Primeras 1 de 107/)).toBeVisible();
      if (role === 'OWNER') {
        await expect(page.getByRole('region', { name: 'Cobrado este mes' }).getByText('$2,500.50 MXN', { exact: true })).toBeVisible();
        const cash = calls.find(url => url.pathname.endsWith('/cash-flow'))!;
        expect(cash.searchParams.get('from')).toBe('2026-10-01T06:00:00.000Z');
        expect(cash.searchParams.get('to')).toBe('2026-11-01T06:00:00.000Z');
      } else {
        expect(calls.some(url => ['/api/clinic', '/api/users', '/api/feedback'].includes(url.pathname) || url.pathname.endsWith('cash-flow'))).toBe(false);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const actions = page.getByRole('navigation', { name: 'Acciones rápidas' });
      for (const action of await actions.getByRole('link').all()) {
        const box = (await action.boundingBox())!; expect(box.height).toBeGreaterThanOrEqual(44);
      }
      const create = page.getByRole('link', { name: 'Crear cita', exact: true });
      await create.focus(); await expect(create).toBeFocused();
      const focus = await create.evaluate(element => getComputedStyle(element).boxShadow);
      expect(focus).not.toBe('none');
      const contrast = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        const luminance = (color: string) => {
          context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => {
            const c = channel / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
          });
          return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722;
        };
        return [...document.querySelectorAll('section[aria-label="Cartera pendiente"] h2, section[aria-label="Cartera pendiente"] p, section[aria-label="Cartera pendiente"] a, a[href="/appointments?create=1"]')].map(element => {
          const style = getComputedStyle(element);
          // Metrics may be flat on the canvas: resolve the actual painted ancestor,
          // not transparent black from an unpainted section.
          let painted: Element | null = element;
          let background = 'rgb(255, 255, 255)';
          while (painted) {
            const value = getComputedStyle(painted).backgroundColor;
            if (value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)') { background = value; break; }
            painted = painted.parentElement;
          }
          const a = luminance(style.color), b = luminance(background);
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        });
      });
      for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({ path: test.info().outputPath(`dashboard-${role}-${width}.png`), fullPage: true });
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/appointments\?create=1$/);
      await expect(page.getByRole('heading', { name: 'Nueva cita', exact: true })).toBeVisible();
      await page.goBack();
      await expect(page.getByRole('heading', { name: role === 'OWNER' ? 'Resumen de la clínica' : 'Recepción', exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}

test('9A.2 reporte profundo conserva período clínico y permite Back/Forward', async ({ page }) => {
  await fixture(page, 'OWNER'); await page.goto('/');
  const metric = page.getByRole('region', { name: 'Cobrado este mes' });
  await expect(metric.getByText('$2,500.50 MXN', { exact: true })).toBeVisible();
  await metric.getByRole('link').click();
  await expect(page.getByRole('tab', { name: 'Cobros por período' })).toHaveAttribute('aria-selected', 'true');
  expect(new URL(page.url()).searchParams.get('from')).toBe('2026-10-01T06:00:00.000Z');
  expect(new URL(page.url()).searchParams.get('to')).toBe('2026-11-01T06:00:00.000Z');
  await page.goBack(); await expect(page.getByRole('heading', { name: 'Resumen de la clínica' })).toBeVisible();
  await page.goForward(); await expect(page.getByRole('heading', { name: 'Reportes financieros' })).toBeVisible();
});

test('9A.2 vacío y error de cartera independientes, sin números inventados', async ({ page }) => {
  await fixture(page, 'OWNER', { empty: true, fail: '/api/financial/reports/portfolio' }); await page.goto('/');
  const portfolio = page.getByRole('region', { name: 'Cartera pendiente' });
  await expect(portfolio.getByRole('alert')).toBeVisible();
  await expect(portfolio.getByRole('button', { name: /Reintentar/ })).toBeVisible();
  await expect(page.getByText('Aún no hay evaluaciones respondidas.')).toBeVisible();
  await expect(page.getByText('No hay personal pendiente de activación.')).toBeVisible();
  await expect(page.getByText(/No hay próximas citas programadas/)).toBeVisible();
  await expect(page.getByText('No tienes notificaciones todavía.')).toBeVisible();
});
