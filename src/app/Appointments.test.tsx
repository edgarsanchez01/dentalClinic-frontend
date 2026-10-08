import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserDto } from '../api/auth';
import { tokenStore } from '../api/http';
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
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

function todayAt(hour: number, minute: number): string {
  const now = new Date();
  return localIso(now.getFullYear(), now.getMonth() + 1, now.getDate(), hour, minute);
}

function todayLocalDate(): string {
  const now = new Date();
  return localIso(now.getFullYear(), now.getMonth() + 1, now.getDate(), 0, 0).slice(0, 10);
}

const CLINIC_SCHEDULE = {
  timezone: 'Europe/Madrid',
  days: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
    dayOfWeek,
    open: true,
    startTime: '09:00:00',
    endTime: '17:00:00',
    breaks: [{ startTime: '13:00:00', endTime: '14:00:00' }],
  })),
};

const PUBLIC = {
  timezone: 'Europe/Madrid',
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
  timezone: 'Europe/Madrid',
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
  timezone: 'Europe/Madrid',
};

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
];

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Table = Record<string, Fetcher>;

const DEFAULTS: Table = {
  'GET:/api/appointments': () => Promise.resolve(response(200, PAGE)),
  'GET:/api/appointments/7/events': () => Promise.resolve(response(200, EVENTS)),
  'GET:/api/appointments/7': () => Promise.resolve(response(200, APPT_BASE)),
  'GET:/api/public/schedule': () => Promise.resolve(response(200, PUBLIC)),
  'GET:/api/schedules/clinic': () => Promise.resolve(response(200, CLINIC_SCHEDULE)),
  'GET:/api/availability/policy': () => Promise.resolve(response(200, POLICY)),
  'GET:/api/availability': () => Promise.resolve(response(200, AVAILABILITY)),
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

function renderAt(ui: ReactNode, path = '/appointments') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/appointments" element={ui} />
          <Route path="/appointments/:id" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function waitForPageSettled() {
  await waitFor(() => expect(screen.queryByText('Cargando citas…')).not.toBeInTheDocument());
  await waitFor(() => {
    const dentist = screen.getByLabelText('Dentista') as HTMLSelectElement;
    expect(dentist.options.length).toBeGreaterThan(1);
    const patient = screen.queryByLabelText('Paciente') as HTMLSelectElement | null;
    if (patient) {
      expect(patient.options.length).toBeGreaterThan(1);
    }
  });
}

beforeEach(() => {
  tokenStore.set(null);
  useAuthStore.setState({ status: 'authenticated', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Citas — agenda por vistas', () => {
  it('OWNER ve la semana y cambia a día y mes', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub();
    renderAt(<AppointmentsPage />);

    expect(await screen.findByText('09:00 · Ana Pérez')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mes' }));
    expect(await screen.findByText('09:00 · Ana Pérez')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Ver día/ }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Día' }));
    expect(await screen.findByText('Ana Uno', { selector: 'h3' })).toBeInTheDocument();
    expect(await screen.findByText('09:00 · Ana Pérez')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Reservar / }).length).toBeGreaterThan(0);
  });

  it('filtra por dentista y estado y refresca la consulta', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    const { listUrls } = stub();
    renderAt(<AppointmentsPage />);
    await screen.findByText('09:00 · Ana Pérez');

    fireEvent.change(screen.getByLabelText('Filtrar por dentista'), { target: { value: '8' } });
    await waitFor(() => expect(listUrls.at(-1)).toContain('dentistId=8'));

    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'COMPLETED' } });
    await waitFor(() => expect(listUrls.at(-1)).toContain('status=COMPLETED'));
  });

  it('PATIENT ve su agenda sin filtros ni panel de alta', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT', { patientId: 5 }) });
    stub();
    renderAt(<AppointmentsPage />);

    expect(await screen.findByText('09:00 · Ana Pérez')).toBeInTheDocument();
    expect(screen.queryByLabelText('Filtrar por dentista')).not.toBeInTheDocument();
    expect(screen.queryByText('Nueva cita')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Solicitar cita' })).toBeInTheDocument();
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

    expect(screen.getByRole('status')).toHaveTextContent('Cargando citas…');
    release();
    expect(await screen.findByText('No hay citas en este período.')).toBeInTheDocument();
  });

  it('mantiene las rejillas de semana, mes y día aunque no haya citas', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub({
      'GET:/api/appointments': () => Promise.resolve(response(200, { ...PAGE, content: [], totalElements: 0, totalPages: 0 })),
    });
    renderAt(<AppointmentsPage />);

    expect(await screen.findByText('No hay citas en este período.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Ver día/ })).toHaveLength(7);
    expect(screen.getAllByText('Sin citas')).toHaveLength(7);

    fireEvent.click(screen.getByRole('button', { name: 'Mes' }));
    const monthDays = await screen.findAllByRole('button', { name: /^Ver día/ });
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
    await screen.findByText('No hay citas en este período.');

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
    await screen.findByText('No hay citas en este período.');

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
    expect(await screen.findByText('09:00 · Ana Pérez')).toBeInTheDocument();
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
      expect(params.get('from')).toBe(new Date(`${from}T00:00:00`).toISOString());
      expect(params.get('to')).toBe(new Date(`${to}T00:00:00`).toISOString());
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

    const days = screen.getAllByRole('button', { name: /^Ver día/ });
    expect(days).toHaveLength(count);
    expect(days.map((button) => button.textContent)).toEqual(Array.from({ length: count }, (_, index) => String(index + 1)));
    fireEvent.click(days[count - 1]);
    await expectPeriod(listUrls, last, next);
    expect(screen.getByLabelText('Fecha')).toHaveValue(last);
    expect(screen.getByRole('button', { name: 'Día' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('muestra lunes a domingo al cruzar de año y abre el domingo de la semana', async () => {
    const listUrls = renderCalendar();
    await waitForPageSettled();
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-12-31' } });
    await expectPeriod(listUrls, '2026-12-28', '2027-01-04');

    const days = screen.getAllByRole('button', { name: /^Ver día/ });
    expect(days).toHaveLength(7);
    expect(days[0]).toHaveAccessibleName(`Ver día ${new Date(2026, 11, 28).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}`);
    expect(days[6]).toHaveAccessibleName(`Ver día ${new Date(2027, 0, 3).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}`);
    fireEvent.click(days[6]);
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
    expect(ana.getByRole('status')).toHaveTextContent('Cargando disponibilidad…');
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
    expect(ana.queryByRole('status')).not.toBeInTheDocument();
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

    expect(ana.getByRole('status')).toHaveTextContent('Cargando disponibilidad…');
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

    fireEvent.change(screen.getByLabelText('Paciente'), { target: { value: '1' } });
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

    fireEvent.change(screen.getByLabelText('Paciente'), { target: { value: '1' } });
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
    fireEvent.change(screen.getByLabelText('Paciente'), { target: { value: '1' } });
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
    fireEvent.change(screen.getByLabelText('Paciente'), { target: { value: '2' } });
    await submit(3);
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '8' } });
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
    fireEvent.change(screen.getByLabelText('Paciente'), { target: { value: '1' } });
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

    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar cita' }));
    await waitFor(() => expect(screen.queryByText('Cargando citas…')).not.toBeInTheDocument());
    await waitFor(() => {
      const dentist = screen.getByLabelText('Dentista') as HTMLSelectElement;
      expect(dentist.options.length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('Dentista'), { target: { value: '7' } });
    fireEvent.click(await screen.findByRole('button', { name: '09:00–09:30' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar solicitud' }));

    await waitFor(() => expect(posts.length).toBe(1));
    const body = JSON.parse(posts[0]) as Record<string, unknown>;
    expect(body).toMatchObject({ patientId: 5, dentistId: 7 });
  });

  it('PATIENT sin perfil de paciente ve el aviso de reserva', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT') });
    stub();
    renderAt(<AppointmentsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar cita' }));
    expect(
      await screen.findByText('Completa tu perfil de paciente antes de reservar una cita.'),
    ).toBeInTheDocument();
  });
});

describe('Cita — detalle y rol', () => {
  it('DENTIST asignado ve trayectoria, cancelación y eventos en español', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST', { dentistId: 7 }) });
    stub();
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    expect(await screen.findByText(/Cita creada/)).toBeInTheDocument();
    expect(screen.getByText(/Llegada registrada/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar llegada' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Iniciar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Completar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reprogramar' })).toBeInTheDocument();
  });

  it('DENTIST no asignado no ve acciones', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST', { dentistId: 99 }) });
    stub();
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    expect(await screen.findByText(/Cita creada/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar llegada' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Completar' })).not.toBeInTheDocument();
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
    for (const name of ['Registrar llegada', 'Iniciar', 'Completar']) {
      const action = screen.queryByRole('button', { name });
      if (assigned) {
        expect(action).toBeEnabled();
      } else {
        expect(action).not.toBeInTheDocument();
      }
    }
  });

  it.each(['COMPLETED', 'CANCELLED', 'NO_SHOW'])('oculta todas las acciones en estado terminal %s', async (status) => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER', { dentistId: 7 }) });
    stub({ 'GET:/api/appointments/7': () => Promise.resolve(response(200, { ...APPT_BASE, status })) });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    expect(await screen.findByText('La cita está en estado terminal: no se permiten nuevas acciones.')).toBeInTheDocument();
    for (const name of ['Cancelar', 'Reprogramar', 'Registrar llegada', 'Iniciar', 'Completar', 'Registrar no asistencia', 'Deshacer']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: 'Detalles' })).toBeInTheDocument();
    expect(await screen.findByText(/Cita creada/)).toBeInTheDocument();
  });
});

describe('Cita — acciones', () => {
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

  it('completa con confirmación de dos pasos', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST', { dentistId: 7 }) });
    let posted = false;
    stub({
      'POST:/api/appointments/7/complete': () => {
        posted = true;
        return Promise.resolve(response(200, { ...APPT_BASE, status: 'COMPLETED' }));
      },
    });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    fireEvent.click(await screen.findByRole('button', { name: 'Completar' }));
    expect(screen.getByText('¿Completar la cita?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, completar' }));
    await waitFor(() => expect(posted).toBe(true));
  });

  it('registra llegada e inicio desde la trayectoria', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST', { dentistId: 7 }) });
    const posted: string[] = [];
    stub({
      'POST:/api/appointments/7/arrive': () => {
        posted.push('arrive');
        return Promise.resolve(
          response(200, { id: 5, eventType: 'PATIENT_ARRIVED', actorUserId: 7, occurrenceVersion: 1, createdAt: todayAt(9, 0) }),
        );
      },
      'POST:/api/appointments/7/start': () => {
        posted.push('start');
        return Promise.resolve(
          response(200, { id: 6, eventType: 'APPOINTMENT_STARTED', actorUserId: 7, occurrenceVersion: 1, createdAt: todayAt(9, 5) }),
        );
      },
    });
    renderAt(<AppointmentDetailPage />, '/appointments/7');

    fireEvent.click(await screen.findByRole('button', { name: 'Registrar llegada' }));
    await waitFor(() => expect(posted).toContain('arrive'));
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar' }));
    await waitFor(() => expect(posted).toContain('start'));
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
    { name: 'Completar', confirm: 'Sí, completar', endpoint: 'complete' },
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
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT', { patientId: 5 }) });
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
    expect(screen.getByRole('status')).toHaveTextContent('Cargando eventos…');
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
