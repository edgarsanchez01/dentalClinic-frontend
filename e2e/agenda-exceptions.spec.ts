import { expect, test } from '@playwright/test';

for (const width of [320, 1280]) {
  test(`H-A08: apertura especial y ausencia no interactiva a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date('2026-10-10T10:00:00Z'));
    const exception = { date: '2026-10-11', closed: false, startTime: '18:00:00', endTime: '20:00:00' };
    const week = { timezone: 'Europe/Madrid', days: Array.from({ length: 7 }, (_, index) => ({
      dayOfWeek: index + 1, open: index !== 6,
      startTime: index === 6 ? null : '09:00:00', endTime: index === 6 ? null : '17:00:00', breaks: [],
    })) };
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
      const path = new URL(route.request().url()).pathname;
      const data: Record<string, unknown> = {
        '/api/auth/refresh': { accessToken: 'agenda-test' },
        '/api/auth/me': { id: 1, email: 'owner@clinic.com', role: 'OWNER', dentistId: 7, active: true, createdAt: '2026-01-01T00:00:00Z' },
        '/api/onboarding/status': { status: 'COMPLETED', clinicConfigured: true },
        '/api/services': [{ id: 30, name: 'Servicio de prueba', description: null, referencePrice: 75, durationMinutes: 30, active: true, createdAt: '2026-10-10T00:00:00Z', updatedAt: null }],
        '/api/public/schedule': { ...week, exceptions: [exception], dentists: [{ dentistId: 7, firstName: 'Ana', lastName: 'Uno', days: [] }] },
        '/api/schedules/clinic': week,
        '/api/schedules/dentist/7': { ...week, dentistId: 7 },
        '/api/schedules/dentist/7/exceptions': [exception],
        '/api/schedules/dentist/7/time-off': [{ id: 30, startDate: exception.date, endDate: exception.date, allDay: false, startTime: '18:30:00', endTime: '19:00:00' }],
        '/api/patients': { content: [{ id: 1, firstName: 'Ana', lastName: 'Pérez', active: true }], totalElements: 1 },
        '/api/appointments': { content: [{ id: 7, patientId: 1, patientFirstName: 'Ana', patientLastName: 'Pérez', dentistId: 7, status: 'SCHEDULED', startAt: '2026-10-11T17:00:00Z', endAt: '2026-10-11T17:30:00Z', durationMinutes: 30 }], totalElements: 1 },
        '/api/availability': { dentistId: 7, durationMinutes: 30, timezone: 'Europe/Madrid', slots: [{ startDate: exception.date, startTime: '18:00:00', endTime: '18:30:00', start: '2026-10-11T16:00:00Z', end: '2026-10-11T16:30:00Z' }] },
      };
      await route.fulfill({ status: path in data ? 200 : 404, contentType: 'application/json', body: JSON.stringify(data[path] ?? {}) });
    });
    await page.goto('/appointments?create=1');
    await expect(page.getByRole('heading', { name: 'Citas', exact: true })).toBeVisible();
    await page.getByLabel('Fecha', { exact: true }).fill('2026-10-11');
    if (width >= 768) await page.getByRole('button', { name: 'Día', exact: true }).click();
    await page.getByRole('combobox', { name: 'Servicio', exact: true }).selectOption('30');
    if (width < 768) {
      // En móvil la agenda es una lista diaria, no una rejilla de disponibilidad interactiva.
      await expect(page.getByRole('button', { name: 'Día', exact: true })).toHaveCount(0);
      const list = page.getByRole('region', { name: 'Agenda del día', exact: true });
      await expect(list.getByRole('button', { name: 'Abrir cita de Ana Pérez a las 19:00 Programada' })).toBeVisible();
      // UX-04: el asistente exige paciente en el paso 1; dentista, día y huecos están en el paso 2.
      await page.getByRole('combobox', { name: 'Paciente', exact: true }).selectOption('1');
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await page.getByRole('combobox', { name: 'Dentista', exact: true }).selectOption('7');
      await page.getByLabel('Día', { exact: true }).fill(exception.date);
      const slots = page.getByRole('group', { name: 'Huecos disponibles', exact: true });
      await expect(slots.getByRole('button')).toHaveCount(1);
      await expect(slots.getByRole('button', { name: '18:30–19:00', exact: true })).toHaveCount(0);
      await slots.getByRole('button', { name: '18:00–18:30', exact: true }).click();
      await expect(page.getByText('Seleccionado: 18:00–18:30', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      return;
    }
    const agenda = page.getByRole('region', { name: 'Agenda de Ana Uno' });
    const absence = agenda.getByRole('note', { name: 'Ausencia: 18:30–19:00', exact: true });
    await expect(absence).toBeVisible();
    const slot = agenda.getByRole('button', { name: 'Reservar 18:00-18:30' });
    await expect(slot).toBeVisible();
    await expect(agenda.getByRole('button', { name: 'Cita con Ana Pérez a las 19:00 Programada' })).toBeVisible();
    expect(await absence.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none');
    await expect(absence.getByRole('button')).toHaveCount(0);
    await expect(agenda.getByRole('button', { name: /^Reservar / })).toHaveCount(1);
    await absence.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('agenda-exception.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await slot.click();
    await expect(page.getByText('Seleccionado: 18:00–18:30', { exact: true })).toBeVisible();
  });
}
