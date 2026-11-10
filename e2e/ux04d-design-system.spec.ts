import { expect, test, type Page } from '@playwright/test';

// All data is synthetic and all API calls are intercepted. Never reaches a persistent service.
async function fixture(page: Page) {
  const now = '2026-10-19T16:00:00Z';
  const empty = { content: [], page: 0, size: 100, totalElements: 0, totalPages: 0 };
  const calls: string[] = [];
  const schedule = { timezone: 'America/Mexico_City', days: [], exceptions: [], dentists: [] };
  await page.clock.setFixedTime(new Date(now));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const { pathname } = new URL(route.request().url());
    calls.push(pathname);
    const responses: Record<string, unknown> = {
      '/api/auth/refresh': { accessToken: 'ux04d-synthetic' },
      '/api/auth/me': { id: 10, role: 'RECEPTIONIST', email: 'recepcion@example.test', active: true, createdAt: now },
      '/api/onboarding/status': { status: 'COMPLETED', clinicConfigured: true },
      '/api/availability/policy': { timezone: schedule.timezone, maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 },
      '/api/public/schedule': schedule, '/api/schedules/clinic': schedule,
      '/api/services': [], '/api/appointments': empty, '/api/patients': empty,
      '/api/financial/reports/portfolio': { asOf: now, confirmedCharges: 0, billedAmount: '0.00', appliedAmount: '0.00', pendingBalance: '0.00', statusCounts: { pendiente: 0, parcial: 0, pagado: 0, anulado: 0 } },
      '/api/notifications': empty, '/api/notifications/unread-count': { unread: 0 },
    };
    expect(pathname in responses, `Unexpected API: ${pathname}`).toBe(true);
    expect(route.request().method() === 'GET' || pathname === '/api/auth/refresh').toBe(true);
    await route.fulfill({ json: responses[pathname] });
  });
  return calls;
}

async function contrast(page: Page) {
  const ratios = await page.locator('.reception-page-heading h1, .reception-page-heading p, .reception-page-heading span, .reception-cover-message, .reception-journal-cover p, .reception-operations .reception-button').evaluateAll(elements => {
    function luminance(color: string) {
      const [r, g, b] = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
      });
      return r! * .2126 + g! * .7152 + b! * .0722;
    }
    return elements.map(element => {
      let ancestor: Element | null = element;
      let background = 'rgb(255, 255, 255)';
      while (ancestor) {
        const value = getComputedStyle(ancestor).backgroundColor;
        if (value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)') { background = value; break; }
        ancestor = ancestor.parentElement;
      }
      const a = luminance(getComputedStyle(element).color), b = luminance(background);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
  });
  expect(ratios.length).toBeGreaterThan(3);
  for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
}

for (const width of [320, 390, 768, 1280, 1440]) {
  test(`UX-04D encabezados neutros, jerarquía, foco, CTA y responsive ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const calls = await fixture(page);
    for (const path of ['/', '/appointments?date=2026-10-19&view=week']) {
      const home = path === '/';
      await page.goto(path);
      const heading = page.getByRole('heading', { name: home ? 'Recepción' : 'Citas', level: 1, exact: true });
      await expect(heading).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('.reception-operations')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      const header = page.locator('.reception-operations > .reception-page-heading');
      await expect(header).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(header).toHaveCSS('padding', '0px');
      await expect(header).toHaveCSS('border-radius', '0px');
      await expect(heading).toHaveCSS('color', 'rgb(25, 63, 67)');
      await expect(page.locator('.reception-shell')).toHaveCSS('background-color', 'rgb(246, 247, 243)');
      if (home) {
        const context = page.getByRole('region', { name: 'La jornada, en orden.' });
        await expect(context).toHaveCSS('background-color', 'rgb(185, 214, 201)');
        await expect(context.getByRole('heading', { level: 2 })).toBeVisible();
        expect((await heading.boundingBox())!.y).toBeLessThan((await context.boundingBox())!.y);
        expect(await heading.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(
          await context.getByRole('heading').evaluate(el => parseFloat(getComputedStyle(el).fontSize)));
      } else {
        await expect(page.locator('.reception-journal-cover')).toHaveCount(0);
        await expect(header.getByText(/Hora de la clínica/)).toBeVisible();
        await expect(page.getByLabel('Fecha', { exact: true })).toHaveValue('2026-10-19');
      }
      await page.evaluate(() => document.fonts.ready);
      await contrast(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const create = home ? page.getByRole('link', { name: 'Crear cita', exact: true }) : header.getByRole('button', { name: 'Crear cita', exact: true });
      const box = (await create.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.y + box.height).toBeLessThan(900);
      await page.keyboard.press('Tab');
      await create.focus(); await expect(create).toBeFocused();
      await expect(create).toHaveCSS('outline-width', '2px');
      await expect(create).toHaveCSS('outline-offset', '3px');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Nueva cita', exact: true })).toBeVisible();
      const back = page.getByRole('button', { name: 'Volver a la agenda', exact: true });
      await back.focus(); await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Nueva cita', exact: true })).toBeHidden();
    }
    expect(calls.some(path => /clinical|odontogram|\/api\/users|\/api\/clinic$/.test(path))).toBe(false);
  });
}
