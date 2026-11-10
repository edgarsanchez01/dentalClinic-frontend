import { expect, test } from '@playwright/test';

for (const [role, width] of [['DENTIST', 1280], ['OWNER', 320], ['RECEPTIONIST', 1280]] as const) {
  test(`Fase 1A ${role} atención contextual a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: Array<{ path: string; body: unknown }> = [];
    const clinicalReads: string[] = [];
    let notes: unknown[] = [];
    let appointment = {
      id: 7, patientId: 1, patientFirstName: 'Ana', patientLastName: 'Pérez', dentistId: 3,
      dentistFirstName: 'Olivia', dentistLastName: 'Profesional', startAt: '2026-10-13T16:00:00Z',
      endAt: '2026-10-13T17:00:00Z', durationMinutes: 60, status: 'SCHEDULED',
      occurrenceVersion: 1, createdByUserId: 10, createdAt: '2026-10-12T12:00:00Z',
    };
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      let body: unknown;
      if (path === '/api/auth/refresh') body = { accessToken: 'clinical-context-test' };
      else if (path === '/api/auth/me') body = { id: 10, role, dentistId: 3, email: 'actor@dc.test', active: true, createdAt: '2026-01-01T00:00:00Z' };
      else if (path === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
      else if (path === '/api/public/schedule') body = { timezone: 'America/Mexico_City', days: [], exceptions: [], dentists: [] };
      else if (path === '/api/notifications/unread-count') body = { unread: 0 };
      else if (path === '/api/appointments/7') body = appointment;
      else if (path === '/api/appointments/7/events') body = [];
      else if (path === '/api/appointments/7/complete') {
        writes.push({ path, body: request.postData() });
        appointment = { ...appointment, status: 'COMPLETED' }; body = appointment;
      } else if (path === '/api/patients/1/clinical') {
        clinicalReads.push(path); body = { patientId: 1, medicalBackground: 'Hipertensión', allergies: 'Penicilina' };
      } else if (path === '/api/patients/1/clinical/appointments/7/trace') {
        clinicalReads.push(path);
        const section = new URL(request.url()).searchParams.get('section');
        const entries = section === 'NOTES' ? notes : [];
        body = { context: { appointmentId: 7, occurrenceVersion: 1, currentOccurrenceVersion: 1,
          currentStatus: appointment.status, kind: entries.length ? 'FROZEN' : 'CURRENT_UNFROZEN', timezone: 'America/Mexico_City' },
          availableSections: ['NOTES', 'EVOLUTIONS'], section,
          results: { content: entries.map((entry) => ({ recordId: (entry as { id: number }).id, originalEntry: entry, corrections: [], currentEntry: entry })), page: 0, size: 20, totalElements: entries.length, totalPages: entries.length ? 1 : 0 } };
      } else if (path === '/api/patients/1/clinical/notes') {
        if (method === 'POST') {
          const input = request.postDataJSON() as { content: string };
          writes.push({ path, body: input });
           const note = { id: 1, ...input, appointmentContext: { appointmentId: 7, occurrenceVersion: 1, statusAtRegistration: 'SCHEDULED',
             scheduledStartAt: appointment.startAt, scheduledEndAt: appointment.endAt, timezone: 'America/Mexico_City' },
             authorDentistId: 3, authorName: 'Olivia Profesional', createdAt: '2026-10-13T16:00:00Z' };
          notes = [note]; body = note;
        } else { clinicalReads.push(path); body = notes; }
      } else if (path === '/api/patients/1/clinical/treatments') { clinicalReads.push(path); body = []; }
      else if (path === '/api/patients/1/odontogram') { clinicalReads.push(path); body = []; }
      else { await route.fulfill({ status: 404, json: {} }); return; }
      await route.fulfill({ status: 200, json: body });
    });
    await page.goto('/appointments/7');
    await expect(page.getByRole('heading', { name: role === 'DENTIST' ? 'Ana Pérez' : 'Cita #7', exact: true })).toBeVisible();
    if (role === 'RECEPTIONIST') {
      await expect(page.getByRole('region', { name: 'Atención clínica' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Completar', exact: true })).toHaveCount(0);
      expect(clinicalReads).toEqual([]);
      return;
    }
    await expect(page.getByText('Penicilina', { exact: true })).toBeVisible();
    if (role === 'DENTIST') await page.getByRole('tab', { name: 'Atención clínica', exact: true }).click();
    await page.getByLabel('Nueva nota clínica').fill('Nota guardada durante atención');
    if (role === 'DENTIST') {
      await page.getByRole('tab', { name: 'Resumen', exact: true }).click();
      await page.getByRole('tab', { name: 'Atención clínica', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Esta atención', exact: true }).click();
      await page.getByRole('button', { name: 'Esta atención', exact: true }).click();
    }
    await expect(page.getByLabel('Nueva nota clínica')).toHaveValue('Nota guardada durante atención');
    await page.getByRole('button', { name: 'Añadir nota', exact: true }).click();
    await expect(page.getByText('Nota guardada durante atención', { exact: true })).toBeVisible();
    await expect(page.getByText('Programada', { exact: true })).toBeVisible();
    expect(writes).toEqual([{ path: '/api/patients/1/clinical/notes', body: { content: 'Nota guardada durante atención', appointmentContext: { appointmentId: 7, occurrenceVersion: 1 } } }]);
    await page.getByRole(role === 'DENTIST' ? 'tab' : 'button', { name: role === 'DENTIST' ? 'Tratamientos' : 'Tratamientos y evolución', exact: true }).click();
    await expect(page.getByText('Todavía no hay tratamientos registrados.')).toBeVisible();
    await page.getByRole(role === 'DENTIST' ? 'tab' : 'button', { name: 'Odontograma', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Odontograma', exact: true })).toBeVisible();
    if (role === 'DENTIST') {
      await expect(page.getByRole('button', { name: /Completar cita|Confirmar y completar cita/ })).toHaveCount(0);
      expect(writes).toHaveLength(1);
    } else {
      await page.getByRole('button', { name: 'Odontograma', exact: true }).click();
      await page.getByRole('button', { name: 'Completar', exact: true }).click();
      await expect(page.getByText('Revisión opcional de la atención')).toBeVisible();
      await page.getByRole('button', { name: 'Consultar registros antes de cerrar' }).click();
      await expect(page.getByText('Tratamientos vinculados a esta cita: 0.')).toBeVisible();
    }
    const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('main *')).filter(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && bounds.right > window.innerWidth;
    }).map(element => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right })));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), JSON.stringify(overflow)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`clinical-context-${width}.png`), fullPage: true });
    if (role === 'OWNER') {
      await page.getByRole('button', { name: 'Sí, completar', exact: true }).click();
      await expect(page.getByText('Cita completada.', { exact: true })).toBeVisible();
      expect(writes).toHaveLength(2);
      expect(writes[1]).toEqual({ path: '/api/appointments/7/complete', body: null });
    }
    await expect(page.getByRole('button', { name: 'Registrar llegada' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Iniciar consulta' })).toHaveCount(0);
  });
}
