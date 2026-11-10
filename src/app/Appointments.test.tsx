import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserDto } from '../api/auth';
import type { ScheduleExceptionDto, TimeOffDto } from '../api/scheduling';
import { cancelSessionRequests, tokenStore } from '../api/http';
import { appointmentsApi } from '../api/appointments';
import { NotificationBell } from '../components/notifications/NotificationBell';
import { notificationKeys } from '../components/notifications/notificationQueries';
import { AppointmentsPage } from '../components/appointments/AppointmentsPage';
import { AppointmentDetailPage } from '../components/appointments/AppointmentDetailPage';
import { useAuthStore } from './authStore';

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

function user(role: UserDto['role'], extra: { patientId?: number; dentistId?: number } = {}): UserDto {
  return {
    id: role === 'PATIENT' ? 1001 : 10,
    email: `${role.toLowerCase()}@clinica.com`,
    role,
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...(extra.patientId !== undefined ? { patientId: extra.patientId } : {}),
    ...(extra.dentistId !== undefined ? { dentistId: extra.dentistId } : {}),
  };
}

function localIso(year: number, month: number, day: number, hour: number, minute: number): string {
  return new Date(Date.UTC(year, month - 1, day, hour, minute)).toISOString();
}

function todayAt(hour: number, minute: number): string {
  const now = new Date();
  return localIso(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), hour, minute);
}

function todayLocalDate(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

const CLINIC_SCHEDULE = {
  timezone: 'UTC',
  days: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
    dayOfWeek,
    open: true,
    startTime: '09:00:00',
    endTime: '17:00:00',
    breaks: [{ startTime: '13:00:00', endTime: '14:00:00' }],
  })),
};

const PUBLIC = {
  timezone: 'UTC',
  days: [{ dayOfWeek: 1, open: true, startTime: '09:00:00', endTime: '17:00:00' }],
  exceptions: [],
  dentists: [
    { dentistId: 7, firstName: 'Ana', lastName: 'Uno', specialty: null, days: [] },
    { dentistId: 8, firstName: 'Luis', lastName: 'Dos', specialty: null, days: [] },
  ],
};

const AVAILABILITY = {
  dentistId: 7,
  durationMinutes: 30,
  timezone: 'UTC',
  slots: [
    {
      startDate: todayLocalDate(),
      startTime: '09:00:00',
      endTime: '09:30:00',
      start: todayAt(9, 0),
      end: todayAt(9, 30),
    },
  ],
};

const POLICY = {
  maxAdvanceDays: 90,
  minBookingLeadTimeHours: 2,
  cancellationLeadTimeHours: 12,
  timezone: 'UTC',
};

const SERVICES = [15, 30, 45, 60].map((durationMinutes) => ({
  id: durationMinutes, name: `Servicio de prueba ${durationMinutes}`, description: null,
  referencePrice: '75.1234', durationMinutes, active: true,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: null,
}));
SERVICES.push({ ...SERVICES[1]!, id: 31, name: 'Otro servicio de prueba 30' });

const PATIENTS = {
  content: [
    { id: 1, firstName: 'Ana', lastName: 'Pérez', email: 'ana@correo.com', active: true, createdAt: '2026-01-01T00:00:00Z' },
  ],
  page: 0,
  size: 20,
  totalElements: 1,
  totalPages: 1,
};

const APPT_BASE = {
  id: 7,
  patientId: 1,
  patientFirstName: 'Ana',
  patientLastName: 'Pérez',
  patientUserId: 1001,
  dentistId: 7,
  dentistFirstName: 'Ana',
  dentistLastName: 'Uno',
  startAt: todayAt(9, 0),
  endAt: todayAt(9, 30),
  durationMinutes: 30,
  status: 'SCHEDULED',
  occurrenceVersion: 1,
  createdByUserId: 111,
  reason: 'Revisión',
  createdAt: todayAt(8, 0),
};

const PAGE = {
  content: [APPT_BASE],
  page: 0,
  size: 100,
  totalElements: 1,
  totalPages: 1,
};

const EVENTS = [
  { id: 1, eventType: 'APPOINTMENT_CREATED', actorUserId: 111, occurrenceVersion: 1, createdAt: todayAt(8, 0) },
  { id: 2, eventType: 'PATIENT_ARRIVED', actorUserId: 7, occurrenceVersion: 1, createdAt: todayAt(9, 5) },
  { id: 3, eventType: 'APPOINTMENT_STARTED', actorUserId: 7, occurrenceVersion: 1, createdAt: todayAt(9, 10) },
];

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Table = Record<string, Fetcher>;

const DEFAULTS: Table = {
  'GET:/api/patients/1/clinical/appointments/7/trace': (input) => {
    const url = new URL(String(input), 'http://localhost');
    return Promise.resolve(response(200, { context: { appointmentId: 7, occurrenceVersion: Number(url.searchParams.get('occurrenceVersion')),
      currentOccurrenceVersion: 1, currentStatus: 'SCHEDULED', kind: 'CURRENT_UNFROZEN', timezone: 'UTC' },
      availableSections: ['NOTES', 'EVOLUTIONS'], section: url.searchParams.get('section'),
      results: { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 } }));
  },
  'GET:/api/patients/1/clinical/notes': () => Promise.resolve(response(200, [])),
  'GET:/api/patients/1/clinical': () => Promise.resolve(response(200, { patientId: 1 })),
  'GET:/api/services': () => Promise.resolve(response(200, SERVICES)),
  'GET:/api/public/services': () => Promise.resolve(response(200, SERVICES.map(({ id, name, description, referencePrice, durationMinutes }) => ({ id, name, description, referencePrice, durationMinutes })))),
  'GET:/api/appointments': () => Promise.resolve(response(200, useAuthStore.getState().user?.role === 'PATIENT' ? { ...PAGE, size: 10, content: [{ ...APPT_BASE, patientId: useAuthStore.getState().user?.patientId }] } : PAGE)),
  'GET:/api/appointments/7/events': () => Promise.resolve(response(200, EVENTS)),
  'GET:/api/appointments/7': () => Promise.resolve(response(200, APPT_BASE)),
  'GET:/api/public/schedule': () => Promise.resolve(response(200, PUBLIC)),
  'GET:/api/schedules/clinic': () => Promise.resolve(response(200, CLINIC_SCHEDULE)),
  'GET:/api/schedules/dentist/': (input) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    return Promise.resolve(response(200, path.endsWith('/exceptions') || path.endsWith('/time-off')
      ? [] : { ...CLINIC_SCHEDULE, dentistId: Number(path.split('/')[4]) }));
  },
  'GET:/api/availability/policy': () => Promise.resolve(response(200, POLICY)),
  'GET:/api/availability': (input) => Promise.resolve(response(200, { ...AVAILABILITY, dentistId: Number(new URL(String(input), 'http://localhost').searchParams.get('dentistId')) })),
  'GET:/api/patients': () => Promise.resolve(response(200, PATIENTS)),
};

function stub(overrides: Table = {}) {
  const table = { ...DEFAULTS, ...overrides };
  const sorted = Object.keys(table).sort((a, b) => b.length - a.length);
  const listUrls: string[] = [];
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.includes('/api/appointments') && !url.includes('/events')) {
      listUrls.push(url);
    }
    for (const key of sorted) {
      const sep = key.indexOf(':');
      const m = key.slice(0, sep);
      const segment = key.slice(sep + 1);
      if (m === method && url.includes(segment)) {
        return table[key](input, init);
      }
    }
    return Promise.reject(new Error(`Sin stub para ${method} ${url}`));
  });
  return { listUrls };
}

function renderAt(ui: ReactNode, path = '/appointments', client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path === '/appointments' && useAuthStore.getState().user?.role === 'PATIENT' ? `${path}?date=${todayLocalDate()}` : path]}>
        <Routes>
          <Route path="/appointments" element={ui} />
          <Route path="/appointments/:id" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}

async function waitForPageSettled() {
  await waitFor(() => expect(screen.queryByText('Cargando citas…')).not.toBeInTheDocument());
  await waitFor(() => {
    const dentist = screen.getByLabelText('Dentista') as HTMLSelectElement;
    expect(dentist.options.length).toBeGreaterThan(1);
    const patient = screen.queryByRole('combobox', { name: 'Paciente' });
    if (patient) {
      expect(patient).toBeEnabled();
    }
  });
  const service = screen.getByLabelText('Servicio') as HTMLSelectElement;
  await waitFor(() => expect(service.options.length).toBeGreaterThan(1));
  if (service.value === '') fireEvent.change(service, { target: { value: '30' } });
}

async function selectStaffPatient(id = '1') {
  fireEvent.focus(screen.getByRole('combobox', { name: 'Paciente' }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(`Paciente #${id}(?: ·|$)`) }));
}

async function openPatientBooking() {
  fireEvent.click(await screen.findByRole('link', { name: 'Reservar cita' }));
  await screen.findByRole('heading', { name: '¿Qué servicio necesitas?' });
}
async function patientService(id = '30') {
  fireEvent.click(await screen.findByRole('radio', { name: id === '31' ? /Otro servicio de prueba 30/ : new RegExp(`^Servicio de prueba ${id}$`) }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByLabelText('Dentista');
}
async function patientConfirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirmar solicitud' }));
}

beforeEach(() => {
  tokenStore.set(null);
  useAuthStore.setState({ status: 'authenticated', user: null });
});

describe('Citas — integracion del buzon T3.7', () => {
  const operations = [
    { name: 'crear', path: '/api/appointments', notice: 'Cita creada correctamente.', key: 'create' },
    { name: 'cancelar', path: '/api/appointments/7/cancel', notice: 'Cita cancelada.', key: 'cancel' },
    { name: 'reprogramar', path: '/api/appointments/7/reschedule', notice: 'Cita reprogramada.', key: 'reschedule' },
    { name: 'no-show', path: '/api/appointments/7/no-show', notice: 'No-show registrado.', key: 'no-show' },
  ];

  beforeEach(() => {
    cancelSessionRequests();
    useAuthStore.getState().queryClient.clear();
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER', { dentistId: 7 }) });
  });

  afterEach(() => {
    cleanup();
    cancelSessionRequests();
    useAuthStore.getState().queryClient.clear();
    vi.restoreAllMocks();
  });

  async function execute(key: string) {
    if (key === 'create') {
      await waitForPageSettled();
      await selectStaffPatient();
      fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
      fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
      fireEvent.click(screen.getByRole('button', { name: 'Reservar cita' }));
      return;
    }
    await screen.findByRole('heading', { name: 'Cita #7' });
    if (key === 'reschedule') {
      fireEvent.click(await screen.findByRole('button', { name: 'Reprogramar' }));
      fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar reprogramación' }));
      return;
    }
    const buttons: Record<string, [string, string?]> = {
      cancel: ['Cancelar', 'Sí, cancelar'],
      'no-show': ['Registrar no asistencia', 'Sí, no asistió'],
    };
    const [label, confirmation] = buttons[key]!;
    fireEvent.click(await screen.findByRole('button', { name: label }));
    if (confirmation) fireEvent.click(screen.getByRole('button', { name: confirmation }));
  }

  it.each(operations)('$name exitoso invalida solo el buzon propio y conserva las invalidaciones de citas', async (operation) => {
    const client = useAuthStore.getState().queryClient;
    client.setQueryData(notificationKeys.list(10), { content: [] });
    client.setQueryData(notificationKeys.list(20), { content: [] });
    client.setQueryData(notificationKeys.unreadCount(20), { unread: 9 });
    let succeeded = false;
    let counts = 0;
    stub({
      'GET:/api/appointments/7': () => Promise.resolve(response(200, { ...APPT_BASE, startAt: '2026-01-01T09:00:00Z' })),
      'GET:/api/notifications/unread-count': () => { counts += 1; return Promise.resolve(response(200, { unread: succeeded ? 6 : 5 })); },
      [`POST:${operation.path}`]: () => { succeeded = true; return Promise.resolve(response(200, APPT_BASE)); },
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderAt(<><NotificationBell />{operation.key === 'create' ? <AppointmentsPage /> : <AppointmentDetailPage />}</>,
      operation.key === 'create' ? '/appointments' : '/appointments/7', client);
    await screen.findByRole('link', { name: 'Notificaciones: 5 sin leer' });
    await execute(operation.key);
    await screen.findByText(operation.notice);
    await screen.findByRole('link', { name: 'Notificaciones: 6 sin leer' });
    const expected = operation.key === 'create'
      ? [['appointments'], ['availability'], notificationKeys.all(10)]
      : [['appointments'], ['availability'], ['appointment', 7], ['appointment-events', 7], notificationKeys.all(10)];
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(expected);
    expect(counts).toBe(2);
    expect(client.getQueryState(notificationKeys.list(10))?.isInvalidated).toBe(true);
    expect(client.getQueryState(notificationKeys.list(20))?.isInvalidated).toBe(false);
    expect(client.getQueryState(notificationKeys.unreadCount(20))?.isInvalidated).toBe(false);
  });

  it.each(operations)('$name fallido no invalida el buzon ni las consultas de citas', async (operation) => {
    const client = useAuthStore.getState().queryClient;
    let counts = 0;
    stub({
      'GET:/api/appointments/7': () => Promise.resolve(response(200, { ...APPT_BASE, startAt: '2026-01-01T09:00:00Z' })),
      'GET:/api/notifications/unread-count': () => { counts += 1; return Promise.resolve(response(200, { unread: 5 })); },
      [`POST:${operation.path}`]: () => Promise.resolve(response(409, { message: 'Operación rechazada.' })),
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderAt(<><NotificationBell />{operation.key === 'create' ? <AppointmentsPage /> : <AppointmentDetailPage />}</>,
      operation.key === 'create' ? '/appointments' : '/appointments/7', client);
    await screen.findByRole('link', { name: 'Notificaciones: 5 sin leer' });
    await execute(operation.key);
    expect(await screen.findByRole('alert')).toHaveTextContent('Operación rechazada.');
    expect(invalidate).not.toHaveBeenCalled();
    expect(counts).toBe(1);
    expect(screen.getByRole('link', { name: 'Notificaciones: 5 sin leer' })).toBeInTheDocument();
  });

  it.each([10, 20])('un exito tardio de cita no invalida buzones tras cambiar a una sesion del usuario %s', async (id) => {
    let resolve!: (value: typeof APPT_BASE) => void;
    const pending = new Promise<typeof APPT_BASE>((done) => { resolve = done; });
    // Verifica la proteccion adicional de invalidacion incluso con un API que no cancela su respuesta.
    vi.spyOn(appointmentsApi, 'cancel').mockReturnValue(pending as ReturnType<typeof appointmentsApi.cancel>);
    const nextUser = { ...user('OWNER', { dentistId: 7 }), id };
    stub({
      'POST:/api/auth/logout': () => Promise.resolve(response(204)),
      'POST:/api/auth/login': () => Promise.resolve(response(200, { accessToken: 'next', user: nextUser })),
      'GET:/api/auth/me': () => Promise.resolve(response(200, nextUser)),
    });
    const oldClient = useAuthStore.getState().queryClient;
    const view = renderAt(<AppointmentDetailPage />, '/appointments/7', oldClient);
    await execute('cancel');
    await waitFor(() => expect(appointmentsApi.cancel).toHaveBeenCalledTimes(1));
    const mutation = oldClient.getMutationCache().getAll()[0]!;
    view.unmount();
    await useAuthStore.getState().logout();
    await useAuthStore.getState().login(nextUser.email, 'password');
    const newClient = useAuthStore.getState().queryClient;
    const oldInvalidate = vi.spyOn(oldClient, 'invalidateQueries');
    const newInvalidate = vi.spyOn(newClient, 'invalidateQueries');
    await act(async () => { resolve(APPT_BASE); });
    await waitFor(() => expect(mutation.state.status).toBe('success'));
    expect(oldInvalidate.mock.calls.some(([filters]) => filters?.queryKey?.[0] === 'notifications')).toBe(false);
    expect(newInvalidate).not.toHaveBeenCalled();
  });
});

describe('Citas — servicios obligatorios F7.3', () => {
  it.each(['OWNER', 'DENTIST', 'RECEPTIONIST', 'PATIENT'] as const)('%s selecciona servicio activo y envía solo su id, no precio ni duración', async (role) => {
    useAuthStore.setState({ user: user(role, role === 'PATIENT' ? { patientId: 5 } : { dentistId: 7 }) });
    const posts: Array<Record<string, unknown>> = [];
    const availabilityUrls: string[] = [];
    stub({
      'GET:/api/availability': (input) => { availabilityUrls.push(String(input)); return Promise.resolve(response(200, AVAILABILITY)); },
      'POST:/api/appointments': (_input, init) => { posts.push(JSON.parse(String(init?.body))); return Promise.resolve(response(201, APPT_BASE)); },
    });
    renderAt(<AppointmentsPage />);
    if (role === 'PATIENT') {
      await openPatientBooking();
      expect(availabilityUrls).toEqual([]);
      expect((await screen.findAllByRole('radio')).every(radio => !(radio as HTMLInputElement).checked)).toBe(true);
      await patientService();
    } else {
      const select = await screen.findByLabelText('Servicio');
      await waitFor(() => expect(select).toBeEnabled());
      expect(select).toHaveValue('');
      expect(availabilityUrls).toEqual([]);
      fireEvent.change(select, { target: { value: '30' } });
    }
    if (role !== 'PATIENT') {
      await selectStaffPatient();
    }
    if (role !== 'DENTIST') fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    expect(screen.queryByLabelText('Duración')).not.toBeInTheDocument();
    expect(screen.getByText(/30 minutos/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    if (role === 'PATIENT') await patientConfirm(); else fireEvent.click(screen.getByRole('button', { name: 'Reservar cita' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ serviceId: 30, patientId: role === 'PATIENT' ? 5 : 1, dentistId: 7 });
    expect(posts[0]).not.toHaveProperty('duration'); expect(posts[0]).not.toHaveProperty('referencePrice');
    expect(availabilityUrls.every((url) => new URL(url, 'http://localhost').searchParams.get('serviceId') === '30')).toBe(true);
    expect(availabilityUrls.every((url) => !new URL(url, 'http://localhost').searchParams.has('duration'))).toBe(true);
  });

  it.each(['OWNER', 'DENTIST', 'RECEPTIONIST', 'PATIENT'] as const)('%s no puede reservar con catálogo vacío y recibe una acción apropiada', async (role) => {
    useAuthStore.setState({ user: user(role, role === 'PATIENT' ? { patientId: 5 } : { dentistId: 7 }) });
    let availabilityCalls = 0;
    stub({
      'GET:/api/services': () => Promise.resolve(response(200, [])),
      'GET:/api/public/services': () => Promise.resolve(response(200, [])),
      'GET:/api/availability': () => { availabilityCalls++; return Promise.resolve(response(200, AVAILABILITY)); },
    });
    renderAt(<AppointmentsPage />);
    if (role === 'PATIENT') await openPatientBooking();
    expect(await screen.findByText(/No hay servicios activos/)).toBeInTheDocument();
    if (role === 'PATIENT') expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled(); else expect(screen.getByLabelText('Servicio')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Reservar cita|Confirmar solicitud/ })).not.toBeInTheDocument();
    expect(availabilityCalls).toBe(0);
    if (role === 'OWNER') expect(screen.getByRole('link', { name: 'Gestionar servicios' })).toHaveAttribute('href', '/services');
    else expect(screen.queryByRole('link', { name: 'Gestionar servicios' })).not.toBeInTheDocument();
  });

  it('cambiar de servicio cambia la disponibilidad autoritativa y exige un nuevo slot', async () => {
    useAuthStore.setState({ user: user('OWNER') });
    const posts: Array<Record<string, unknown>> = [];
    stub({
      'GET:/api/availability': (input) => {
        const serviceId = Number(new URL(String(input), 'http://localhost').searchParams.get('serviceId'));
        return Promise.resolve(response(200, { ...AVAILABILITY, durationMinutes: serviceId,
          slots: [{ ...AVAILABILITY.slots[0], endTime: serviceId === 60 ? '10:00:00' : '09:30:00',
            end: serviceId === 60 ? todayAt(10, 0) : todayAt(9, 30) }] }));
      },
      'POST:/api/appointments': (_input, init) => { posts.push(JSON.parse(String(init?.body))); return Promise.resolve(response(201, APPT_BASE)); },
    });
    renderAt(<AppointmentsPage />); await waitForPageSettled();
    await selectStaffPatient();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: '60' } });
    expect(screen.queryByRole('button', { name: 'Reservar cita' })).not.toBeInTheDocument();
    expect(screen.getByText('60 minutos')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '09:00–10:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reservar cita' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ serviceId: 60, endAt: todayAt(10, 0) });
  });

  it('si el servicio desaparece durante un refetch invalida la selección y bloquea submit', async () => {
    useAuthStore.setState({ user: user('OWNER') });
    let services = SERVICES;
    stub({ 'GET:/api/services': () => Promise.resolve(response(200, services)) });
    const { client } = renderAt(<AppointmentsPage />); await waitForPageSettled();
    await selectStaffPatient();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    services = SERVICES.filter((item) => item.id !== 30);
    await act(async () => { await client.invalidateQueries({ queryKey: ['services'] }); });
    expect(await screen.findByText(/El servicio seleccionado ya no está disponible/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reservar cita' })).not.toBeInTheDocument();
  });

  it('una respuesta de duración distinta avisa y no habilita una reserva con datos obsoletos', async () => {
    useAuthStore.setState({ user: user('OWNER') });
    stub({ 'GET:/api/availability': () => Promise.resolve(response(200, { ...AVAILABILITY, durationMinutes: 60 })) });
    renderAt(<AppointmentsPage />); await waitForPageSettled();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    expect(await screen.findByText(/La duración del servicio cambió/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '09:00–09:30' })).not.toBeInTheDocument();
  });

  it('detalle conserva el snapshot de referencia y reprograma por appointmentId, sin consultar el catálogo', async () => {
    useAuthStore.setState({ user: user('OWNER') });
    const requests: string[] = [];
    stub({
      'GET:/api/appointments/7': () => Promise.resolve(response(200, { ...APPT_BASE, service: { id: 99, name: 'Servicio histórico', description: null, referencePrice: '99.1234', durationMinutes: 30 } })),
      'GET:/api/availability': (input) => { requests.push(String(input)); return Promise.resolve(response(200, AVAILABILITY)); },
    });
    renderAt(<AppointmentDetailPage />, '/appointments/7');
    expect(await screen.findByText('Servicio histórico · 30 min')).toBeInTheDocument();
    expect(screen.getByText(/99,1234/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reprogramar' }));
    await waitFor(() => expect(requests).toHaveLength(1));
    const params = new URL(requests[0]!, 'http://localhost').searchParams;
    expect(params.get('appointmentId')).toBe('7');
    expect(params.has('serviceId')).toBe(false); expect(params.has('duration')).toBe(false);
  });
});

describe('Citas — excepciones y bloqueos H-A08', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
    useAuthStore.setState({ user: user('OWNER', { dentistId: 7 }) });
  });
  afterEach(() => vi.useRealTimers());

  function fixture(options: {
    day?: string; clinicException?: ScheduleExceptionDto; dentistException?: ScheduleExceptionDto;
    off?: TimeOffDto[]; appointmentHour?: number; slotHour?: number | null; contextError?: boolean;
  } = {}) {
    const day = options.day ?? '2026-10-12';
    const hour = options.appointmentHour ?? 9;
    const instant = (value: number) => `${day}T${String(value - 2).padStart(2, '0')}:00:00Z`;
    const start = instant(hour);
    const clinic = { ...CLINIC_SCHEDULE, timezone: 'Europe/Madrid', days: CLINIC_SCHEDULE.days.map((entry) => ({
      ...entry, open: entry.dayOfWeek !== 7, startTime: entry.dayOfWeek === 7 ? null : '09:00:00',
      endTime: entry.dayOfWeek === 7 ? null : '17:00:00',
    })) };
    const privateReads: string[] = [];
    const posts: Array<Record<string, unknown>> = [];
    stub({
      'GET:/api/public/schedule': () => Promise.resolve(response(200, {
        ...PUBLIC, timezone: 'Europe/Madrid', exceptions: options.clinicException ? [options.clinicException] : [],
      })),
      'GET:/api/schedules/clinic': () => Promise.resolve(response(200, clinic)),
      'GET:/api/appointments': () => Promise.resolve(response(200, { ...PAGE, content: [{
        ...APPT_BASE, startAt: start, endAt: new Date(new Date(start).getTime() + 30 * 60_000).toISOString(),
      }] })),
      'GET:/api/schedules/dentist/': (input) => {
        const path = new URL(String(input), 'http://localhost').pathname;
        privateReads.push(path);
        if (options.contextError) return Promise.resolve(response(404, { message: 'No encontrado' }));
        const dentistId = Number(path.split('/')[4]);
        if (path.endsWith('/exceptions')) return Promise.resolve(response(200, options.dentistException ? [options.dentistException] : []));
        if (path.endsWith('/time-off')) return Promise.resolve(response(200, options.off ?? []));
        return Promise.resolve(response(200, { ...clinic, dentistId, days: clinic.days.map((entry) => ({
          ...entry, breaks: [{ startTime: '11:00:00', endTime: '12:00:00' }],
        })) }));
      },
      'GET:/api/availability': () => {
        const value = options.slotHour === undefined ? 9 : options.slotHour;
        return Promise.resolve(response(200, { ...AVAILABILITY, timezone: 'Europe/Madrid', slots: value === null ? [] : [{
          ...AVAILABILITY.slots[0], startDate: day, startTime: `${String(value).padStart(2, '0')}:00:00`,
          endTime: `${String(value).padStart(2, '0')}:30:00`, start: instant(value),
          end: new Date(new Date(instant(value)).getTime() + 30 * 60_000).toISOString(),
        }] }));
      },
      'POST:/api/appointments': (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        posts.push(body);
        return Promise.resolve(response(201, { ...APPT_BASE, ...body }));
      },
    });
    return { day, privateReads, posts };
  }

  async function openDay(day: string) {
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: day } });
    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
  }

  it('representa una apertura especial en domingo cerrado semanalmente y conserva el slot del backend', async () => {
    const exception = { date: '2026-10-11', closed: false, startTime: '18:00:00', endTime: '20:00:00' };
    const { day, posts } = fixture({ day: exception.date, clinicException: exception, dentistException: exception, appointmentHour: 19, slotHour: 18 });
    await openDay(day);
    const agenda = await screen.findByRole('region', { name: 'Agenda de Ana Uno' });
    expect(await within(agenda).findByRole('button', { name: 'Cita con Ana Pérez a las 19:00 Programada' })).toBeInTheDocument();
    const slot = within(agenda).getByRole('button', { name: 'Reservar 18:00-18:30' });
    expect(slot).toHaveStyle({ top: '0px' });
    expect(screen.queryByText('La clínica no atiende este día.')).not.toBeInTheDocument();
    await selectStaffPatient();
    fireEvent.click(slot);
    expect(await screen.findByText('Seleccionado: 18:00–18:30')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reservar cita' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reservar cita' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ dentistId: 7, patientId: 1, startAt: '2026-10-11T16:00:00Z', endAt: '2026-10-11T16:30:00.000Z' });
  });

  it('un feriado prevalece sobre la semana y no oculta las citas existentes ni inventa reservas', async () => {
    const { day } = fixture({ clinicException: { date: '2026-10-12', closed: true }, slotHour: null });
    await openDay(day);
    expect(await screen.findByText('La clínica no atiende este día.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Abrir cita de Ana Pérez a las 09:00 Programada/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reservar \d/ })).not.toBeInTheDocument();
  });

  it.each([true, false])('semana y mes identifican la excepción de clínica (cerrada=%s) sin ocultar citas', async (closed) => {
    const { day } = fixture({ clinicException: { date: '2026-10-12', closed, startTime: '09:00:00', endTime: '17:00:00' } });
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: day } });
    const label = closed ? 'Clínica cerrada' : 'Apertura especial: 09:00–17:00';
    for (const view of ['Semana', 'Mes']) {
      fireEvent.click(screen.getByRole('button', { name: view }));
      const cellButton = await screen.findByRole('button', { name: /^Ver 1 cita del lunes, 12/ });
      const cell = screen.getByRole('region', { name: view === 'Mes' ? 'Agenda mensual' : /lunes, 12 de octubre/ });
      if (view === 'Mes') {
        expect(cellButton).toHaveAttribute('title', label);
        fireEvent.click(cellButton);
        expect(within(screen.getByRole('region', { name: 'Citas del día seleccionado' })).getByText(label)).toBeInTheDocument();
      } else expect(within(cell).getByText(label)).toBeInTheDocument();
      const visit = await within(view === 'Mes' ? screen.getByRole('region', { name: 'Citas del día seleccionado' }) : cell).findByRole(view === 'Semana' ? 'link' : 'button', { name: /(?:Cita con|Abrir cita de) Ana Pérez/ });
      expect(visit.closest('li')).toHaveTextContent('09:00');
      expect(visit).toHaveTextContent('Programada');
    }
  });

  it('etiqueta descansos y ausencia parcial sin convertirlos en botones de reserva', async () => {
    const { day } = fixture({ off: [{ id: 30, startDate: '2026-10-12', endDate: '2026-10-12', allDay: false, startTime: '15:00:00', endTime: '16:00:00' }] });
    await openDay(day);
    const agenda = within(await screen.findByRole('region', { name: 'Agenda de Ana Uno' }));
    for (const label of ['Descanso de clínica: 13:00–14:00', 'Descanso del odontólogo: 11:00–12:00', 'Ausencia: 15:00–16:00']) {
      expect(await agenda.findByText(label)).toBeInTheDocument();
      expect(agenda.getByText(label).closest('button')).toBeNull();
    }
    expect(agenda.getAllByRole('button', { name: /^Reservar / })).toHaveLength(1);
    expect(agenda.getByRole('button', { name: 'Reservar 09:00-09:30' })).toBeInTheDocument();
  });

  it.each(['ausencia', 'cierre'] as const)('representa %s de día completo, incluyendo el último día del rango, y conserva citas', async (kind) => {
    const { day } = fixture({ slotHour: null, ...(kind === 'ausencia'
      ? { off: [{ id: 30, startDate: '2026-10-11', endDate: '2026-10-12', allDay: true }] }
      : { dentistException: { date: '2026-10-12', closed: true } }) });
    await openDay(day);
    const agenda = within(await screen.findByRole('region', { name: 'Agenda de Ana Uno' }));
    expect(await agenda.findByText(kind === 'ausencia' ? 'Ausencia (todo el día)' : 'Cierre del odontólogo')).toBeInTheDocument();
    expect(agenda.getByRole('button', { name: 'Cita con Ana Pérez a las 09:00 Programada' })).toBeInTheDocument();
    expect(agenda.queryByRole('button', { name: /^Reservar / })).not.toBeInTheDocument();
  });

  it('ajusta el eje a la excepción y a las citas existentes fuera de la ventana actual', async () => {
    const exception = { date: '2026-10-12', closed: false, startTime: '18:00:00', endTime: '20:00:00' };
    const { day } = fixture({ clinicException: exception, dentistException: exception, appointmentHour: 21, slotHour: 18 });
    await openDay(day);
    const agenda = within(await screen.findByRole('region', { name: 'Agenda de Ana Uno' }));
    const chip = agenda.getByRole('button', { name: 'Cita con Ana Pérez a las 21:00 Programada' });
    expect(chip.parentElement!.parentElement).toHaveStyle({ height: '420px' });
    expect(chip.parentElement).toHaveStyle({ top: '360px' });
    expect(await agenda.findByText('Fuera de horario de clínica')).toBeInTheDocument();
  });

  it('informa de contexto no disponible sin deducir ausencias ni fabricar slots', async () => {
    const { day } = fixture({ contextError: true });
    await openDay(day);
    const agenda = within(await screen.findByRole('region', { name: 'Agenda de Ana Uno' }));
    expect(await agenda.findByText('No se pudo consultar el contexto horario.')).toBeInTheDocument();
    expect(agenda.getByRole('button', { name: 'Cita con Ana Pérez a las 09:00 Programada' })).toBeInTheDocument();
    expect(agenda.queryByText('Ausencia (todo el día)')).not.toBeInTheDocument();
    expect(agenda.getAllByRole('button', { name: /^Reservar / })).toHaveLength(1);
  });

  it.each(['OWNER', 'DENTIST', 'RECEPTIONIST', 'PATIENT'] as const)('%s solo lee contexto privado autorizado y no modifica excepciones desde la agenda', async (role) => {
    useAuthStore.setState({ user: user(role, role === 'PATIENT' ? { patientId: 1 } : { dentistId: 7 }) });
    const { day, privateReads } = fixture({ day: role === 'PATIENT' ? '2026-10-10' : '2026-10-12' });
    if (role === 'PATIENT') {
      stub({ 'GET:/api/appointments': () => Promise.resolve(response(200, { ...PAGE, size: 10, content: [{ ...APPT_BASE, startAt: `${day}T07:00:00Z`, endAt: `${day}T07:30:00Z` }] })) });
      renderAt(<AppointmentsPage />);
      expect(await screen.findByText('Odontólogo: Ana Uno')).toBeInTheDocument();
      expect(privateReads).toEqual([]);
      expect(screen.queryByText('Descanso de clínica: 13:00–14:00')).not.toBeInTheDocument();
    } else {
      await openDay(day);
      const agenda = within(await screen.findByRole('region', { name: role === 'DENTIST' ? 'Agenda del día' : 'Agenda de Ana Uno' }));
      expect(await agenda.findByText('Descanso del odontólogo: 11:00–12:00')).toBeInTheDocument();
      expect(privateReads.length).toBeGreaterThan(0);
      if (role === 'DENTIST') expect(privateReads.every((path) => path.startsWith('/api/schedules/dentist/7'))).toBe(true);
      else expect(privateReads.some((path) => path.startsWith('/api/schedules/dentist/8'))).toBe(true);
    }
    expect(screen.queryByRole('button', { name: /Eliminar excepción|Guardar excepción|Añadir ausencia/ })).not.toBeInTheDocument();
  });
});

describe('Citas — alcance administrativo H-A04', () => {
  const otherAppointment = {
    ...APPT_BASE, id: 8, dentistId: 8, dentistFirstName: 'Luis', dentistLastName: 'Dos',
    patientId: 2, patientFirstName: 'Marta', patientLastName: 'Gómez', patientUserId: 1002,
  };

  function scopedBackend() {
    const posts: Array<Record<string, unknown>> = [];
    const availabilityDentists: string[] = [];
    const { listUrls } = stub({
      'GET:/api/appointments': (input) => {
        const dentist = new URL(String(input), 'http://localhost').searchParams.get('dentistId');
        const content = [APPT_BASE, otherAppointment].filter((appointment) =>
          dentist === null || appointment.dentistId === Number(dentist));
        return Promise.resolve(response(200, { ...PAGE, content, totalElements: content.length }));
      },
      'GET:/api/availability': (input) => {
        const dentist = new URL(String(input), 'http://localhost').searchParams.get('dentistId')!;
        availabilityDentists.push(dentist);
        return Promise.resolve(response(200, { ...AVAILABILITY, dentistId: Number(dentist) }));
      },
      'POST:/api/appointments': (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        posts.push(body);
        return Promise.resolve(response(201, { ...APPT_BASE, ...body }));
      },
    });
    return { listUrls, posts, availabilityDentists };
  }

  it.each([
    { label: 'OWNER sin perfil', actor: user('OWNER') },
    { label: 'OWNER con perfil', actor: user('OWNER', { dentistId: 7 }) },
    { label: 'RECEPTIONIST', actor: user('RECEPTIONIST') },
  ])('$label puede consultar todos, filtrar otro profesional y reservar con él', async ({ actor }) => {
    useAuthStore.setState({ status: 'authenticated', user: actor });
    const { listUrls, posts, availabilityDentists } = scopedBackend();
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    const filter = screen.getByLabelText('Filtrar por dentista');
    const bookingDentist = screen.getByLabelText('Dentista');
    expect(filter).toBeEnabled();
    expect(filter).toHaveValue('');
    expect(bookingDentist).toBeEnabled();
    expect(bookingDentist).toHaveValue('');
    expect(await screen.findByRole('link', { name: /^Cita con Marta Gómez a las 09:00 Programada/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Cita con Ana Pérez a las 09:00 Programada/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    expect(await screen.findByRole('region', { name: 'Agenda de Luis Dos' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Agenda de Ana Uno' })).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: '8' } });
    await waitFor(() => expect(new URL(listUrls.at(-1)!, 'http://localhost').searchParams.get('dentistId')).toBe('8'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cita con Ana Pérez a las 09:00 Programada' })).not.toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Agenda de Ana Uno' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cita con Marta Gómez a las 09:00 Programada' })).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: '' } });
    await waitFor(() => expect(new URL(listUrls.at(-1)!, 'http://localhost').searchParams.has('dentistId')).toBe(false));
    expect(await screen.findByRole('button', { name: 'Cita con Ana Pérez a las 09:00 Programada' })).toBeInTheDocument();

    await selectStaffPatient();
    fireEvent.change(bookingDentist, { target: { value: '8' } });
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reservar cita' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(availabilityDentists).toContain('8');
    expect(posts[0]).toMatchObject({ patientId: 1, dentistId: 8, startAt: todayAt(9, 0), endAt: todayAt(9, 30) });
  });

  it('OWNER con dentistId no envía un filtro propio implícito al abrir la agenda', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER', { dentistId: 7 }) });
    const { listUrls } = scopedBackend();
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    await waitFor(() => expect(listUrls.length).toBeGreaterThan(0));
    expect(new URL(listUrls[0]!, 'http://localhost').searchParams.has('dentistId')).toBe(false);
    expect(await screen.findByRole('link', { name: /^Cita con Marta Gómez a las 09:00 Programada/ })).toBeInTheDocument();
  });

  it('DENTIST conserva su filtro propio, los selectores bloqueados y la reserva para sí mismo', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST', { dentistId: 7 }) });
    const { listUrls, posts } = scopedBackend();
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    for (const label of ['Filtrar por dentista', 'Dentista']) {
      expect(screen.getByLabelText(label)).toBeDisabled();
      expect(screen.getByLabelText(label)).toHaveValue('7');
    }
    expect(await screen.findByRole('button', { name: /Abrir cita de Ana Pérez, 09:00–09:30 · Programada/ })).toBeInTheDocument();
    expect(screen.queryByText('09:00 · Marta Gómez')).not.toBeInTheDocument();
    expect(listUrls.every((url) => new URL(url, 'http://localhost').searchParams.get('dentistId') === '7')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    expect(await screen.findByRole('region', { name: 'Agenda del día' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Agenda de Luis Dos' })).not.toBeInTheDocument();
    await selectStaffPatient();
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reservar cita' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ patientId: 1, dentistId: 7 });
  });

  it('PATIENT conserva su agenda sin filtros administrativos y reserva únicamente para su patientId', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT', { patientId: 5 }) });
    const posts: Array<Record<string, unknown>> = [];
    const privateRequests: string[] = [];
    const { listUrls } = stub({
      'GET:/api/appointments': () => Promise.resolve(response(200, { ...PAGE, size: 10, content: [{ ...APPT_BASE, patientId: 5 }] })),
      'GET:/api/patients': () => { privateRequests.push('patients'); throw new Error('PATIENT no debe consultar pacientes de staff'); },
      'GET:/api/schedules/clinic': () => { privateRequests.push('clinic'); throw new Error('PATIENT no debe consultar el horario privado'); },
      'POST:/api/appointments': (_input, init) => {
        posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Promise.resolve(response(201, { ...APPT_BASE, patientId: 5 }));
      },
    });
    renderAt(<AppointmentsPage />);
    expect(await screen.findByText('Odontólogo: Ana Uno')).toBeInTheDocument();
    expect(screen.queryByLabelText('Filtrar por dentista')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Filtrar por estado')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Paciente')).not.toBeInTheDocument();
    expect(screen.queryByText('Nueva cita')).not.toBeInTheDocument();
    expect(listUrls.every((url) => !new URL(url, 'http://localhost').searchParams.has('dentistId'))).toBe(true);
    expect(screen.queryByRole('group', { name: 'Vista' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Agenda de/ })).not.toBeInTheDocument();
    await openPatientBooking();
    await patientService();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '8' } });
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    await patientConfirm();
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ patientId: 5, dentistId: 8 });
    expect(privateRequests).toEqual([]);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Citas — agenda por vistas', () => {
  it('OWNER ve la semana y cambia a día y mes', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub();
    renderAt(<AppointmentsPage />);

    expect(await screen.findByRole('link', { name: /^Cita con Ana Pérez a las 09:00 Programada/ })).toBeInTheDocument();
    await waitForPageSettled();

    fireEvent.click(screen.getByRole('button', { name: 'Mes' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Ver 1 cita del/ }));
    expect(await screen.findByRole('button', { name: /Abrir cita de Ana Pérez a las 09:00 Programada/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Ver \d+ citas? del/ }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    expect(await screen.findByText('Ana Uno', { selector: 'h3' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Cita con Ana Pérez a las 09:00 Programada' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Reservar / }).length).toBeGreaterThan(0);
  });

  it('filtra por dentista y estado y refresca la consulta', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    const { listUrls } = stub();
    renderAt(<AppointmentsPage />);
    await screen.findByRole('link', { name: /^Cita con Ana Pérez a las 09:00 Programada/ });

    fireEvent.change(screen.getByLabelText('Filtrar por dentista'), { target: { value: '8' } });
    await waitFor(() => expect(listUrls.at(-1)).toContain('dentistId=8'));

    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'COMPLETED' } });
    await waitFor(() => expect(listUrls.at(-1)).toContain('status=COMPLETED'));
  });

  it('PATIENT ve su agenda sin filtros ni panel de alta', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT', { patientId: 5 }) });
    stub();
    renderAt(<AppointmentsPage />);

    expect(await screen.findByText('Odontólogo: Ana Uno')).toBeInTheDocument();
    expect(screen.queryByLabelText('Filtrar por dentista')).not.toBeInTheDocument();
    expect(screen.queryByText('Nueva cita')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reservar cita' })).toBeInTheDocument();
  });

  it('muestra estado de carga y estado vacío', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stub({
      'GET:/api/appointments': () =>
        gate.then(() => response(200, { ...PAGE, content: [], totalElements: 0, totalPages: 0 })),
    });
    renderAt(<AppointmentsPage />);

    expect(await screen.findByText('Cargando citas…')).toBeInTheDocument();
    release();
    expect(await screen.findByRole('heading', { name: 'Una semana por organizar' })).toBeInTheDocument();
  });

  it('mantiene las jornadas de semana y las rejillas de mes y día aunque no haya citas', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub({
      'GET:/api/appointments': () => Promise.resolve(response(200, { ...PAGE, content: [], totalElements: 0, totalPages: 0 })),
    });
    renderAt(<AppointmentsPage />);

    expect(await screen.findByRole('heading', { name: 'Una semana por organizar' })).toBeInTheDocument();
    await waitForPageSettled();
    expect(within(screen.getByRole('navigation', { name: 'Días de esta semana' })).getAllByRole('button')).toHaveLength(7);
    expect(screen.getAllByText(/Sin citas registradas/)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Mes' }));
    const monthDays = await screen.findAllByRole('button', { name: /^Ver 0 citas del/ });
    const today = new Date();
    expect(monthDays).toHaveLength(new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate());
    expect(screen.getByText('No hay citas en este período.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    expect(await screen.findByText('Ana Uno', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText('Luis Dos', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText('No hay citas para este día.')).toBeInTheDocument();
    expect((await screen.findAllByRole('button', { name: /^Reservar / })).length).toBeGreaterThan(0);
  });

  it('deriva el eje horario del día del horario real de la clínica', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub({
      'GET:/api/appointments': () => Promise.resolve(response(200, { ...PAGE, content: [], totalElements: 0, totalPages: 0 })),
      'GET:/api/schedules/clinic': () => Promise.resolve(response(200, {
        ...CLINIC_SCHEDULE,
        days: CLINIC_SCHEDULE.days.map((day) => ({ ...day, startTime: '11:15:00', endTime: '15:45:00', breaks: [] })),
      })),
      'GET:/api/availability': () => Promise.resolve(response(200, { ...AVAILABILITY, slots: [] })),
    });
    renderAt(<AppointmentsPage />);
    await screen.findByRole('heading', { name: 'Una semana por organizar' });

    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    expect(await screen.findByText('12:00')).toBeInTheDocument();
    expect(screen.getByText('15:00')).toBeInTheDocument();
    expect(screen.queryByText('09:00')).not.toBeInTheDocument();
    expect(screen.queryByText('16:00')).not.toBeInTheDocument();
    expect(screen.queryByText('17:00')).not.toBeInTheDocument();
  });

  it.each([
    { name: 'sin días configurados', days: [] },
    { name: 'sin horas de apertura y cierre', days: CLINIC_SCHEDULE.days.map((day) => ({ ...day, startTime: null, endTime: null })) },
  ])('muestra un estado vacío $name sin inventar horas', async ({ days }) => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub({
      'GET:/api/appointments': () => Promise.resolve(response(200, { ...PAGE, content: [], totalElements: 0, totalPages: 0 })),
      'GET:/api/schedules/clinic': () => Promise.resolve(response(200, { ...CLINIC_SCHEDULE, days })),
    });
    renderAt(<AppointmentsPage />);
    await screen.findByRole('heading', { name: 'Una semana por organizar' });

    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    expect(await screen.findByText('Configura el horario de la clínica para ver la disponibilidad del día.')).toBeInTheDocument();
    expect(screen.queryByText('09:00')).not.toBeInTheDocument();
    expect(screen.queryByText('17:00')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reservar / })).not.toBeInTheDocument();
  });

  it('muestra error de carga y permite reintentar', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    let calls = 0;
    stub({
      'GET:/api/appointments': () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(
            response(500, { status: 500, error: 'Internal', message: 'Error de servidor', path: '/api/appointments', timestamp: '' }),
          );
        }
        return Promise.resolve(response(200, PAGE));
      },
    });
    renderAt(<AppointmentsPage />);

    expect(await screen.findByText('Error de servidor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('link', { name: /^Cita con Ana Pérez a las 09:00 Programada/ })).toBeInTheDocument();
  });

  it('recorre todas las páginas del rango y no omite citas cuando hay más de 100', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    const requestedPages: string[] = [];
    stub({
      'GET:/api/appointments': (input) => {
        const url = new URL(String(input), 'http://localhost');
        const page = Number(url.searchParams.get('page') ?? '0');
        requestedPages.push(String(page));
        const size = page === 2 ? 5 : 100;
        const content = Array.from({ length: size }, (_, index) => {
          const n = page * 100 + index;
          return { ...APPT_BASE, id: 1000 + n, patientFirstName: `P${n}` };
        });
        return Promise.resolve(response(200, { content, page, size: 100, totalElements: 205, totalPages: 3 }));
      },
    });
    renderAt(<AppointmentsPage />);

    await waitFor(() => expect(requestedPages.length).toBe(3));
    expect(new Set(requestedPages)).toEqual(new Set(['0', '1', '2']));
  });

  it('OWNER conserva el período y selector en móvil y puede abrir la lista diaria', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    stub();
    renderAt(<AppointmentsPage />);

    expect(await screen.findByRole('region', { name: 'Agenda semanal' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Vista' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Semana' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    expect(await screen.findByRole('heading', { name: 'Agenda del día' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Abrir cita de Ana Pérez/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Día' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Citas — navegación temporal', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 8, 12));
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
  });

  afterEach(() => { vi.useRealTimers(); });

  function renderCalendar() {
    const { listUrls } = stub({
      'GET:/api/appointments': () => Promise.resolve(response(200, { ...PAGE, content: [], totalElements: 0, totalPages: 0 })),
      'GET:/api/availability': () => Promise.resolve(response(200, { ...AVAILABILITY, slots: [] })),
    });
    renderAt(<AppointmentsPage />);
    return listUrls;
  }

  async function expectPeriod(listUrls: string[], from: string, to: string) {
    await waitFor(() => {
      const params = new URL(listUrls.at(-1) ?? '', 'http://localhost').searchParams;
      expect(params.get('from')).toBe(`${from}T00:00:00.000Z`);
      expect(params.get('to')).toBe(`${to}T00:00:00.000Z`);
      expect(screen.queryByText('Cargando citas…')).not.toBeInTheDocument();
    });
  }

  it.each([
    {
      view: 'Día', initial: ['2026-12-31', '2027-01-01'],
      previous: ['2026-12-30', '2026-12-31'], restored: ['2026-12-31', '2027-01-01'],
      next: ['2027-01-01', '2027-01-02'], today: ['2026-10-08', '2026-10-09'],
    },
    {
      view: 'Semana', initial: ['2026-12-28', '2027-01-04'],
      previous: ['2026-12-21', '2026-12-28'], restored: ['2026-12-28', '2027-01-04'],
      next: ['2027-01-04', '2027-01-11'], today: ['2026-10-05', '2026-10-12'],
    },
    {
      view: 'Mes', initial: ['2026-12-01', '2027-01-01'],
      previous: ['2026-11-01', '2026-12-01'], restored: ['2026-12-01', '2027-01-01'],
      next: ['2027-01-01', '2027-02-01'], today: ['2026-10-01', '2026-11-01'],
    },
  ])('$view: Anterior, Siguiente y Hoy respetan los rangos y el cambio de año', async ({ view, initial, previous, restored, next, today }) => {
    const listUrls = renderCalendar();
    await waitForPageSettled();
    fireEvent.click(screen.getByRole('button', { name: view }));
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-12-31' } });
    await expectPeriod(listUrls, initial[0], initial[1]);

    for (const [name, period] of [
      ['Anterior', previous], ['Siguiente', restored], ['Siguiente', next],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name }));
      await expectPeriod(listUrls, period[0], period[1]);
      expect(screen.getByLabelText('Fecha')).toHaveValue(period[0]);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Hoy' }));
    await expectPeriod(listUrls, today[0], today[1]);
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-10-08');
    expect(screen.getByRole('button', { name: view })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    { date: '2027-02-15', first: '2027-02-01', last: '2027-02-28', next: '2027-03-01', count: 28 },
    { date: '2028-02-15', first: '2028-02-01', last: '2028-02-29', next: '2028-03-01', count: 29 },
    { date: '2100-02-15', first: '2100-02-01', last: '2100-02-28', next: '2100-03-01', count: 28 },
    { date: '2026-04-15', first: '2026-04-01', last: '2026-04-30', next: '2026-05-01', count: 30 },
    { date: '2026-08-15', first: '2026-08-01', last: '2026-08-31', next: '2026-09-01', count: 31 },
    { date: '2026-12-15', first: '2026-12-01', last: '2026-12-31', next: '2027-01-01', count: 31 },
  ])('limita el mes de $date a sus $count días y permite abrir el último día', async ({ date, first, last, next, count }) => {
    const listUrls = renderCalendar();
    await waitForPageSettled();
    fireEvent.click(screen.getByRole('button', { name: 'Mes' }));
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: date } });
    await expectPeriod(listUrls, first, next);

    const days = screen.getAllByRole('button', { name: /^Ver \d+ citas? del/ });
    expect(days).toHaveLength(count);
    expect(days.map((button) => button.querySelector('strong')?.textContent)).toEqual(Array.from({ length: count }, (_, index) => String(index + 1)));
    fireEvent.click(days[count - 1]);
    expect(screen.getByRole('button', { name: 'Mes' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getByLabelText('Fecha')).toHaveValue(last));
    fireEvent.click(screen.getByRole('button', { name: /^Ver agenda completa/ }));
    await expectPeriod(listUrls, last, next);
    expect(screen.getByLabelText('Fecha')).toHaveValue(last);
    expect(screen.getByRole('button', { name: 'Día' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('muestra lunes a domingo al cruzar de año y abre el domingo de la semana', async () => {
    const listUrls = renderCalendar();
    await waitForPageSettled();
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-12-31' } });
    await expectPeriod(listUrls, '2026-12-28', '2027-01-04');

    const days = within(screen.getByRole('navigation', { name: 'Días de esta semana' })).getAllByRole('button');
    expect(days).toHaveLength(7);
    expect(days[0]).toHaveAccessibleName(/lunes, 28 de diciembre de 2026/);
    expect(days[6]).toHaveAccessibleName(/domingo, 3 de enero de 2027/);
    fireEvent.click(days[6]);
    expect(screen.getByRole('button', { name: 'Semana' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(await screen.findByRole('button', { name: /^Ver agenda completa/ }));
    await expectPeriod(listUrls, '2027-01-03', '2027-01-04');
    expect(screen.getByLabelText('Fecha')).toHaveValue('2027-01-03');
  });
});

describe('Citas — disponibilidad por columna', () => {
  const laterSlot = {
    ...AVAILABILITY.slots[0], startTime: '10:00:00', endTime: '10:30:00', start: todayAt(10, 0), end: todayAt(10, 30),
  };

  it('muestra carga y después ausencia de huecos solo en el dentista afectado', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    stub({
      'GET:/api/availability': (input) => {
        const dentistId = Number(new URL(String(input), 'http://localhost').searchParams.get('dentistId'));
        return dentistId === 7
          ? gate.then(() => response(200, { ...AVAILABILITY, slots: [] }))
          : Promise.resolve(response(200, { ...AVAILABILITY, dentistId, slots: [laterSlot] }));
      },
    });
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    fireEvent.click(screen.getByRole('button', { name: 'Día' }));

    const ana = within(await screen.findByRole('region', { name: 'Agenda de Ana Uno' }));
    const luis = within(screen.getByRole('region', { name: 'Agenda de Luis Dos' }));
    expect(ana.getByRole('status', { name: 'Disponibilidad' })).toHaveTextContent('Cargando disponibilidad…');
    expect(ana.queryByRole('button', { name: /^Reservar / })).not.toBeInTheDocument();
    expect(ana.queryByText('Sin huecos disponibles para este día.')).not.toBeInTheDocument();
    expect(ana.getByRole('button', { name: /^Cita con Ana Pérez/ })).toBeInTheDocument();
    const available = await luis.findByRole('button', { name: 'Reservar 10:00-10:30' });
    expect(luis.queryByRole('button', { name: 'Reservar 09:00-09:30' })).not.toBeInTheDocument();
    fireEvent.click(available);
    expect(screen.getByLabelText('Dentista')).toHaveValue('8');
    expect(screen.getByText('Seleccionado: 10:00–10:30')).toBeInTheDocument();

    release();
    expect(await ana.findByText('Sin huecos disponibles para este día.')).toBeInTheDocument();
    expect(ana.queryByRole('status', { name: 'Disponibilidad' })).not.toBeInTheDocument();
    expect(ana.queryByRole('button', { name: /^Reservar / })).not.toBeInTheDocument();
    expect(ana.getByRole('button', { name: /^Cita con Ana Pérez/ })).toBeInTheDocument();
    expect(luis.getByRole('button', { name: 'Reservar 10:00-10:30' })).toBeEnabled();
  });

  it('muestra el error de una columna sin ocultar las citas ni los huecos de otra', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub({
      'GET:/api/availability': (input) => {
        const dentistId = Number(new URL(String(input), 'http://localhost').searchParams.get('dentistId'));
        return Promise.resolve(dentistId === 7
          ? response(500, { message: 'No se pudo consultar la disponibilidad de Ana.' })
          : response(200, { ...AVAILABILITY, dentistId, slots: [laterSlot] }));
      },
    });
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    fireEvent.click(screen.getByRole('button', { name: 'Día' }));

    const ana = within(await screen.findByRole('region', { name: 'Agenda de Ana Uno' }));
    const luis = within(screen.getByRole('region', { name: 'Agenda de Luis Dos' }));
    expect(await ana.findByRole('alert')).toHaveTextContent('No se pudo consultar la disponibilidad de Ana.');
    expect(ana.queryByText('Sin huecos disponibles para este día.')).not.toBeInTheDocument();
    expect(ana.queryByRole('button', { name: /^Reservar / })).not.toBeInTheDocument();
    expect(ana.getByRole('button', { name: /^Cita con Ana Pérez/ })).toBeInTheDocument();
    expect(await luis.findByRole('button', { name: 'Reservar 10:00-10:30' })).toBeEnabled();
    expect(luis.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['error', 'éxito'])('no ofrece slots en caché durante la revalidación y resuelve con %s', async (result) => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    stub({
      'GET:/api/availability': (input) => {
        const dentistId = Number(new URL(String(input), 'http://localhost').searchParams.get('dentistId'));
        if (dentistId === 8) return Promise.resolve(response(200, { ...AVAILABILITY, dentistId, slots: [] }));
        calls += 1;
        if (calls === 1) return Promise.resolve(response(200, AVAILABILITY));
        return gate.then(() => result === 'error'
          ? response(500, { message: 'No se pudo actualizar la disponibilidad.' })
          : response(200, { ...AVAILABILITY, slots: [laterSlot] }));
      },
    });
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    await screen.findByRole('button', { name: 'Reservar 09:00-09:30' });

    fireEvent.change(screen.getByLabelText('Filtrar por dentista'), { target: { value: '8' } });
    await screen.findByRole('region', { name: 'Agenda de Luis Dos' });
    expect(screen.queryByRole('region', { name: 'Agenda de Ana Uno' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filtrar por dentista'), { target: { value: '' } });
    const ana = within(await screen.findByRole('region', { name: 'Agenda de Ana Uno' }));

    expect(ana.getByRole('status', { name: 'Disponibilidad' })).toHaveTextContent('Cargando disponibilidad…');
    expect(ana.queryByRole('button', { name: /^Reservar / })).not.toBeInTheDocument();
    release();
    if (result === 'error') {
      expect(await ana.findByRole('alert')).toHaveTextContent('No se pudo actualizar la disponibilidad.');
      expect(ana.queryByRole('button', { name: /^Reservar / })).not.toBeInTheDocument();
    } else {
      expect(await ana.findByRole('button', { name: 'Reservar 10:00-10:30' })).toBeEnabled();
      expect(ana.queryByRole('button', { name: 'Reservar 09:00-09:30' })).not.toBeInTheDocument();
    }
  });
});

describe('Citas — creación', () => {
  it.each([
    ['Dentista', '8'],
    ['Día', '2026-11-03'],
    ['Servicio', '31'],
  ])('invalida inmediatamente el horario al cambiar %s y bloquea el envío durante carga/error', async (label, value) => {
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
    let release!: (result: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    let calls = 0;
    const post = vi.fn(() => Promise.resolve(response(201, APPT_BASE)));
    stub({
      'GET:/api/availability': () => ++calls === 1 ? Promise.resolve(response(200, AVAILABILITY)) : pending,
      'POST:/api/appointments': post,
    });
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    await selectStaffPatient();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    const oldSubmit = screen.getByRole('button', { name: 'Reservar cita' });
    expect(oldSubmit).toBeEnabled();

    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(screen.queryByText(/^Seleccionado:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reservar cita' })).not.toBeInTheDocument();
    fireEvent.click(oldSubmit);
    expect(post).not.toHaveBeenCalled();
    expect(await screen.findByText('Cargando disponibilidad…')).toBeInTheDocument();
    await act(async () => { release(response(500, { message: 'Disponibilidad no disponible.' })); });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reservar cita' })).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    ['Dentista', '8'],
    ['Día', '2026-11-03'],
    ['Servicio', '31'],
  ])('PATIENT necesita volver a seleccionar tras cambiar %s aunque el backend devuelva el mismo intervalo', async (label, value) => {
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT', { patientId: 5 }) });
    const post = vi.fn(() => Promise.resolve(response(201, APPT_BASE)));
    stub({ 'POST:/api/appointments': post });
    renderAt(<AppointmentsPage />);
    await openPatientBooking();
    await patientService();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
    if (label === 'Servicio') { fireEvent.click(screen.getByRole('button', { name: 'Anterior' })); await patientService(value); }
    else fireEvent.change(screen.getByLabelText(label), { target: { value: label === 'Día' ? '03/11/2026' : value } });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    expect(screen.queryByText(/^Seleccionado:/)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    await patientConfirm();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });

  it('las respuestas fuera de orden no reemplazan los huecos ni restauran la selección anterior', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
    const releases = new Map<string, (result: Response) => void>();
    let calls = 0;
    const post = vi.fn<Fetcher>(() => Promise.resolve(response(201, APPT_BASE)));
    stub({
      'GET:/api/availability': (input) => {
        if (++calls === 1) return Promise.resolve(response(200, AVAILABILITY));
        const day = new URL(String(input), 'http://localhost').searchParams.get('from')!;
        return new Promise<Response>((resolve) => { releases.set(day, resolve); });
      },
      'POST:/api/appointments': post,
    });
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    await selectStaffPatient();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    fireEvent.change(screen.getByLabelText('Día'), { target: { value: '2026-11-03' } });
    await waitFor(() => expect(releases.has('2026-11-03')).toBe(true));
    fireEvent.change(screen.getByLabelText('Día'), { target: { value: '2026-11-04' } });
    await waitFor(() => expect(releases.has('2026-11-04')).toBe(true));
    expect(screen.queryByRole('button', { name: 'Reservar cita' })).not.toBeInTheDocument();
    const currentSlot = {
      ...AVAILABILITY.slots[0], startDate: '2026-11-04', startTime: '11:00:00', endTime: '11:30:00',
      start: '2026-11-04T10:00:00Z', end: '2026-11-04T10:30:00Z',
    };
    await act(async () => { releases.get('2026-11-04')!(response(200, { ...AVAILABILITY, slots: [currentSlot] })); });
    const currentButton = await screen.findByRole('button', { name: '11:00–11:30' });
    expect(screen.queryByText(/^Seleccionado:/)).not.toBeInTheDocument();
    fireEvent.click(currentButton);
    await act(async () => { releases.get('2026-11-03')!(response(200, AVAILABILITY)); });
    expect(screen.queryByRole('button', { name: '09:00–09:30' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '11:00–11:30' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Reservar cita' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(post.mock.calls[0][1]?.body))).toMatchObject({
      startAt: currentSlot.start, endAt: currentSlot.end,
    });
  });

  it.each(['error', 'sin huecos', 'otro fin'])('bloquea el envío durante refetch con datos en caché y después de %s', async (result) => {
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
    let release!: (value: Response) => void;
    let calls = 0;
    const post = vi.fn<Fetcher>(() => Promise.resolve(response(201, APPT_BASE)));
    stub({
      'GET:/api/availability': () => ++calls === 1
        ? Promise.resolve(response(200, AVAILABILITY))
        : new Promise<Response>((resolve) => { release = resolve; }),
      'POST:/api/appointments': post,
    });
    const { client } = renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    await selectStaffPatient();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    const submit = screen.getByRole('button', { name: 'Reservar cita' });
    // Start the refetch and attempt submit before the observer has rendered loading.
    act(() => {
      void client.refetchQueries({ queryKey: ['availability', 'form'] });
      fireEvent.click(submit);
    });
    expect(post).not.toHaveBeenCalled();
    await waitFor(() => expect(submit).toBeDisabled());
    expect(screen.queryByRole('group', { name: 'Huecos disponibles' })).not.toBeInTheDocument();
    await act(async () => {
      release(result === 'error' ? response(500, { message: 'Disponibilidad no disponible.' }) : response(200, {
        ...AVAILABILITY,
        slots: result === 'sin huecos' ? [] : [{ ...AVAILABILITY.slots[0], end: todayAt(10, 0), endTime: '10:00:00' }],
      }));
    });
    await waitFor(() => expect(screen.queryByText('Cargando disponibilidad…')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Reservar cita' })).toBeDisabled();
    fireEvent.click(submit);
    expect(post).not.toHaveBeenCalled();
  });

  it('valida el slot prellenado desde la agenda contra la consulta actual del formulario', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
    let dentist8Calls = 0;
    let release!: (value: Response) => void;
    const post = vi.fn<Fetcher>(() => Promise.resolve(response(201, APPT_BASE)));
    stub({
      'GET:/api/availability': (input) => {
        const dentistId = new URL(String(input), 'http://localhost').searchParams.get('dentistId');
        if (dentistId === '8' && ++dentist8Calls === 2) {
          return new Promise<Response>((resolve) => { release = resolve; });
        }
        return Promise.resolve(response(200, AVAILABILITY));
      },
      'POST:/api/appointments': post,
    });
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    await selectStaffPatient();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    const agenda = within(await screen.findByRole('region', { name: 'Agenda de Luis Dos' }));
    fireEvent.click(await agenda.findByRole('button', { name: 'Reservar 09:00-09:30' }));
    expect(screen.getByLabelText('Dentista')).toHaveValue('8');
    expect(screen.getByRole('button', { name: 'Reservar cita' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reservar cita' }));
    expect(post).not.toHaveBeenCalled();
    await waitFor(() => expect(dentist8Calls).toBe(2));
    await act(async () => { release(response(200, { ...AVAILABILITY, slots: [] })); });
    expect(await screen.findByText('Sin huecos disponibles para esa combinación.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reservar cita' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('crea una cita desde los huecos enviando Idempotency-Key', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
    const posts: Array<{ body: string; key: string }> = [];
    stub({
      'POST:/api/appointments': (_input, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        posts.push({ body: String(init?.body ?? ''), key: headers['Idempotency-Key'] ?? '' });
        return Promise.resolve(response(201, APPT_BASE));
      },
    });
    renderAt(<AppointmentsPage />);
    await screen.findByText('Nueva cita');
    await waitForPageSettled();

    await selectStaffPatient();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reservar cita' }));

    await waitFor(() => expect(posts.length).toBe(1));
    const body = JSON.parse(posts[0].body) as Record<string, unknown>;
    expect(body).toMatchObject({ patientId: 1, dentistId: 7 });
    expect(posts[0].key).toBeTruthy();
    expect(await screen.findByText('Cita creada correctamente.')).toBeInTheDocument();
  });

  it('mantiene la Idempotency-Key en reintentos y muestra el 409 del backend', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    const keys: string[] = [];
    let attempts = 0;
    stub({
      'POST:/api/appointments': (_input, init) => {
        attempts += 1;
        const headers = (init?.headers ?? {}) as Record<string, string>;
        keys.push(headers['Idempotency-Key'] ?? '');
        if (attempts === 1) {
          return Promise.resolve(
            response(409, {
              status: 409,
              error: 'Conflict',
              message: 'La cita entra en conflicto con otra de la agenda.',
              path: '/api/appointments',
              timestamp: '',
            }),
          );
        }
        return Promise.resolve(response(201, APPT_BASE));
      },
    });
    renderAt(<AppointmentsPage />);
    await screen.findByText('Nueva cita');
    await waitForPageSettled();

    await selectStaffPatient();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reservar cita' }));

    expect(await screen.findByText('La cita entra en conflicto con otra de la agenda.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reservar cita' }));
    await waitFor(() => expect(attempts).toBe(2));
    expect(await screen.findByText('Cita creada correctamente.')).toBeInTheDocument();
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toBeTruthy();
  });

  it('genera otra Idempotency-Key al cambiar el payload y conserva la nueva en su reintento', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    const posts: Array<{ body: Record<string, unknown>; key: string }> = [];
    stub({
      'GET:/api/patients': () => Promise.resolve(response(200, {
        ...PATIENTS,
        content: [...PATIENTS.content, { ...PATIENTS.content[0], id: 2, firstName: 'Marta' }],
      })),
      'GET:/api/availability': () => Promise.resolve(response(200, {
        ...AVAILABILITY,
        slots: [...AVAILABILITY.slots, {
          ...AVAILABILITY.slots[0], startTime: '10:00:00', endTime: '10:30:00', start: todayAt(10, 0), end: todayAt(10, 30),
        }],
      })),
      'POST:/api/appointments': (_input, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        posts.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown>, key: headers['Idempotency-Key'] ?? '' });
        return Promise.resolve(response(409, { message: 'Conflicto de reserva.' }));
      },
    });
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    await selectStaffPatient();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));

    async function submit(expectedCount: number) {
      fireEvent.click(await screen.findByRole('button', { name: 'Reservar cita' }));
      await waitFor(() => expect(posts).toHaveLength(expectedCount));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Reservar cita' })).toBeEnabled());
    }

    await submit(1);
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Limpieza' } });
    await submit(2);
    await selectStaffPatient('2');
    await submit(3);
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '8' } });
    expect(screen.queryByRole('button', { name: 'Reservar cita' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    await submit(4);
    fireEvent.click(await screen.findByRole('button', { name: '10:00–10:30' }));
    await submit(5);
    await submit(6);

    expect(posts[1].body.reason).toBe('Limpieza');
    expect(posts[2].body.patientId).toBe(2);
    expect(posts[3].body.dentistId).toBe(8);
    expect(posts[4].body).toMatchObject({ startAt: todayAt(10, 0), endAt: todayAt(10, 30) });
    expect(posts.slice(0, 5).every((post) => post.key !== '')).toBe(true);
    expect(new Set(posts.slice(0, 5).map((post) => post.key)).size).toBe(5);
    expect(posts[5]).toEqual(posts[4]);
  });

  it('rota la Idempotency-Key después del éxito incluso al enviar otra vez el mismo payload', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
    const posts: Array<{ body: string; key: string }> = [];
    stub({
      'POST:/api/appointments': (_input, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        posts.push({ body: String(init?.body), key: headers['Idempotency-Key'] ?? '' });
        return Promise.resolve(response(201, APPT_BASE));
      },
    });
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    await selectStaffPatient();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });

    for (const count of [1, 2]) {
      fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
      fireEvent.click(screen.getByRole('button', { name: 'Reservar cita' }));
      await waitFor(() => expect(posts).toHaveLength(count));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Reservar cita' })).not.toBeInTheDocument());
    }

    expect(posts[0].body).toBe(posts[1].body);
    expect(posts[0].key).toBeTruthy();
    expect(posts[1].key).toBeTruthy();
    expect(posts[0].key).not.toBe(posts[1].key);
  });

  it('busca con páginas de tamaño permitido; abrir conserva selección y editar invalida ID (D1)', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
    const patientUrls: string[] = [];
    stub({
      'GET:/api/patients': (input) => {
        const url = new URL(String(input), 'http://localhost');
        patientUrls.push(String(input));
        if (url.searchParams.get('search') === 'Otro') {
          return Promise.resolve(response(200, { content: [], page: 0, size: 10, totalElements: 0, totalPages: 0 }));
        }
        return Promise.resolve(response(200, PATIENTS));
      },
    });
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();

    await selectStaffPatient();
    expect(screen.getByLabelText('Paciente')).toHaveValue('Ana Pérez');
    fireEvent.focus(screen.getByLabelText('Paciente'));
    expect(await screen.findByRole('option', { name: /Paciente #1/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(screen.getByLabelText('Paciente'), { target: { value: 'Otro' } });
    expect(screen.queryByRole('button', { name: 'Quitar selección' })).not.toBeInTheDocument();
    expect(await screen.findByText(/No hay pacientes que coincidan/)).toBeInTheDocument();
    expect(screen.getByLabelText('Paciente')).toHaveValue('Otro');
    expect(patientUrls.at(-1)).toContain('search=Otro');
    for (const url of patientUrls) {
      const size = Number(new URL(url, 'http://localhost').searchParams.get('size'));
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThanOrEqual(100);
    }
  });

  it('PATIENT solicita una cita desde los huecos', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT', { patientId: 5 }) });
    const posts: string[] = [];
    stub({
      'POST:/api/appointments': (_input, init) => {
        posts.push(String(init?.body ?? ''));
        return Promise.resolve(response(201, APPT_BASE));
      },
    });
    renderAt(<AppointmentsPage />);

    await openPatientBooking();
    await patientService();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    await patientConfirm();

    await waitFor(() => expect(posts.length).toBe(1));
    const body = JSON.parse(posts[0]) as Record<string, unknown>;
    expect(body).toMatchObject({ patientId: 5, dentistId: 7 });
  });

  it('PATIENT sin perfil de paciente ve el aviso de reserva', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT') });
    stub();
    renderAt(<AppointmentsPage />);

    fireEvent.click(await screen.findByRole('link', { name: 'Reservar cita' }));
    expect(
      await screen.findByText(/Completa tu perfil de paciente antes de reservar una cita/),
    ).toBeInTheDocument();
  });
});

describe('Citas — zona clínica H-A06', () => {
  function stubInMadrid(overrides: Table = {}) {
    return stub({
      'GET:/api/public/schedule': () => Promise.resolve(response(200, { ...PUBLIC, timezone: 'Europe/Madrid' })),
      'GET:/api/schedules/clinic': () => Promise.resolve(response(200, { ...CLINIC_SCHEDULE, timezone: 'Europe/Madrid' })),
      ...overrides,
    });
  }
  const midnightAppointment = {
    ...APPT_BASE, startAt: '2026-03-28T23:30:00Z', endAt: '2026-03-29T00:00:00Z',
    createdAt: '2026-03-28T23:00:00Z',
  };
  const midnightAvailability = {
    ...AVAILABILITY,
    slots: [{ startDate: '2026-03-29', startTime: '00:30:00', endTime: '01:00:00',
      start: midnightAppointment.startAt, end: midnightAppointment.endAt }],
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-28T23:30:00Z'));
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('inicializa hoy y agrupa/formatea las citas por el día de Madrid, no por el navegador', async () => {
    const availabilityDays: string[] = [];
    stubInMadrid({
      'GET:/api/appointments': () => Promise.resolve(response(200, { ...PAGE, content: [midnightAppointment] })),
      'GET:/api/schedules/clinic': () => Promise.resolve(response(200, {
        ...CLINIC_SCHEDULE, timezone: 'Europe/Madrid',
        days: CLINIC_SCHEDULE.days.map((day) => ({ ...day, startTime: '00:00:00', endTime: '23:00:00' })),
      })),
      'GET:/api/availability': (input) => {
        availabilityDays.push(new URL(String(input), 'http://localhost').searchParams.get('from')!);
        return Promise.resolve(response(200, midnightAvailability));
      },
    });
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    expect(screen.getByLabelText('Fecha')).toHaveValue('2026-03-29');
    expect(screen.getByLabelText('Día')).toHaveValue('2026-03-29');
    const weekVisit = await screen.findByRole('link', { name: 'Cita con Ana Pérez a las 00:30 Programada' });
    expect(weekVisit).toHaveTextContent('00:30');
    const weekDay = screen.getByRole('button', { name: 'Ver día dom, 29 mar' }).closest('section')!;
    expect(within(weekDay).getByRole('link', { name: 'Cita con Ana Pérez a las 00:30 Programada' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    const agenda = within(await screen.findByRole('region', { name: 'Agenda de Ana Uno' }));
    const chip = agenda.getByRole('button', { name: 'Cita con Ana Pérez a las 00:30 Programada' });
    expect(chip.parentElement).toHaveStyle({ top: '60px' });
    await waitFor(() => expect(availabilityDays).toEqual(['2026-03-29', '2026-03-29']));
    fireEvent.click(screen.getByRole('button', { name: 'Mes' }));
    const monthDay = (await screen.findByRole('button', { name: 'Ver día dom, 29 mar' })).parentElement!;
    expect(within(monthDay).getByText('00:30 · Ana Pérez')).toBeInTheDocument();
  });

  it.each([
    ['2026-03-29', '2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z'],
    ['2026-10-25', '2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z'],
  ])('consulta los límites UTC del día clínico %s', async (day, from, to) => {
    const { listUrls } = stubInMadrid();
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: day } });
    await waitFor(() => {
      const params = new URL(listUrls.at(-1)!, 'http://localhost').searchParams;
      expect(params.get('from')).toBe(from);
      expect(params.get('to')).toBe(to);
    });
  });

  it('muestra el horario de clínica y envía los instantes originales del slot conservando H-A07', async () => {
    const posts: Array<Record<string, unknown>> = [];
    const days: string[] = [];
    stubInMadrid({
      'GET:/api/availability': (input) => {
        days.push(new URL(String(input), 'http://localhost').searchParams.get('from')!);
        return Promise.resolve(response(200, midnightAvailability));
      },
      'POST:/api/appointments': (_input, init) => {
        posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Promise.resolve(response(201, midnightAppointment));
      },
    });
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    await selectStaffPatient();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    fireEvent.click(await screen.findByRole('button', { name: '00:30–01:00' }));
    expect(screen.getByText('Seleccionado: 00:30–01:00')).toBeInTheDocument();
    expect(days).toEqual(['2026-03-29']);
    fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: '31' } });
    expect(screen.queryByRole('button', { name: 'Reservar cita' })).not.toBeInTheDocument();
    expect(posts).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: '00:30–01:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reservar cita' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ startAt: midnightAppointment.startAt, endAt: midnightAppointment.endAt });
  });

  it('muestra detalle y eventos e inicializa reprogramación con la fecha de la clínica', async () => {
    const days: string[] = [];
    stubInMadrid({
      'GET:/api/appointments/7': () => Promise.resolve(response(200, midnightAppointment)),
      'GET:/api/appointments/7/events': () => Promise.resolve(response(200, [
        { ...EVENTS[0], createdAt: midnightAppointment.startAt },
      ])),
      'GET:/api/availability': (input) => {
        days.push(new URL(String(input), 'http://localhost').searchParams.get('from')!);
        return Promise.resolve(response(200, midnightAvailability));
      },
    });
    renderAt(<AppointmentDetailPage />, '/appointments/7');
    expect(await screen.findByText(/domingo, 29 de marzo de 2026 00:30–01:00/)).toBeInTheDocument();
    expect(await screen.findByText(/Cita creada · domingo, 29 de marzo de 2026 00:30/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reprogramar' }));
    await waitFor(() => expect(days).toEqual(['2026-03-29']));
  });

  it('conserva el instante elegido cuando DST repite la misma hora de clínica', async () => {
    const posts: Array<Record<string, unknown>> = [];
    const slots = ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z'].map((start) => ({
      startDate: '2026-10-25', startTime: '02:30:00', endTime: '02:45:00', start,
      end: new Date(new Date(start).getTime() + 15 * 60_000).toISOString(),
    }));
    stubInMadrid({
      'GET:/api/availability': () => Promise.resolve(response(200, { ...AVAILABILITY, durationMinutes: 15, slots })),
      'POST:/api/appointments': (_input, init) => {
        posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Promise.resolve(response(201, APPT_BASE));
      },
    });
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    await selectStaffPatient();
    fireEvent.change(screen.getByLabelText('Día'), { target: { value: '2026-10-25' } });
    fireEvent.change(screen.getByLabelText('Servicio'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    const buttons = await screen.findAllByRole('button', { name: '02:30–02:45' });
    fireEvent.click(buttons[1]);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Seleccionado: 02:30–02:45')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reservar cita' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ startAt: slots[1].start, endAt: slots[1].end });
  });

  it('espera la zona del backend antes de consultar citas o inicializar el día', async () => {
    let release!: (result: Response) => void;
    const { listUrls } = stubInMadrid({
      'GET:/api/public/schedule': () => new Promise<Response>((resolve) => { release = resolve; }),
    });
    renderAt(<AppointmentsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando zona horaria');
    expect(listUrls).toHaveLength(0);
    expect(screen.queryByLabelText('Día')).not.toBeInTheDocument();
    await act(async () => { release(response(200, { ...PUBLIC, timezone: 'Europe/Madrid' })); });
    await waitForPageSettled();
    expect(screen.getByLabelText('Día')).toHaveValue('2026-03-29');
  });
});

describe('Cita — detalle y rol', () => {
  it('DENTIST asignado abre atención y eventos históricos, sin llegada/inicio/cierre prematuro', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST', { dentistId: 7 }) });
    stub();
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Historial del paciente' }));
    fireEvent.click(screen.getByText('Actividad de la cita', { selector: 'summary' }));
    expect(await screen.findByText(/Cita creada/)).toBeInTheDocument();
    expect(screen.getByText(/Llegada registrada/)).toBeInTheDocument();
    expect(screen.getByText(/Cita iniciada/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar llegada' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finalizar atención' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Completar cita' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Datos de la cita' }));
    expect(screen.getByRole('button', { name: 'Cancelar cita' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reprogramar' })).toBeInTheDocument();
  });

  it('DENTIST no asignado no ve acciones', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST', { dentistId: 99 }) });
    stub();
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    expect(await screen.findByText('No encontramos la cita solicitada.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar llegada' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar cita' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Completar cita' })).not.toBeInTheDocument();
  });

  it('OWNER sin perfil de dentista controla pero no ejecuta la trayectoria', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub();
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    expect(await screen.findByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar no asistencia' })).toBeInTheDocument();
  });

  it.each([
    { dentistId: 7, assigned: true },
    { dentistId: 99, assigned: false },
  ])('OWNER con perfil $dentistId: trayectoria asignada=$assigned y control administrativo', async ({ dentistId, assigned }) => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER', { dentistId }) });
    stub();
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    expect(await screen.findByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reprogramar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar no asistencia' })).toBeInTheDocument();
    for (const name of ['Registrar llegada', 'Iniciar']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Abrir atención clínica' })).toHaveAttribute('href', '/appointments/7?clinical=1');
    expect(screen.queryByRole('link', { name: 'Terminar atención' })).not.toBeInTheDocument();
    expect(Boolean(screen.queryByText('Finaliza desde el espacio de atención clínica.'))).toBe(assigned);
  });

  it.each(['RECEPTIONIST', 'PATIENT'] as const)('%s nunca ve completar, llegada ni inicio', async (role) => {
    useAuthStore.setState({ status: 'authenticated', user: user(role, { patientId: 1 }) });
    stub();
    renderAt(<AppointmentDetailPage />, '/appointments/7');
    await screen.findByText(/Cita creada/);
    for (const name of ['Completar', 'Registrar llegada', 'Iniciar']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reprogramar' })).toBeEnabled();
  });

  it.each(['COMPLETED', 'CANCELLED', 'NO_SHOW'])('oculta todas las acciones en estado terminal %s', async (status) => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER', { dentistId: 7 }) });
    stub({ 'GET:/api/appointments/7': () => Promise.resolve(response(200, { ...APPT_BASE, status })) });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    expect(await screen.findByText(/La cita está cerrada: no se permiten nuevas acciones de agenda/)).toBeInTheDocument();
    for (const name of ['Cancelar', 'Reprogramar', 'Registrar llegada', 'Iniciar', 'Completar', 'Registrar no asistencia', 'Deshacer']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: 'Detalles' })).toBeInTheDocument();
    expect(await screen.findByText(/Cita creada/)).toBeInTheDocument();
  });
});

describe('Cita — acciones', () => {
  it('RECEPTIONIST tiene una sola acción y confirmación de no asistencia, en Acciones', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
    stub();
    renderAt(<AppointmentDetailPage />, '/appointments/7');
    const button = await screen.findByRole('button', { name: 'Registrar no asistencia' });
    expect(screen.getAllByRole('button', { name: 'Registrar no asistencia' })).toHaveLength(1);
    const actions = screen.getByRole('heading', { name: 'Acciones' }).closest('section')!;
    expect(actions).toContainElement(button);
    fireEvent.click(button);
    expect(screen.getAllByRole('button', { name: 'Sí, no asistió' })).toHaveLength(1);
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Sí, no asistió' }));
    fireEvent.click(within(actions).getByRole('button', { name: 'No' }));
    expect(screen.getAllByRole('button', { name: 'Registrar no asistencia' })).toHaveLength(1);
  });

  it('cancela con confirmación de dos pasos', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    let posted = false;
    stub({
      'POST:/api/appointments/7/cancel': () => {
        posted = true;
        return Promise.resolve(response(200, { ...APPT_BASE, status: 'CANCELLED' }));
      },
    });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('¿Cancelar esta cita?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar' }));
    await waitFor(() => expect(posted).toBe(true));
    expect(await screen.findByText('Cita cancelada.')).toBeInTheDocument();
  });

  it.each([
    { role: 'DENTIST', historical: false, future: false },
    { role: 'DENTIST', historical: true, future: false },
    { role: 'OWNER', historical: false, future: true },
    { role: 'OWNER', historical: true, future: true },
  ] as const)('$role conserva su flujo (historial=$historical, futura=$future)', async ({ role, historical, future }) => {
    useAuthStore.setState({ status: 'authenticated', user: user(role, { dentistId: 7 }) });
    const start = Date.now() + (future ? 1 : -1) * 60 * 60_000;
    let appt = { ...APPT_BASE, startAt: new Date(start).toISOString(), status: 'SCHEDULED', completedAt: '' };
    const oldEvents = historical ? EVENTS : EVENTS.slice(0, 1);
    let events = oldEvents;
    stub({
      'GET:/api/appointments/7': () => Promise.resolve(response(200, appt)),
      'GET:/api/appointments/7/events': () => Promise.resolve(response(200, events)),
      'POST:/api/appointments/7/complete': () => {
        appt = { ...appt, status: 'COMPLETED', completedAt: new Date().toISOString() };
        events = [...oldEvents, { id: 4, eventType: 'APPOINTMENT_COMPLETED', actorUserId: 10, occurrenceVersion: 1, createdAt: appt.completedAt }];
        return Promise.resolve(response(200, appt));
      },
    });
    const fetch = vi.spyOn(globalThis, 'fetch');
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    if (role === 'DENTIST') {
      fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
      expect(screen.queryByRole('button', { name: /Completar/ })).not.toBeInTheDocument();
      expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
      return;
    }
    expect(await screen.findByRole('link', { name: 'Abrir atención clínica' })).toHaveAttribute('href', '/appointments/7?clinical=1');
    expect(screen.queryByRole('button', { name: 'Registrar llegada' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar' })).not.toBeInTheDocument();
    if (historical) {
      expect(screen.getByText(/Llegada registrada/)).toBeInTheDocument();
      expect(screen.getByText(/Cita iniciada/)).toBeInTheDocument();
    } else {
      expect(screen.queryByText(/Llegada registrada/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Cita iniciada/)).not.toBeInTheDocument();
    }
    const writes = fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(writes).toHaveLength(0); // Clinical confirmation now has its own three-step coverage.
  });

  it('deshabilita NO_SHOW antes del inicio', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
    const future = new Date();
    future.setHours(future.getHours() + 1);
    const over = {
      ...APPT_BASE,
      startAt: future.toISOString(),
      endAt: new Date(future.getTime() + 30 * 60_000).toISOString(),
    };
    stub({ 'GET:/api/appointments/7': () => Promise.resolve(response(200, over)) });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    const button = await screen.findByRole('button', { name: 'Registrar no asistencia' });
    expect(button).toBeDisabled();
    expect(screen.getByText('Aún no puede declararse ausencia: la cita todavía no comenzó.')).toBeInTheDocument();
  });

  it('confirma NO_SHOW con dos pasos una vez comenzada la cita', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
    const past = new Date();
    past.setHours(past.getHours() - 1);
    const over = {
      ...APPT_BASE,
      startAt: past.toISOString(),
      endAt: new Date(past.getTime() + 30 * 60_000).toISOString(),
    };
    let posted = false;
    stub({
      'GET:/api/appointments/7': () => Promise.resolve(response(200, over)),
      'POST:/api/appointments/7/no-show': () => {
        posted = true;
        return Promise.resolve(response(200, { ...over, status: 'NO_SHOW' }));
      },
    });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    fireEvent.click(await screen.findByRole('button', { name: 'Registrar no asistencia' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sí, no asistió' }));
    await waitFor(() => expect(posted).toBe(true));
    expect(await screen.findByText('No-show registrado.')).toBeInTheDocument();
  });

  it.each([
    { name: 'Cancelar', confirm: 'Sí, cancelar', endpoint: 'cancel' },
    { name: 'Registrar no asistencia', confirm: 'Sí, no asistió', endpoint: 'no-show' },
  ])('descarta la confirmación de $name sin ejecutar la acción', async ({ name, confirm, endpoint }) => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER', { dentistId: 7 }) });
    const past = new Date(Date.now() - 60 * 60_000);
    const action = vi.fn(() => Promise.resolve(response(200, APPT_BASE)));
    stub({
      'GET:/api/appointments/7': () => Promise.resolve(response(200, {
        ...APPT_BASE, startAt: past.toISOString(), endAt: new Date(past.getTime() + 30 * 60_000).toISOString(),
      })),
      [`POST:/api/appointments/7/${endpoint}`]: action,
    });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    fireEvent.click(await screen.findByRole('button', { name }));
    expect(screen.getByRole('button', { name: confirm })).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'No' }));

    expect(screen.queryByRole('button', { name: confirm })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name })).toBeEnabled();
    expect(action).not.toHaveBeenCalled();
  });
});

describe('Cita — reprogramación y errores', () => {
  it('reprograma con huecos enviando expectedOccurrenceVersion', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    let body: string | null = null;
    stub({
      'POST:/api/appointments/7/reschedule': (_input, init) => {
        body = String(init?.body ?? '');
        return Promise.resolve(
          response(200, { ...APPT_BASE, occurrenceVersion: 2, startAt: todayAt(10, 0), endAt: todayAt(10, 30) }),
        );
      },
    });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    fireEvent.click(await screen.findByRole('button', { name: 'Reprogramar' }));
    expect(screen.getByLabelText('Día')).toHaveAttribute('type', 'date');
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reprogramación' }));

    await waitFor(() => expect(body).not.toBeNull());
    const parsed = JSON.parse(body ?? '') as Record<string, unknown>;
    expect(parsed.expectedOccurrenceVersion).toBe(1);
    expect(parsed.startAt).toBeTruthy();
  });

  it('muestra el mensaje del backend en un 409 de reprogramación', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub({
      'POST:/api/appointments/7/reschedule': () =>
        Promise.resolve(
          response(409, {
            status: 409,
            error: 'Conflict',
            message: 'La cita cambió; recarga para ver el estado actual.',
            path: '/api/appointments/7/reschedule',
            timestamp: '',
          }),
        ),
    });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    fireEvent.click(await screen.findByRole('button', { name: 'Reprogramar' }));
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reprogramación' }));

    expect(await screen.findByText('La cita cambió; recarga para ver el estado actual.')).toBeInTheDocument();
  });

  it('404 muestra mensaje de cita no encontrada', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub({
      'GET:/api/appointments/7': () =>
        Promise.resolve(
          response(404, { status: 404, error: 'Not Found', message: 'Cita no encontrada', path: '/api/appointments/7', timestamp: '' }),
        ),
    });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    expect(await screen.findByText('No encontramos la cita solicitada.')).toBeInTheDocument();
  });

  it('PATIENT ve la política de cancelación y cancela su propia cita', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT', { patientId: 1 }) });
    let posted = false;
    stub({
      'POST:/api/appointments/7/cancel': () => {
        posted = true;
        return Promise.resolve(response(200, { ...APPT_BASE, status: 'CANCELLED' }));
      },
    });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    expect(await screen.findByText(/cancelar hasta 12 horas/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar' }));
    await waitFor(() => expect(posted).toBe(true));
  });

  it.each([
    { status: 400, message: 'Revisa los datos de la cita.' },
    { status: 403, message: 'No tienes permisos para consultar esta cita.' },
  ])('presenta el error HTTP $status del detalle sin mostrar acciones', async ({ status, message }) => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub({
      'GET:/api/appointments/7': () => Promise.resolve(response(status, {
        status, error: 'Error', message, path: '/api/appointments/7', timestamp: '',
      })),
    });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('heading', { name: 'Detalles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });

  it('presenta el 401 de citas y cierra la sesión cuando falla la renovación', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    tokenStore.set('token-caducado');
    const getAppointment = vi.fn(() => Promise.resolve(response(401, {
      status: 401, error: 'Unauthorized', message: 'Tu sesión ha caducado. Vuelve a iniciar sesión.', path: '/api/appointments/7', timestamp: '',
    })));
    const refresh = vi.fn(() => Promise.resolve(response(401)));
    stub({ 'GET:/api/appointments/7': getAppointment, 'POST:/api/auth/refresh': refresh });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    expect(await screen.findByRole('alert')).toHaveTextContent('Tu sesión ha caducado. Vuelve a iniciar sesión.');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getAppointment).toHaveBeenCalledTimes(1);
    expect(tokenStore.get()).toBeNull();
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });

  it('PATIENT recibe 404 al consultar una cita ajena sin ver sus datos ni acciones', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: { ...user('PATIENT', { patientId: 2 }), id: APPT_BASE.patientUserId + 1 },
    });
    const notFound = () => Promise.resolve(response(404, {
      status: 404, error: 'Not Found', message: 'Recurso no encontrado.', path: '/api/appointments/7', timestamp: '',
    }));
    const getAppointment = vi.fn(notFound);
    stub({ 'GET:/api/appointments/7': getAppointment, 'GET:/api/appointments/7/events': notFound });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    expect(await screen.findByRole('alert')).toHaveTextContent('No encontramos la cita solicitada.');
    expect(getAppointment).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Ana Pérez')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Detalles' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Eventos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reprogramar' })).not.toBeInTheDocument();
  });

  it('muestra el rechazo de BookingPolicy al cancelar y conserva la cita programada', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT', { patientId: APPT_BASE.patientId }) });
    const message = 'Solo puedes cancelar hasta 12 horas antes de la cita.';
    const cancel = vi.fn(() => Promise.resolve(response(409, {
      status: 409, error: 'Conflict', message, path: '/api/appointments/7/cancel', timestamp: '',
    })));
    stub({ 'POST:/api/appointments/7/cancel': cancel });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    await screen.findByText(/cancelar hasta 12 horas/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Programada')).toBeInTheDocument();
    expect(screen.queryByText('Cita cancelada.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sí, cancelar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
  });
});

describe('Cita — estados de eventos y disponibilidad', () => {
  it('muestra carga de eventos sin impedir consultar el detalle', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    stub({ 'GET:/api/appointments/7/events': () => gate.then(() => response(200, EVENTS)) });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    expect(await screen.findByRole('heading', { name: 'Detalles' })).toBeInTheDocument();
    expect(screen.getByText('Cargando eventos…')).toHaveAttribute('role', 'status');
    expect(screen.queryByText('Sin eventos.')).not.toBeInTheDocument();
    release();
    expect(await screen.findByText(/Cita creada/)).toBeInTheDocument();
    expect(screen.queryByText('Cargando eventos…')).not.toBeInTheDocument();
  });

  it('muestra el error de eventos sin sustituirlo por un estado vacío', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub({ 'GET:/api/appointments/7/events': () => Promise.resolve(response(500, { message: 'No se pudo consultar el historial.' })) });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo consultar el historial.');
    expect(screen.getByRole('heading', { name: 'Detalles' })).toBeInTheDocument();
    expect(screen.queryByText('Sin eventos.')).not.toBeInTheDocument();
  });

  it('muestra carga de disponibilidad para reprogramar sin ofrecer confirmación', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    stub({ 'GET:/api/availability': () => gate.then(() => response(200, AVAILABILITY)) });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    fireEvent.click(await screen.findByRole('button', { name: 'Reprogramar' }));
    expect(screen.getByRole('status')).toHaveTextContent('Cargando disponibilidad…');
    expect(screen.queryByText('Sin huecos disponibles para ese día.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar reprogramación' })).not.toBeInTheDocument();
    release();
    expect(await screen.findByRole('button', { name: '09:00–09:30' })).toBeInTheDocument();
    expect(screen.queryByText('Cargando disponibilidad…')).not.toBeInTheDocument();
  });

  it('muestra error de disponibilidad para reprogramar sin ofrecer slots ni confirmación', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub({ 'GET:/api/availability': () => Promise.resolve(response(500, { message: 'No se pudo consultar la disponibilidad.' })) });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    fireEvent.click(await screen.findByRole('button', { name: 'Reprogramar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo consultar la disponibilidad.');
    expect(screen.queryByRole('button', { name: '09:00–09:30' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar reprogramación' })).not.toBeInTheDocument();
    expect(screen.queryByText('Sin huecos disponibles para ese día.')).not.toBeInTheDocument();
  });
});

describe('Citas — stepper progresivo de recepción (UX-04)', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
  });

  /** Índice (0-based) del paso que tiene `aria-current="step"` en el rail de progreso. */
  function currentStepIndex() {
    const rail = screen.getByRole('list', { name: 'Pasos para agendar una cita' });
    return within(rail).getAllByRole('listitem')
      .findIndex((item) => item.getAttribute('aria-current') === 'step');
  }

  it('exige los datos de cada paso para avanzar y retrocede sin perder información válida', async () => {
    stub();
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });

    // Paso 1: sin paciente elegido no se puede avanzar.
    expect(currentStepIndex()).toBe(0);
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();

    await selectStaffPatient();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(currentStepIndex()).toBe(1);

    // Paso 2: sin hueco elegido no se puede pasar a la revisión.
    const stepTwoContinue = screen.getByRole('button', { name: 'Continuar' });
    expect(stepTwoContinue).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(currentStepIndex()).toBe(2);

    // Paso 3: el resumen refleja exactamente lo elegido, sin campos sin resolver.
    const review = screen.getByRole('group', { name: 'Revisión de la cita' });
    expect(within(review).getByText('Ana Pérez')).toBeInTheDocument();
    expect(within(review).getByText('Servicio de prueba 30 · 30 min')).toBeInTheDocument();
    expect(within(review).getByText('Ana Uno')).toBeInTheDocument();
    expect(within(review).getByText('09:00–09:30')).toBeInTheDocument();
    expect(within(review).queryByText('Sin seleccionar')).not.toBeInTheDocument();

    // Retroceder conserva paciente, servicio, dentista y hueco.
    fireEvent.click(screen.getByRole('button', { name: 'Atrás' }));
    expect(currentStepIndex()).toBe(1);
    expect(screen.getByLabelText('Paciente')).toHaveValue('Ana Pérez');
    expect(screen.getByLabelText('Dentista')).toHaveValue('7');
    expect(screen.getByText('Seleccionado: 09:00–09:30')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Atrás' }));
    expect(currentStepIndex()).toBe(0);
    expect(screen.getByLabelText('Paciente')).toHaveValue('Ana Pérez');
    expect(screen.getByLabelText('Servicio')).toHaveValue('30');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled());
  });

  it('previene envíos duplicados y ofrece la siguiente acción útil tras crear la cita', async () => {
    let release!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const post = vi.fn(() => pending);
    stub({ 'POST:/api/appointments': post });
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    await selectStaffPatient();

    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(currentStepIndex()).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: 'Reservar cita' }));
    // Mientras la petición está en vuelo el paso 3 se ocupa y un segundo intento no se emite.
    expect(await screen.findByRole('button', { name: 'Reservando…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reservando…' }));
    expect(post).toHaveBeenCalledTimes(1);

    await act(async () => { release(response(201, APPT_BASE)); });
    expect(await screen.findByText('Cita creada correctamente.')).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);

    // Confirmación con siguiente acción útil: abrir el detalle o empezar otra cita.
    expect(screen.getByRole('link', { name: 'Ver detalle de la cita' })).toHaveAttribute('href', '/appointments/7');
    expect(screen.getByRole('button', { name: 'Crear otra cita' })).toBeInTheDocument();
    expect(currentStepIndex()).toBe(0);
    expect(screen.queryByText('Seleccionado: 09:00–09:30')).not.toBeInTheDocument();
  });

  it('un clic en la agenda del día lleva al paso 2 con ese hueco preseleccionado', async () => {
    stub();
    renderAt(<AppointmentsPage />);
    await waitForPageSettled();
    await selectStaffPatient();
    fireEvent.click(screen.getByRole('button', { name: 'Día' }));

    const agenda = await screen.findByRole('region', { name: 'Agenda de Ana Uno' });
    fireEvent.click(await within(agenda).findByRole('button', { name: 'Reservar 09:00-09:30' }));

    expect(currentStepIndex()).toBe(1);
    expect(screen.getByLabelText('Dentista')).toHaveValue('7');
    expect(await screen.findByText('Seleccionado: 09:00–09:30')).toBeInTheDocument();
  });
});
