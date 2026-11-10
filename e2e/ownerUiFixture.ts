import type { Page } from '@playwright/test';

export const NOW = '2026-10-26T07:00:00Z';
const days = Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, open: true, startTime: '09:00:00', endTime: '17:00:00', breaks: [] }));
const service = { id: 1, name: 'Consulta de prueba', durationMinutes: 60, referencePrice: '100.00', active: true };
const visit = { id: 20, patientId: 4, patientUserId: 10, patientFirstName: 'Paciente', patientLastName: 'Propio', dentistId: 7,
  dentistFirstName: 'Ana', dentistLastName: 'Propietaria', startAt: '2026-10-26T09:00:00Z', endAt: '2026-10-26T10:00:00Z',
  durationMinutes: 60, status: 'SCHEDULED', occurrenceVersion: 1, createdByUserId: 1, createdAt: NOW, service };
const empty = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
export async function ownerUiFixture(page: Page, role = 'OWNER', state = 'populated') {
  await page.clock.setFixedTime(new Date(NOW));
  const calls: { path: string; params: URLSearchParams; method: string; body: Record<string, unknown> | null }[] = [];
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
    const input = request.postData() ? request.postDataJSON() : null;
    calls.push({ path, params: url.searchParams, method, body: input });
    if (state === 'error' && path === '/api/appointments') { await route.fulfill({ status: 503, json: { message: 'Agenda no disponible' } }); return; }
    let body: unknown;
    if (path === '/api/auth/refresh') body = { accessToken: 'owner-ui-browser-fixture' };
    else if (path === '/api/auth/me') body = { id: role === 'PATIENT' ? 10 : 1, email: 'synthetic@example.test', role, active: true, createdAt: NOW,
      ...(role === 'PATIENT' ? { patientId: 4, medicalOnboarding: { requirement: 'EXEMPT_EXISTING', progress: 'NOT_STARTED', pending: false } } : { dentistId: 7 }) };
    else if (path === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (path === '/api/notifications/unread-count') body = { unread: 1 };
    else if (path === '/api/notifications') body = { ...empty, content: [{ id: 1, title: 'Aviso de prueba', body: 'Notificación sintética de la cuenta.', read: false, createdAt: NOW }], totalElements: 1, totalPages: 1 };
    else if (path === '/api/clinic') body = { name: 'Clínica de prueba', timezone: 'UTC', address: '', email: '', phone: '' };
    else if (path === '/api/availability/policy') body = { timezone: 'UTC', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 };
    else if (path === '/api/public/schedule') body = { timezone: 'UTC', days, exceptions: [], dentists: [
      { dentistId: 8, firstName: 'Otro', lastName: 'Profesional', days }, { dentistId: 7, firstName: 'Ana', lastName: 'Propietaria', days },
    ] };
    else if (path === '/api/schedules/clinic') body = { timezone: 'UTC', days };
    else if (/\/schedules\/dentist\/\d+$/.test(path)) body = { dentistId: Number(path.split('/').at(-1)), timezone: 'UTC', days };
    else if (path.endsWith('/exceptions') || path.endsWith('/time-off') || path === '/api/users' || path.endsWith('/events') || path.endsWith('/notes') || path.endsWith('/treatments') || path.endsWith('/odontogram')) body = [];
    else if (path.endsWith('/clinical')) body = { patientId: 4, allergies: 'Sin alergias registradas' };
    else if (path.endsWith('/odontogram/at')) body = { teeth: [], context: null };
    else if (path === '/api/services' || path === '/api/public/services') body = [service];
    else if (path === '/api/patients') body = { ...empty, content: [{ id: 4, firstName: 'Paciente', lastName: 'Propio', active: true }], totalElements: 1, totalPages: 1 };
    else if (path === '/api/patients/4') body = { id: 4, firstName: 'Paciente', lastName: 'Propio', active: true };
    else if (path === '/api/availability') body = { dentistId: Number(url.searchParams.get('dentistId')), durationMinutes: 60, timezone: 'UTC', slots: [
      { startDate: '2026-10-26', startTime: '11:00:00', endTime: '12:00:00', start: '2026-10-26T11:00:00Z', end: '2026-10-26T12:00:00Z' },
    ] };
    else if (path === '/api/appointments' && method === 'POST') { await route.fulfill({ status: 201, json: { ...visit, ...input } }); return; }
    else if (path === '/api/appointments') {
      const content = state === 'empty' ? [] : [visit, ...(['COMPLETED', 'CANCELLED', 'NO_SHOW', 'SCHEDULED'] as const).map((status, i) => ({ ...visit, id: 21 + i, dentistId: 8, patientLastName: `Del equipo ${i + 1}`, status, startAt: `2026-10-26T${11 + i}:00:00Z`, endAt: `2026-10-26T${12 + i}:00:00Z` }))]
        .filter(a => (!url.searchParams.has('dentistId') || String(a.dentistId) === url.searchParams.get('dentistId')) && (!url.searchParams.has('status') || a.status === url.searchParams.get('status')));
      const size = Number(url.searchParams.get('size') ?? 20);
      body = { ...empty, size, content: content.slice(0, size), totalElements: content.length, totalPages: Math.ceil(content.length / size) };
    } else if (path === '/api/appointments/20') body = visit;
    else if (path === '/api/feedback') body = { ...empty, count: 0, average: null };
    else if (path === '/api/financial/reports/portfolio') body = { pendingBalance: '2450.50', statusCounts: { pendiente: 2, parcial: 1, pagado: 0, anulado: 0 } };
    else if (path === '/api/financial/reports/cash-flow') body = { grossAmount: '1800.00', netAmount: '1700.00', reversalAmount: '100.00' };
    else if (path === '/api/financial/charges') body = empty;
    else if (path.includes('/medical-intake/declarations/latest')) { await route.fulfill({ status: 204 }); return; }
    else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ json: body });
  });
  return calls;
}
