import { expect, test, type Page } from '@playwright/test';

const NOW = '2026-10-18T12:00:00Z';
const empty = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
const services = [{ id: 1, name: 'Consulta de valoración', description: 'Revisión general y orientación para tu atención.', durationMinutes: 30, referencePrice: 850 }, { id: 2, name: 'Limpieza dental', description: 'Atención preventiva para tu salud dental.', durationMinutes: 60, referencePrice: 1200 }];
const appointment = { id: 7, patientId: 4, patientUserId: 10, patientFirstName: 'Mariana', patientLastName: 'Paciente sintética', dentistId: 3, dentistFirstName: 'Elena', dentistLastName: 'Profesional sintética', startAt: '2026-10-20T15:00:00Z', endAt: '2026-10-20T15:30:00Z', durationMinutes: 30, service: services[0], status: 'SCHEDULED', occurrenceVersion: 1, createdAt: NOW, createdByUserId: 10 };

async function fixture(page: Page, options: { noAppointment?: boolean; noServices?: boolean; noSlots?: boolean; conflict?: boolean; uncertain?: boolean; pending?: boolean; failure?: string; delayPost?: boolean } = {}) {
  await page.clock.setFixedTime(new Date(NOW));
  const calls: { path: string; method: string; body: unknown; key?: string }[] = [];
  let saved = { ...appointment };
  let read = false;
  let authenticated = true;
  let conflict = options.conflict;
  let uncertain = options.uncertain;
  let release: (() => void) | undefined;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const state = { noSlots: !!options.noSlots, noServices: !!options.noServices };
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const input = request.postData() ? request.postDataJSON() : null;
    calls.push({ path, method, body: input, key: request.headers()['idempotency-key'] });
    if (path === options.failure) { await route.fulfill({ status: 503, json: { message: 'No se pudo cargar la información. Inténtalo de nuevo.' } }); return; }
    if (path === '/api/auth/refresh') { await route.fulfill({ status: authenticated ? 200 : 401, json: { accessToken: 'synthetic-patient-ux' } }); return; }
    if (path === '/api/auth/logout') { authenticated = false; await route.fulfill({ status: 204 }); return; }
    if (path === '/api/auth/password/change') { authenticated = false; await route.fulfill({ status: 204 }); return; }
    let body: unknown;
    if (path === '/api/auth/me') body = { id: 10, patientId: 4, role: 'PATIENT', email: 'mariana@example.test', active: true, createdAt: NOW, medicalOnboarding: { requirement: options.pending ? 'REQUIRED' : 'EXEMPT_EXISTING', progress: 'NOT_STARTED', pending: !!options.pending } };
    else if (path === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (path === '/api/availability/policy') body = { timezone: 'America/Mexico_City', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 };
    else if (path === '/api/public/services') body = state.noServices ? [] : services;
    else if (path === '/api/public/schedule') body = { timezone: 'America/Mexico_City', days: [], exceptions: [], dentists: [{ dentistId: 3, firstName: 'Elena', lastName: 'Profesional sintética', days: [] }, { dentistId: 8, firstName: 'Andrés', lastName: 'Profesional sintético', days: [] }] };
    else if (path === '/api/availability') { const duration = url.searchParams.get('serviceId') === '2' ? 60 : 30; const day = url.searchParams.get('from'); body = { dentistId: Number(url.searchParams.get('dentistId')), durationMinutes: duration, timezone: 'America/Mexico_City', slots: state.noSlots ? [] : [9, 11, 16].map(hour => ({ startDate: day, startTime: `${hour}:00:00`, endTime: `${duration === 60 ? hour + 1 : hour}:${duration === 60 ? '00' : '30'}:00`, start: `${day}T${String(hour + 6).padStart(2, '0')}:00:00Z`, end: `${day}T${String(hour + 6 + (duration === 60 ? 1 : 0)).padStart(2, '0')}:${duration === 60 ? '00' : '30'}:00Z` })) }; }
    else if (path === '/api/appointments' && method === 'POST') {
      if (options.delayPost) await hold;
      if (conflict) { conflict = false; await route.fulfill({ status: 409, json: { message: 'Ese horario ya fue tomado. Selecciona otro horario.' } }); return; }
      if (uncertain) { uncertain = false; await route.fulfill({ status: 503, json: {} }); return; }
      await route.fulfill({ status: 201, json: { ...appointment, ...input, service: services.find(s => s.id === input.serviceId), durationMinutes: services.find(s => s.id === input.serviceId)!.durationMinutes } }); return;
    } else if (path === '/api/appointments') {
      const history = url.searchParams.has('to') && !url.searchParams.has('from');
      body = { ...empty, size: Number(url.searchParams.get('size') ?? 20), content: options.noAppointment ? [] : history ? [{ ...saved, startAt: '2026-09-10T15:00:00Z', endAt: '2026-09-10T15:30:00Z', status: 'COMPLETED' }] : [saved], totalElements: options.noAppointment ? 0 : 1, totalPages: options.noAppointment ? 0 : 1 };
    } else if (path === '/api/appointments/7') body = saved;
    else if (path.endsWith('/events')) body = [];
    else if (path.endsWith('/cancel')) { saved = { ...saved, status: 'CANCELLED' }; body = saved; }
    else if (path.endsWith('/reschedule')) { saved = { ...saved, ...input, occurrenceVersion: saved.occurrenceVersion + 1 }; body = saved; }
    else if (path === '/api/patients/4') body = { id: 4, firstName: 'Mariana', lastName: 'Paciente sintética', email: 'mariana@example.test', phone: '5550000000', birthDate: '1991-07-14', active: true };
    else if (path === '/api/patients/4/odontogram') body = [{ toothFdi: 16, condition: 'RESTORED' }, { toothFdi: 26, condition: 'HEALTHY' }, { toothFdi: 36, condition: 'CARIES' }];
    else if (path.endsWith('/surfaces')) body = [];
    else if (path === '/api/notifications/unread-count') body = { unread: read ? 0 : 1 };
    else if (path === '/api/notifications/1/read') { read = true; body = { id: 1, title: 'Tu próxima visita', body: 'Consulta los detalles de tu cita y revisa tus datos antes de acudir.', priority: 'HIGH', read, createdAt: NOW }; }
    else if (path === '/api/notifications') body = { ...empty, size: Number(url.searchParams.get('size')), content: [{ id: 1, title: 'Tu próxima visita', body: 'Consulta los detalles de tu cita y revisa tus datos antes de acudir.', priority: 'HIGH', read, createdAt: NOW }, { id: 2, title: 'Información de tu cuenta', body: 'Puedes consultar tu información personal desde Mis datos.', priority: 'NORMAL', read: true, createdAt: '2026-10-17T23:00:00Z' }], totalElements: 2, totalPages: 1 };
    else if (path === '/api/patients/me/medical-intake/declarations/latest') { await route.fulfill({ status: 204 }); return; }
    else if (path.includes('/medical-intake/declarations')) body = empty;
    else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ json: body });
  });
  return { calls, state, release: () => release!() };
}

async function toSchedule(page: Page, service = 'Consulta de valoración') {
  await page.getByRole('radio', { name: new RegExp(service) }).check();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Dentista', { exact: true }).selectOption('3');
  await page.getByLabel('Día', { exact: true }).fill('20/10/2026');
}
async function toReview(page: Page) {
  await toSchedule(page);
  await page.getByRole('button', { name: '09:00–09:30', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Revisa y confirma' })).toBeFocused();
}
async function shot(page: Page, name: string, width: number) {
  await page.evaluate(() => scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/opencode/ux03/evidence/${name}-${width}.png`, fullPage: true });
}

for (const width of [320, 390, 768, 1280, 1440]) {
  test(`UX03 pantallas, reserva, solo lectura y responsive ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    const { calls } = await fixture(page);
    await page.goto('/'); await expect(page.getByRole('heading', { name: 'Tu atención dental' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Tu próxima cita', exact: true }).getByText('Consulta de valoración')).toBeVisible();
    await shot(page, 'dashboard', width);
    await page.getByRole('link', { name: 'Consultar mis citas e historial', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Mis citas' })).toBeVisible(); await expect(page.locator('.patient-appointment')).toHaveCount(1); await shot(page, 'appointments', width);
    await page.getByRole('button', { name: 'Historial', exact: true }).click(); await expect(page.getByRole('article').getByText('Completada', { exact: true })).toBeVisible(); await shot(page, 'history', width);
    await page.getByRole('link', { name: 'Reservar cita', exact: true }).click(); await expect(page.getByRole('radio').first()).toBeVisible(); await shot(page, 'booking-service', width);
    await toSchedule(page); await expect(page.getByRole('button', { name: '09:00–09:30' })).toBeVisible(); await shot(page, 'booking-schedule', width);
    await page.getByRole('button', { name: '09:00–09:30' }).click(); await page.getByRole('button', { name: 'Continuar', exact: true }).click(); await page.getByLabel('Motivo (opcional)').fill('Revisión de rutina con datos sintéticos.'); await shot(page, 'booking-review', width);
    await page.getByRole('button', { name: 'Confirmar solicitud' }).click(); await expect(page.getByRole('heading', { name: 'Tu cita está reservada' })).toBeVisible(); await shot(page, 'booking-success', width);
    expect(calls.filter(c => c.path === '/api/appointments' && c.method === 'POST')).toHaveLength(1);
    await page.goto('/patients/4'); await expect(page.getByRole('heading', { name: 'Mi información personal' })).toBeVisible(); await expect(page.getByText('14 de julio de 1991')).toBeVisible(); await expect(page.getByRole('button', { name: /Pieza 16/ })).toBeVisible(); await shot(page, 'profile', width);
    await page.locator('#dental').scrollIntoViewIfNeeded(); await page.getByRole('button', { name: 'Lista', exact: true }).click(); await expect(page.getByRole('table')).toBeVisible(); await shot(page, 'odontogram-list', width);
    await page.getByRole('button', { name: 'Gráfico', exact: true }).click(); await page.getByRole('button', { name: /Pieza 16/ }).click(); await expect(page.getByRole('button', { name: /Guardar|Registrar pieza/ })).toHaveCount(0); await shot(page, 'odontogram', width);
    expect(calls.some(c => c.method !== 'GET' && c.path.includes('odontogram'))).toBe(false);
    await page.goto('/patient-profile'); await expect(page.getByRole('heading', { name: 'Mi información de salud' })).toBeVisible(); await shot(page, 'health', width);
    await page.goto('/notifications'); await expect(page.getByRole('heading', { name: 'Tu próxima visita' })).toBeVisible(); await shot(page, 'notifications', width);
    await page.getByRole('button', { name: 'Marcar como leída', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Notificación marcada como leída.' })).toBeVisible();
    await page.goto('/change-password'); await expect(page.getByRole('heading', { name: 'Cambiar contraseña' })).toBeVisible(); await shot(page, 'account-password', width);
    if (width < 768) { await page.getByRole('button', { name: 'Abrir menú de navegación' }).click(); await expect(page.getByRole('dialog', { name: 'Menú de navegación' })).toBeVisible(); await shot(page, 'mobile-navigation', width); await page.keyboard.press('Escape'); }
    expect(calls.some(c => /\/api\/(services|users|clinic|financial|schedules\/clinic)|\/clinical/.test(c.path))).toBe(false);
  });
  test(`UX03 sin próxima cita ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 }); await fixture(page, { noAppointment: true }); await page.goto('/'); await expect(page.getByRole('link', { name: 'Reservar un horario' })).toBeVisible(); await shot(page, 'dashboard-empty', width);
  });
}

test('UX03 cambiar servicio/profesional/fecha invalida horarios y conserva motivo', async ({ page }) => {
  const { calls } = await fixture(page); await page.goto('/appointments?create=1'); await toReview(page);
  await page.getByLabel('Motivo (opcional)').fill('Texto conservado'); await page.getByRole('button', { name: 'Anterior', exact: true }).click();
  await page.getByLabel('Dentista', { exact: true }).selectOption('8'); await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '09:00–09:30' }).click(); await page.getByLabel('Día', { exact: true }).fill('21/10/2026'); await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '09:00–09:30' }).click(); await page.getByRole('button', { name: 'Anterior', exact: true }).click(); await page.getByRole('radio', { name: /Limpieza dental/ }).check(); await page.getByRole('button', { name: 'Continuar', exact: true }).click(); await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '09:00–10:00' }).click(); await page.getByRole('button', { name: 'Continuar', exact: true }).click(); await expect(page.getByLabel('Motivo (opcional)')).toHaveValue('Texto conservado'); await page.getByRole('button', { name: 'Confirmar solicitud' }).click(); await expect(page.getByRole('heading', { name: 'Tu cita está reservada' })).toBeVisible();
  expect(calls.find(c => c.method === 'POST' && c.path === '/api/appointments')?.body).toMatchObject({ patientId: 4, serviceId: 2, dentistId: 8, startAt: '2026-10-21T15:00:00Z', endAt: '2026-10-21T16:00:00Z', reason: 'Texto conservado' });
});

test('UX03 conflicto 409 vuelve a horarios sin confirmar automáticamente', async ({ page }) => {
  const { calls } = await fixture(page, { conflict: true }); await page.goto('/appointments?create=1'); await toReview(page); await page.getByRole('button', { name: 'Confirmar solicitud' }).click(); await expect(page.getByRole('alert')).toContainText('Ese horario ya fue tomado'); await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled(); expect(calls.filter(c => c.path === '/api/appointments' && c.method === 'POST')).toHaveLength(1);
});
test('UX03 no reutiliza disponibilidad agotada al confirmar', async ({ page }) => {
  const { state, calls } = await fixture(page); await page.goto('/appointments?create=1'); await toReview(page); state.noSlots = true; await page.getByRole('button', { name: 'Confirmar solicitud' }).click(); await expect(page.getByRole('alert')).toContainText('Ese horario ya no está disponible'); expect(calls.filter(c => c.method === 'POST' && c.path === '/api/appointments')).toHaveLength(0);
});
test('UX03 doble confirmación bloqueada y replay incierto conserva clave y payload', async ({ page }) => {
  const { calls, release } = await fixture(page, { delayPost: true, uncertain: true }); await page.goto('/appointments?create=1'); await toReview(page); await page.getByRole('button', { name: 'Confirmar solicitud' }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); }); await expect.poll(() => calls.filter(c => c.path === '/api/appointments' && c.method === 'POST').length).toBe(1); await expect(page.getByRole('button', { name: 'Confirmando reserva…' })).toBeDisabled(); release(); await expect(page.getByRole('button', { name: 'Comprobar mi reserva' })).toBeVisible(); await page.getByRole('button', { name: 'Comprobar mi reserva' }).click(); await expect(page.getByRole('heading', { name: 'Tu cita está reservada' })).toBeVisible(); const posts = calls.filter(c => c.path === '/api/appointments' && c.method === 'POST'); expect(posts).toHaveLength(2); expect(posts[0]!.key).toBeTruthy(); expect(posts[1]!.key).toBe(posts[0]!.key); expect(posts[1]!.body).toEqual(posts[0]!.body);
});
test('UX03 servicios vacíos, disponibilidad vacía y error no fabrican opciones', async ({ page }) => {
  const { state } = await fixture(page, { noServices: true, noSlots: true }); await page.goto('/appointments?create=1'); await expect(page.getByText(/No hay servicios activos/)).toBeVisible(); await expect(page.getByRole('radio')).toHaveCount(0); state.noServices = false; await page.reload(); await toSchedule(page); await expect(page.getByText(/Sin horarios disponibles/)).toBeVisible(); await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
});
test('UX03 cancelación y reprogramación preservan ocurrencia y duración', async ({ page }) => {
  const { calls } = await fixture(page); await page.goto('/appointments/7'); await page.getByRole('button', { name: 'Reprogramar', exact: true }).click(); await page.getByRole('button', { name: '11:00–11:30' }).click(); await page.getByRole('button', { name: 'Confirmar reprogramación' }).click(); await expect(page.getByText('Cita reprogramada.', { exact: true })).toBeVisible(); expect(calls.find(c => c.path.endsWith('/reschedule'))?.body).toMatchObject({ expectedOccurrenceVersion: 1 }); await page.getByRole('button', { name: 'Cancelar', exact: true }).click(); await page.getByRole('button', { name: 'Sí, cancelar' }).click(); await expect(page.getByText('Cita cancelada.', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Reprogramar', exact: true })).toHaveCount(0);
});
test('UX03 teclado, zoom de texto, contraseña y logout seguro', async ({ page }) => {
  const { calls } = await fixture(page); await page.setViewportSize({ width: 390, height: 960 }); await page.goto('/'); await expect(page.getByRole('heading', { name: 'Tu atención dental' })).toBeVisible(); await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Ir al contenido', exact: true })).toBeFocused(); await page.keyboard.press('Enter'); await expect(page.getByRole('main')).toBeFocused(); await page.addStyleTag({ content: 'html { font-size: 200%; }' }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.goto('/change-password'); await page.getByLabel('Contraseña actual', { exact: true }).fill('Anterior'); await page.getByLabel('Nueva contraseña', { exact: true }).fill('Nueva'); await page.getByLabel('Repite la nueva contraseña', { exact: true }).fill('Nueva'); await page.getByRole('button', { name: 'Cambiar contraseña', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible(); expect(calls.some(c => c.path === '/api/auth/password/change')).toBe(true);
});
test('UX03 errores de citas y notificaciones son recuperables', async ({ page }) => {
  await fixture(page, { failure: '/api/appointments' }); await page.goto('/appointments'); await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('button', { name: /Reintentar citas/ })).toBeVisible();
});

test('UX03 reserva por teclado y fecha parcial o imposible sin horario residual', async ({ page }) => {
  const { calls } = await fixture(page);
  await page.goto('/appointments?create=1');
  const service = page.getByRole('radio', { name: 'Consulta de valoración', exact: true });
  await service.focus(); await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Continuar', exact: true }).focus(); await page.keyboard.press('Enter');
  await page.getByLabel('Dentista', { exact: true }).focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  const day = page.getByLabel('Día', { exact: true });
  await day.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace'); await page.keyboard.type('20/10/2026');
  const slot = page.getByRole('button', { name: '09:00–09:30', exact: true });
  await slot.focus(); await page.keyboard.press('Space');
  for (const invalid of ['20/10/202', '31/02/2026']) {
    await day.fill(invalid);
    await expect(day).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
    await expect(slot).toHaveCount(0);
  }
  await day.fill('20/10/2026'); await slot.focus(); await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Continuar', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Revisa y confirma' })).toBeFocused();
  await page.getByRole('button', { name: 'Confirmar solicitud' }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Tu cita está reservada' })).toBeFocused();
  expect(calls.filter(c => c.path === '/api/appointments' && c.method === 'POST')).toHaveLength(1);
});
