import { expect, test } from '@playwright/test';

for (const [role, width] of [['OWNER', 320], ['OWNER', 1280], ['PATIENT', 320], ['PATIENT', 1280], ['DENTIST', 1280], ['RECEPTIONIST', 1280]] as const) {
  test(`F7.3 ${role} reserva servicio con duración del servidor a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date('2026-10-13T06:00:00Z'));
    const services = [{ id: 1, name: 'Consulta de valoración', description: 'Valoración inicial', referencePrice: 75.1234, durationMinutes: 30, active: true },
      { id: 2, name: 'Servicio de mayor duración', description: null, referencePrice: 90, durationMinutes: 60, active: true }];
    const week = { timezone: 'UTC', days: Array.from({ length: 7 }, (_, index) => ({ dayOfWeek: index + 1, open: true, startTime: '09:00:00', endTime: '17:00:00', breaks: [] })) };
    const posts: Array<Record<string, unknown>> = [];
    const privateCatalog: string[] = [];
    const appointments: unknown[] = [];
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      let body: unknown;
      if (path === '/api/auth/refresh') body = { accessToken: 'booking-test' };
      else if (path === '/api/auth/me') body = { id: 1, email: 'user@clinic.com', role, active: true, patientId: role === 'PATIENT' ? 5 : null, dentistId: role === 'OWNER' || role === 'DENTIST' ? 7 : null, createdAt: '2026-01-01T00:00:00Z', ...(role === 'PATIENT' ? { medicalOnboarding: { requirement: 'EXEMPT_EXISTING', progress: 'NOT_STARTED', pending: false } } : {}) };
      else if (path === '/api/availability/policy') body = { timezone: 'UTC', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 };
      else if (path === '/api/public/schedule') body = { ...week, exceptions: [], dentists: [{ dentistId: 7, firstName: 'Ana', lastName: 'Uno', days: [] }, { dentistId: 8, firstName: 'Luis', lastName: 'Dos', days: [] }] };
      else if (path === '/api/services') { privateCatalog.push(path); body = services; }
      else if (path === '/api/public/services') body = services.map(({ id, name, description, referencePrice, durationMinutes }) => ({ id, name, description, referencePrice, durationMinutes }));
      else if (path === '/api/schedules/clinic') body = week;
      else if (path === '/api/patients') body = { content: [{ id: 1, firstName: 'Ana', lastName: 'Pérez', active: true }], totalElements: 1 };
      else if (path === '/api/availability') {
        const service = services.find((item) => item.id === Number(url.searchParams.get('serviceId')))!;
        body = { dentistId: Number(url.searchParams.get('dentistId')), durationMinutes: service.durationMinutes, timezone: 'UTC', slots: [{ startDate: '2026-10-13', startTime: '09:00:00', endTime: service.durationMinutes === 30 ? '09:30:00' : '10:00:00', start: '2026-10-13T09:00:00Z', end: service.durationMinutes === 30 ? '2026-10-13T09:30:00Z' : '2026-10-13T10:00:00Z' }] };
      } else if (path === '/api/appointments' && route.request().method() === 'POST') {
        const input = route.request().postDataJSON() as Record<string, unknown>;
        posts.push(input);
        body = { id: 7, ...input, service: services.find((item) => item.id === input.serviceId), durationMinutes: 60,
          patientFirstName: 'Ana', patientLastName: 'Pérez', dentistFirstName: 'Luis', dentistLastName: 'Dos',
          status: 'SCHEDULED', occurrenceVersion: 1, createdByUserId: 1, createdAt: '2026-10-13T06:00:00Z' };
        appointments.push(body);
      } else if (path === '/api/appointments') body = { content: appointments, totalElements: appointments.length };
      else { await route.fulfill({ status: 404, json: {} }); return; }
      await route.fulfill({ status: path === '/api/appointments' && route.request().method() === 'POST' ? 201 : 200, json: body });
    });
    await page.goto(role === 'PATIENT' ? '/appointments' : '/appointments?create=1');
    await expect(page.getByRole('heading', { name: role === 'PATIENT' ? 'Mis citas' : 'Citas', exact: true })).toBeVisible();
    if (role === 'PATIENT') {
      await page.getByRole('link', { name: 'Reservar cita', exact: true }).click();
      await expect(page.getByRole('radio', { name: 'Consulta de valoración', exact: true })).not.toBeChecked();
      await page.getByRole('radio', { name: 'Consulta de valoración', exact: true }).check();
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    } else {
      await expect(page.getByRole('combobox', { name: 'Servicio', exact: true })).toHaveValue('');
      await page.getByRole('combobox', { name: 'Servicio', exact: true }).selectOption('1');
    }
    if (role !== 'PATIENT') {
      // UX-04: el dentista y los huecos viven en el paso 2 del asistente de recepción.
      await page.getByRole('combobox', { name: 'Paciente', exact: true }).selectOption('1');
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(page.getByRole('combobox', { name: 'Servicio', exact: true })).not.toBeVisible();
    }
    if (role !== 'DENTIST') await page.getByRole('combobox', { name: 'Dentista', exact: true }).selectOption('8');
    await page.getByRole('button', { name: '09:00–09:30', exact: true }).click();
    if (role === 'PATIENT') {
      await page.getByRole('button', { name: 'Anterior', exact: true }).click();
      await page.getByRole('radio', { name: 'Servicio de mayor duración', exact: true }).check();
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
    } else {
      // Cambiar el servicio exige volver al paso 1; el paso 2 conserva dentista y día.
      await page.getByRole('button', { name: 'Atrás', exact: true }).click();
      await page.getByRole('combobox', { name: 'Servicio', exact: true }).selectOption('2');
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      if (role !== 'DENTIST') await expect(page.getByRole('combobox', { name: 'Dentista', exact: true })).toHaveValue('8');
      await expect(page.getByRole('button', { name: 'Atrás', exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: /Reservar cita|Confirmar solicitud/ })).toHaveCount(0);
    await expect(page.getByText(role === 'PATIENT' ? /60 minutos/ : '60 minutos', { exact: role !== 'PATIENT' })).toBeVisible();
    await page.getByRole('button', { name: '09:00–10:00', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('service-booking.png'), fullPage: true });
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    if (role === 'PATIENT') await expect(page.getByRole('button', { name: 'Confirmar solicitud', exact: true })).toBeVisible();
    else await expect(page.getByRole('heading', { name: 'Motivo y confirmación', exact: true })).toBeVisible();
    await page.getByRole('button', { name: role === 'PATIENT' ? 'Confirmar solicitud' : 'Reservar cita', exact: true }).click();
    await expect(page.getByText(role === 'PATIENT' ? 'Tu cita está reservada' : 'Cita creada correctamente.', { exact: true })).toBeVisible();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ serviceId: 2, patientId: role === 'PATIENT' ? 5 : 1, dentistId: role === 'DENTIST' ? 7 : 8, startAt: '2026-10-13T09:00:00Z', endAt: '2026-10-13T10:00:00Z' });
    expect(posts[0]).not.toHaveProperty('referencePrice'); expect(posts[0]).not.toHaveProperty('durationMinutes');
    if (role === 'PATIENT') expect(privateCatalog).toEqual([]);
  });
}
