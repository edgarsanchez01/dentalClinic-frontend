import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserDto } from '../api/auth';
import { tokenStore } from '../api/http';
import { PublicSchedulePage } from '../components/scheduling/PublicSchedulePage';
import { SchedulingPage } from '../components/scheduling/SchedulingPage';
import { useAuthStore } from './authStore';

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

function user(role: UserDto['role']): UserDto {
  return {
    id: 10,
    email: `${role.toLowerCase()}@clinica.com`,
    role,
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function renderPage(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const CLINIC_SCHEDULE = {
  timezone: 'Europe/Madrid',
  days: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
    dayOfWeek,
    open: dayOfWeek <= 5,
    startTime: dayOfWeek <= 5 ? '09:00:00' : null,
    endTime: dayOfWeek <= 5 ? '17:00:00' : null,
    breaks: [],
  })),
};

const POLICY = {
  maxAdvanceDays: 90,
  minBookingLeadTimeHours: 2,
  cancellationLeadTimeHours: 12,
  timezone: 'Europe/Madrid',
};

const PUBLIC = {
  timezone: 'Europe/Madrid',
  days: [{ dayOfWeek: 1, open: true, startTime: '09:00:00', endTime: '17:00:00' }],
  exceptions: [{ date: '2026-10-12', closed: true, startTime: null, endTime: null }],
  dentists: [{ dentistId: 7, firstName: 'Ana', lastName: 'Uno', specialty: null, days: [] }],
};

const DENTIST_SCHEDULE = { dentistId: 7, timezone: 'Europe/Madrid', days: CLINIC_SCHEDULE.days };

function stubApi(overrides: Record<string, () => Promise<Response>> = {}) {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [key, value] of Object.entries(overrides)) {
      if (url.includes(key)) return value();
    }
    if (url.includes('/api/availability/policy')) return Promise.resolve(response(200, POLICY));
    if (url.includes('/api/availability')) return Promise.resolve(response(200, { dentistId: 7, durationMinutes: 30, timezone: 'Europe/Madrid', slots: [] }));
    if (url.includes('/api/public/schedule')) return Promise.resolve(response(200, PUBLIC));
    // Los patrones más concretos deben ir antes que el prefijo común.
    if (url.includes('/api/schedules/clinic/exceptions')) return Promise.resolve(response(200, []));
    if (url.includes('/api/schedules/clinic')) return Promise.resolve(response(200, CLINIC_SCHEDULE));
    if (url.includes('/api/schedules/dentist/7/exceptions')) return Promise.resolve(response(200, []));
    if (url.includes('/api/schedules/dentist/7/time-off')) return Promise.resolve(response(200, []));
    if (url.includes('/api/schedules/dentist/7')) return Promise.resolve(response(200, DENTIST_SCHEDULE));
    return Promise.reject(new Error(`Sin stub para ${url}`));
  });
}

beforeEach(() => {
  tokenStore.set(null);
  useAuthStore.setState({ status: 'authenticated', user: null });
  // Las acciones destructivas piden confirmación explícita; por defecto se acepta.
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Scheduling — horarios', () => {
  it('F7 OWNER agrupa editores persistentes y separa consulta pública de identidad editable', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stubApi({ '/api/public/schedule': () => Promise.resolve(response(200, { ...PUBLIC, dentists: [...PUBLIC.dentists, { ...PUBLIC.dentists[0], dentistId: 8, firstName: 'Otro' }] })) });
    const requests = vi.spyOn(globalThis, 'fetch');
    renderPage(<SchedulingPage />);
    const clinic = within(screen.getByRole('region', { name: 'Gestión de clínica' }));
    const professionals = within(screen.getByRole('region', { name: 'Gestión de profesionales' }));
    const availability = within(screen.getByRole('region', { name: 'Consulta pública de disponibilidad' }));
    const input = await clinic.findByLabelText('Inicio Lunes');
    fireEvent.change(input, { target: { value: '10:15' } });
    const reason = await clinic.findByLabelText('Motivo (opcional)');
    fireEvent.change(reason, { target: { value: 'Borrador clínica' } });
    const privateReads = () => requests.mock.calls.filter(([url]) => String(url).includes('/schedules/dentist/8'));
    expect(privateReads()).toHaveLength(0);
    fireEvent.change(await availability.findByLabelText('Dentista'), { target: { value: '8' } });
    expect(professionals.getByRole('combobox')).toHaveValue('7');
    expect(privateReads()).toHaveLength(0);
    expect(clinic.getByLabelText('Inicio Lunes')).toBe(input);
    expect(input).toHaveValue('10:15');
    expect(reason).toHaveValue('Borrador clínica');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Apartados de horarios' }).querySelectorAll('a')).toHaveLength(3);
    expect(document.querySelectorAll('.schedule-week-primary')).toHaveLength(2);
    expect(document.querySelector('#schedule-clinic .schedule-week-primary')).toContainElement(input);
  });

  it('OWNER ve el editor de la clínica y el horario de dentistas', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stubApi();

    renderPage(<SchedulingPage />);

    expect(await screen.findByText('Horario de la clínica')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Guardar horario' })).toBeInTheDocument();
    expect(await screen.findByText('Horario de dentistas')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Registrar ausencia' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Excepciones por fecha' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Ausencias' })).toBeVisible();
    expect(document.querySelector('main') ?? document.body).not.toHaveTextContent(/franquicia/i);
  });

  it('RECEPTIONIST consulta en solo lectura, sin acciones de escritura', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
    stubApi();

    renderPage(<SchedulingPage />);

    expect(await screen.findByText('Horario de la clínica')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar horario' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar política' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar ausencia' })).not.toBeInTheDocument();
  });

  it('calcula y muestra los huecos de disponibilidad', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stubApi({
      '/api/availability': () =>
        Promise.resolve(
          response(200, {
            dentistId: 7,
            durationMinutes: 30,
            timezone: 'Europe/Madrid',
            slots: [
              { startDate: '2026-10-06', startTime: '09:00:00', endTime: '09:30:00', start: '2026-10-06T07:00:00Z', end: '2026-10-06T07:30:00Z' },
            ],
          }),
        ),
    });

    renderPage(<SchedulingPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText('09:00–09:30')).toBeInTheDocument();
  });
});

describe('Horario público', () => {
  it('muestra la apertura semanal, excepciones y dentistas sin sesión', async () => {
    stubApi();
    renderPage(<PublicSchedulePage />);

    expect(await screen.findByText('Horario de apertura')).toBeInTheDocument();
    expect(await screen.findByText('09:00–17:00')).toBeInTheDocument();
    expect(await screen.findByText('Excepciones')).toBeInTheDocument();
    expect(await screen.findByText('Ana Uno')).toBeInTheDocument();
  });
});

describe('DC-DENT-SCHED-UX-01 BUILD-01 — apartados de gestión', () => {
  function setup() {
    useAuthStore.setState({ user: { ...user('DENTIST'), dentistId: 7 } });
    stubApi({
      '/api/public/schedule': async () => response(200, { ...PUBLIC, dentists: [
        ...PUBLIC.dentists, { ...PUBLIC.dentists[0], dentistId: 8, firstName: 'Otro' },
      ] }),
      '/api/schedules/dentist/8/exceptions': async () => response(200, []),
      '/api/schedules/dentist/8/time-off': async () => response(200, []),
      '/api/schedules/dentist/8': async () => response(200, { ...DENTIST_SCHEDULE, dentistId: 8 }),
    });
    return renderPage(<SchedulingPage />);
  }

  async function management() {
    await screen.findByRole('tablist', { name: 'Gestionar mi horario' });
    const tools = document.getElementById('professional-schedule-tools')!;
    const edit = await within(tools).findByRole('button', { name: 'Editar horario' });
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    await within(tools).findByLabelText('Inicio Lunes');
    return tools;
  }

  function select(tools: HTMLElement, name: string) {
    fireEvent.click(within(tools).getByRole('tab', { name }));
    return within(tools).getByRole('tabpanel', { name });
  }

  it('inicia en Mi semana, mantiene tres paneles montados y no cambia la URL', async () => {
    setup();
    const tools = await management();
    const url = window.location.href;
    const tabs = within(tools).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Mi semana', 'Excepciones', 'Ausencias']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute('aria-controls')!)!;
      expect(panel).toHaveAttribute('role', 'tabpanel');
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
      select(tools, tab.textContent!);
      expect(within(tools).getAllByRole('tabpanel')).toEqual([panel]);
      expect(within(tools).getAllByRole('tabpanel', { hidden: true })).toHaveLength(3);
      expect(within(tools).getAllByRole('tab', { selected: true })).toEqual([tab]);
    }
    expect(window.location.href).toBe(url);
  });

  it('flechas, Home y End recorren las pestañas sin activarlas ni mover el foco al formulario', async () => {
    setup();
    const tools = await management();
    const [week, exceptions, absences] = within(tools).getAllByRole('tab');
    act(() => week.focus());
    for (const [key, target] of [
      ['ArrowRight', exceptions], ['End', absences], ['ArrowRight', week],
      ['ArrowLeft', absences], ['Home', week],
    ] as const) {
      fireEvent.keyDown(document.activeElement!, { key });
      expect(target).toHaveFocus();
      expect(target).toHaveAttribute('tabindex', '0');
      expect(within(tools).getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toEqual([target]);
      expect(week).toHaveAttribute('aria-selected', 'true');
    }
  });

  it('conserva las mismas instancias, valores y errores de los tres editores al alternar', async () => {
    setup();
    const tools = await management();
    const week = select(tools, 'Mi semana');
    const start = within(week).getByLabelText('Inicio Lunes');
    fireEvent.change(start, { target: { value: '' } });
    fireEvent.submit(start.closest('form')!);
    expect(within(week).getByText('Lunes: indica la hora de apertura y la de cierre.')).toBeVisible();

    const exceptions = select(tools, 'Excepciones');
    fireEvent.click(within(exceptions).getByRole('button', { name: 'Nueva excepción' }));
    const date = within(exceptions).getByLabelText('Fecha');
    fireEvent.change(date, { target: { value: '2026-11-05' } });
    fireEvent.click(within(exceptions).getByLabelText('Cerrado todo el día'));
    fireEvent.submit(date.closest('form')!);
    expect(within(exceptions).getByText('Indica la hora de apertura y la de cierre de la excepción.')).toBeVisible();

    const absences = select(tools, 'Ausencias');
    fireEvent.click(within(absences).getByRole('button', { name: 'Nueva ausencia' }));
    const reason = await within(absences).findByLabelText('Motivo (opcional)');
    fireEvent.change(reason, { target: { value: 'Borrador de ausencia' } });
    fireEvent.click(within(absences).getByLabelText('Todo el día (permite varios días)'));
    fireEvent.submit(reason.closest('form')!);
    expect(within(absences).getByText('Indica la hora de inicio y la de fin de la ausencia parcial.')).toBeVisible();

    select(tools, 'Mi semana');
    expect(within(week).getByLabelText('Inicio Lunes')).toBe(start);
    expect(start).toHaveValue('');
    expect(within(week).getByText('Lunes: indica la hora de apertura y la de cierre.')).toBeVisible();
    select(tools, 'Excepciones');
    expect(within(exceptions).getByLabelText('Fecha')).toBe(date);
    expect(date).toHaveValue('2026-11-05');
    expect(within(exceptions).getByText('Indica la hora de apertura y la de cierre de la excepción.')).toBeVisible();
    select(tools, 'Ausencias');
    expect(within(absences).getByLabelText('Motivo (opcional)')).toBe(reason);
    expect(reason).toHaveValue('Borrador de ausencia');
    expect(within(absences).getByText('Indica la hora de inicio y la de fin de la ausencia parcial.')).toBeVisible();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it.each(['usuario', 'profesional', 'sesión'] as const)('no reutiliza paneles ni borradores al cambiar de %s', async (boundary) => {
    setup();
    let tools = await management();
    const start = within(tools).getByLabelText('Inicio Lunes');
    fireEvent.change(start, { target: { value: '' } });
    fireEvent.submit(start.closest('form')!);
    const exceptions = select(tools, 'Excepciones');
    fireEvent.click(within(exceptions).getByRole('button', { name: 'Nueva excepción' }));
    fireEvent.change(within(exceptions).getByLabelText('Motivo (opcional)'), { target: { value: 'Excepción anterior' } });
    const absences = select(tools, 'Ausencias');
    fireEvent.click(within(absences).getByRole('button', { name: 'Nueva ausencia' }));
    fireEvent.change(await within(absences).findByLabelText('Motivo (opcional)'), { target: { value: 'Ausencia anterior' } });
    act(() => {
      const state = useAuthStore.getState();
      if (boundary === 'sesión') useAuthStore.setState({ sessionVersion: state.sessionVersion + 1 });
      else useAuthStore.setState({ user: { ...state.user!, ...(boundary === 'usuario' ? { id: 11 } : { dentistId: 8 }) } });
    });
    // The consultation boundary also replaces the management container on a profile change.
    tools = document.getElementById('professional-schedule-tools')!;
    const edit = await within(tools).findByRole('button', { name: 'Editar horario' });
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    await waitFor(() => expect(within(tools).getByLabelText('Inicio Lunes')).toHaveValue('09:00'));
    expect(start).not.toBeInTheDocument();
    expect(within(tools).getByRole('tab', { name: 'Mi semana' })).toHaveAttribute('aria-selected', 'true');
    expect(within(tools).queryByText('Lunes: indica la hora de apertura y la de cierre.')).not.toBeInTheDocument();
    const newExceptions = select(tools, 'Excepciones');
    expect(within(newExceptions).queryByLabelText('Motivo (opcional)')).not.toBeInTheDocument();
    await waitFor(() => expect(within(newExceptions).getByRole('button', { name: 'Nueva excepción' })).toBeEnabled());
    fireEvent.click(within(newExceptions).getByRole('button', { name: 'Nueva excepción' }));
    expect(within(newExceptions).getByLabelText('Motivo (opcional)')).toHaveValue('');
    const newAbsences = select(tools, 'Ausencias');
    fireEvent.click(await within(newAbsences).findByRole('button', { name: 'Nueva ausencia' }));
    expect(await within(newAbsences).findByLabelText('Motivo (opcional)')).toHaveValue('');
  });
});

describe('Scheduling — permisos H-A05', () => {
  const directory = { ...PUBLIC, dentists: [
    { ...PUBLIC.dentists[0], dentistId: 8, firstName: 'Luis', lastName: 'Dos' },
    PUBLIC.dentists[0],
  ] };
  const timeOff = { id: 40, startDate: '2026-10-15', endDate: '2026-10-16', allDay: true };
  const clinicException = { date: '2026-11-02', closed: true, startTime: null, endTime: null, reason: 'Festivo' };
  const dentistException = { date: '2026-11-03', closed: false, startTime: '10:00:00', endTime: '14:00:00', reason: null };

  function backend(options: { fail?: boolean; pending?: boolean } = {}) {
    const requests: Array<{ method: string; path: string }> = [];
    let release!: () => void;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      const method = init?.method ?? 'GET';
      requests.push({ method, path });
      if (path === '/api/public/schedule') return Promise.resolve(response(200, directory));
      if (path === '/api/schedules/clinic/exceptions') {
        if (method !== 'GET') return Promise.resolve(response(method === 'DELETE' ? 204 : 200, clinicException));
        return Promise.resolve(response(200, []));
      }
      if (path.startsWith('/api/schedules/clinic/exceptions/')) {
        if (method === 'DELETE') return Promise.resolve(response(204));
        return Promise.resolve(response(200, clinicException));
      }
      if (path === '/api/schedules/clinic') return Promise.resolve(response(200, CLINIC_SCHEDULE));
      if (path === '/api/availability/policy') return Promise.resolve(response(200, POLICY));
      const dentExceptions = path.match(/^\/api\/schedules\/dentist\/(\d+)\/exceptions(?:\/(\d{4}-\d{2}-\d{2}))?$/);
      if (dentExceptions) {
        const dentistId = Number(dentExceptions[1]);
        if (method === 'GET') {
          return Promise.resolve(options.fail
            ? response(404, { message: 'No encontrado' })
            : response(200, dentistId === 99 ? [dentistException] : []));
        }
        if (method === 'DELETE') return Promise.resolve(response(204));
        return Promise.resolve(response(200, dentistException));
      }
      const match = path.match(/^\/api\/schedules\/dentist\/(\d+)(\/time-off(?:\/\d+)?)?$/);
      if (match) {
        const dentistId = Number(match[1]);
        if (method !== 'GET') return Promise.resolve(response(method === 'DELETE' ? 204 : 200,
          match[2] ? timeOff : { ...DENTIST_SCHEDULE, dentistId }));
        const actor = useAuthStore.getState().user;
        const result = options.fail || (actor?.role === 'DENTIST' && actor.dentistId !== dentistId)
          ? response(404, { message: 'No encontrado' })
          : response(200, match[2] ? [timeOff] : { ...DENTIST_SCHEDULE, dentistId });
        if (options.pending && match[2]) return new Promise<Response>((resolve) => { release = () => resolve(result); });
        return Promise.resolve(result);
      }
      return Promise.reject(new Error(`Sin stub para ${method} ${path}`));
    });
    return { requests, release: () => release(), writes: () => requests.filter(({ method }) => method !== 'GET') };
  }

  function section(title: string) {
    const own = useAuthStore.getState().user?.role === 'DENTIST' && title === 'Horario de dentistas';
    return screen.getByRole('heading', { name: own ? 'Gestionar mi horario' : title === 'Horario del dentista' ? 'Horario semanal' : title }).closest('section')!;
  }

  async function dentistSection() {
    const title = useAuthStore.getState().user?.role === 'RECEPTIONIST' ? 'Horario del dentista' : 'Horario de dentistas';
    if (useAuthStore.getState().user?.role === 'RECEPTIONIST') {
      await screen.findByRole('button', { name: 'Cambiar dentista' });
      return section(title);
    }
    const panel = section(title);
    if (useAuthStore.getState().user?.role === 'DENTIST') {
      await within(panel).findByRole('tab', { name: 'Mi semana' });
      return panel;
    }
    // UX-04G.2 reception uses one page-wide context, outside availability and the weekly panel.
    await waitFor(() => expect(useAuthStore.getState().user?.role === 'RECEPTIONIST'
      ? screen.getByRole('button', { name: 'Cambiar dentista' }) : within(panel).getByLabelText('Dentista')).toBeInTheDocument());
    return section(title);
  }

  async function loadedWeek(panel: HTMLElement) {
    if (useAuthStore.getState().user?.role === 'DENTIST' && !within(panel).queryByLabelText('Inicio Lunes')) {
      const edit = await within(panel).findByRole('button', { name: 'Editar horario' });
      await waitFor(() => expect(edit).toBeEnabled());
      fireEvent.click(edit);
    }
    await waitFor(() => expect(within(panel).getByLabelText('Inicio Lunes')).toBeInTheDocument());
  }

  async function flushMutations() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }

  it('DENTIST inicia en su perfil aunque no sea el primero y no ofrece el perfil ajeno privado', async () => {
    useAuthStore.setState({ user: { ...user('DENTIST'), dentistId: 7 } });
    const api = backend();
    renderPage(<SchedulingPage />);
    const panel = await dentistSection();
    expect(within(panel).queryByLabelText('Dentista')).not.toBeInTheDocument();
    expect(within(panel).queryByRole('option', { name: 'Luis Dos' })).not.toBeInTheDocument();
    await loadedWeek(panel);
    expect(within(panel).getByRole('button', { name: 'Guardar horario' })).toBeEnabled();
    await within(panel).findByText('2026-10-15 → 2026-10-16 (todo el día)');
    fireEvent.click(within(panel).getByRole('tab', { name: 'Ausencias' }));
    fireEvent.click(await within(panel).findByRole('button', { name: 'Nueva ausencia' }));
    expect(within(panel).getByRole('button', { name: 'Registrar ausencia' })).toBeEnabled();
    expect(api.requests.some(({ path }) => path.startsWith('/api/schedules/dentist/8'))).toBe(false);
    // Public availability remains consultable for other professionals.
    expect(within(section('Consultar disponibilidad')).getByRole('option', { name: 'Luis Dos' })).toBeInTheDocument();
  });

  it('DENTIST no tiene selector privado; consultar otro perfil público no cambia sus herramientas', async () => {
    useAuthStore.setState({ user: { ...user('DENTIST'), dentistId: 7 } });
    const api = backend();
    renderPage(<SchedulingPage />);
    const panel = await dentistSection();
    expect(within(panel).queryByLabelText('Dentista')).not.toBeInTheDocument();
    await loadedWeek(panel);
    api.requests.length = 0;
    fireEvent.change(within(section('Consultar disponibilidad')).getByLabelText('Dentista'), { target: { value: '8' } });
    await flushMutations();
    expect(within(panel).getByLabelText('Inicio Lunes')).toHaveValue('09:00');
    expect(api.requests.some(({ path }) => path.startsWith('/api/schedules/dentist/8'))).toBe(false);
    expect(api.writes()).toEqual([]);
  });

  it.each(['OWNER', 'DENTIST'] as const)('%s conserva guardar semana y añadir/eliminar ausencias autorizadas', async (role) => {
    useAuthStore.setState({ user: { ...user(role), dentistId: 7 } });
    const api = backend();
    renderPage(<SchedulingPage />);
    const panel = await dentistSection();
    const target = role === 'OWNER' ? '8' : '7';
    if (role === 'OWNER') fireEvent.change(within(panel).getByLabelText('Dentista'), { target: { value: target } });
    await loadedWeek(panel);
    await within(panel).findByText('2026-10-15 → 2026-10-16 (todo el día)');
    fireEvent.click(within(panel).getByRole('button', { name: 'Guardar horario' }));
    await waitFor(() => expect(api.writes()).toContainEqual({ method: 'PUT', path: `/api/schedules/dentist/${target}` }));
    if (role === 'DENTIST') {
      fireEvent.click(within(panel).getByRole('tab', { name: 'Ausencias' }));
      fireEvent.click(within(panel).getByRole('button', { name: 'Nueva ausencia' }));
    }
    fireEvent.click(within(panel).getByRole('button', { name: 'Registrar ausencia' }));
    await waitFor(() => expect(api.writes()).toContainEqual({ method: 'POST', path: `/api/schedules/dentist/${target}/time-off` }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(api.writes()).toContainEqual({ method: 'DELETE', path: `/api/schedules/dentist/${target}/time-off/40` }));
    expect(api.writes()).toHaveLength(3);
    if (role === 'OWNER') {
      fireEvent.click(within(section('Horario de la clínica')).getByRole('button', { name: 'Guardar horario' }));
      fireEvent.click(within(section('Política de reservas')).getByRole('button', { name: 'Guardar política' }));
      await waitFor(() => expect(api.writes()).toHaveLength(5));
      expect(api.writes()).toContainEqual({ method: 'PUT', path: '/api/schedules/clinic' });
      expect(api.writes()).toContainEqual({ method: 'PUT', path: '/api/availability/policy' });
    } else {
      const clinic = section('Horario de la clínica');
      expect(within(clinic).queryByLabelText('Inicio Lunes')).not.toBeInTheDocument();
      expect(within(clinic).getByText('Lunes')).toBeInTheDocument();
      expect(within(clinic).queryByRole('button', { name: 'Guardar horario' })).not.toBeInTheDocument();
      await flushMutations();
      expect(api.writes()).toHaveLength(3);
    }
  });

  it('RECEPTIONIST lee ambos perfiles; ni controles ni submit forzado escriben horarios', async () => {
    useAuthStore.setState({ user: user('RECEPTIONIST') });
    const api = backend();
    renderPage(<SchedulingPage />);
    const panel = await dentistSection();
    await within(panel).findByText('Lunes');
    expect(within(panel).queryByLabelText('Inicio Lunes')).not.toBeInTheDocument();
    expect(within(panel).getAllByText('09:00–17:00').length).toBeGreaterThan(0);
    expect(within(panel).queryByRole('button', { name: /Guardar|Registrar ausencia|Eliminar/ })).not.toBeInTheDocument();
    await waitFor(() => expect(within(section('Horario de la clínica')).getByText('Lunes')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar dentista' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Buscar dentista' }), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('option', { name: 'Ana Uno' }));
    await within(section('Horario del dentista')).findByText('Lunes');
    expect(screen.getByText('Ana Uno', { selector: '.rs-selected-name' })).toBeInTheDocument();
    await flushMutations();
    expect(api.requests.some(({ path }) => path === '/api/schedules/dentist/7')).toBe(true);
    expect(api.writes()).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Guardar política' })).not.toBeInTheDocument();
  });

  it('DENTIST sin asociación no toma el primer perfil como propio ni consulta endpoints privados de dentistas', async () => {
    useAuthStore.setState({ user: user('DENTIST') });
    const api = backend();
    renderPage(<SchedulingPage />);
    await within(section('Consultar disponibilidad')).findByRole('option', { name: 'Luis Dos' });
    expect(within(section('Horario de dentistas')).queryByLabelText('Dentista')).not.toBeInTheDocument();
    expect(api.requests.some(({ path }) => path.startsWith('/api/schedules/dentist/'))).toBe(false);
    expect(api.writes()).toEqual([]);
  });

  it('PATIENT no monta la gestión administrativa ni envía peticiones privadas', async () => {
    useAuthStore.setState({ user: user('PATIENT') });
    const api = backend();
    renderPage(<SchedulingPage />);
    await flushMutations();
    expect(screen.queryByText('Horario de dentistas')).not.toBeInTheDocument();
    expect(screen.queryByText('Horario de la clínica')).not.toBeInTheDocument();
    expect(api.requests).toEqual([]);
  });

  it('no ofrece alta de ausencias mientras la lectura está pendiente', async () => {
    useAuthStore.setState({ user: { ...user('DENTIST'), dentistId: 7 } });
    const api = backend({ pending: true });
    renderPage(<SchedulingPage />);
    const panel = await dentistSection();
    await loadedWeek(panel);
    fireEvent.click(within(panel).getByRole('tab', { name: 'Ausencias' }));
    expect(within(panel).queryByRole('button', { name: 'Registrar ausencia' })).not.toBeInTheDocument();
    await act(async () => api.release());
    fireEvent.click(await within(panel).findByRole('button', { name: 'Nueva ausencia' }));
    expect(await within(panel).findByRole('button', { name: 'Registrar ausencia' })).toBeEnabled();
  });

  it('un error de lectura no habilita escritura ni deja una carga eterna', async () => {
    useAuthStore.setState({ user: { ...user('DENTIST'), dentistId: 7 } });
    const api = backend({ fail: true });
    renderPage(<SchedulingPage />);
    const panel = await dentistSection();
    await flushMutations();
    expect(within(panel).queryByRole('button', { name: 'Registrar ausencia' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Guardar horario' })).not.toBeInTheDocument();
    expect(within(panel).queryAllByRole('alert').length).toBeGreaterThan(0);
    expect(api.writes()).toEqual([]);
  });

  it.each(['semana', 'alta', 'borrado'].flatMap((action) => [
    { action, label: 'rol', next: user('RECEPTIONIST') },
    { action, label: 'asociación', next: { ...user('DENTIST'), dentistId: 8 } },
  ]))('el manejador ya obtenido de $action revalida $label antes de enviar HTTP', async ({ action, next }) => {
    useAuthStore.setState({ user: { ...user('DENTIST'), dentistId: 7 } });
    const api = backend();
    renderPage(<SchedulingPage />);
    const panel = await dentistSection();
    await loadedWeek(panel);
    await within(panel).findByText('2026-10-15 → 2026-10-16 (todo el día)');
    if (action !== 'semana') fireEvent.click(within(panel).getByRole('tab', { name: 'Ausencias' }));
    if (action === 'alta') fireEvent.click(within(panel).getByRole('button', { name: 'Nueva ausencia' }));
    const target = action === 'semana' ? within(panel).getByLabelText('Inicio Lunes').closest('form')!
      : action === 'alta' ? within(panel).getByRole('button', { name: 'Registrar ausencia' }).closest('form')!
      : within(panel).getByRole('button', { name: 'Eliminar' });
    act(() => {
      useAuthStore.setState({ user: next });
      if (action === 'borrado') fireEvent.click(target);
      else fireEvent.submit(target);
    });
    await flushMutations();
    expect(api.writes()).toEqual([]);
  });
});

describe('Scheduling — excepciones y franquicias (Fase 7)', () => {
  const CLINIC_EXCEPTION = {
    date: '2026-11-02',
    closed: true,
    startTime: null,
    endTime: null,
    reason: 'Festivo',
  };
  const DENTIST_EXCEPTION = {
    date: '2026-11-03',
    closed: false,
    startTime: '10:00:00',
    endTime: '14:00:00',
    reason: null,
  };
  const TIME_OFF = {
    id: 40,
    startDate: '2026-10-15',
    endDate: '2026-10-16',
    allDay: true,
    startTime: null,
    endTime: null,
    reason: null,
  };

  interface CrudOptions {
    clinicExceptions?: Record<string, unknown>[];
    dentistExceptions?: Record<string, unknown>[];
    timeOffs?: Record<string, unknown>[];
    clinicExceptionsFail?: boolean;
    timeOffFail?: boolean;
    clinicSchedule?: typeof CLINIC_SCHEDULE;
  }

  function crud(options: CrudOptions = {}) {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];
    let clinic = [...(options.clinicExceptions ?? [])];
    let dentist = [...(options.dentistExceptions ?? [])];
    let offs = [...(options.timeOffs ?? [])];
    const ok = (status: number, body?: unknown) => Promise.resolve(response(status, body));

    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (method !== 'GET') calls.push({ method, path, body });

      if (path === '/api/public/schedule') return ok(200, PUBLIC);
      if (path === '/api/availability/policy') return ok(200, POLICY);
      if (path === '/api/schedules/clinic') return ok(200, options.clinicSchedule ?? CLINIC_SCHEDULE);

      if (path === '/api/schedules/clinic/exceptions') {
        if (options.clinicExceptionsFail) return ok(500, { message: 'Error' });
        return ok(200, clinic);
      }
      const clinicMatch = path.match(/^\/api\/schedules\/clinic\/exceptions\/(\d{4}-\d{2}-\d{2})$/);
      if (clinicMatch) {
        const date = clinicMatch[1];
        if (method === 'DELETE') {
          clinic = clinic.filter((row) => row.date !== date);
          return ok(204);
        }
        const row = {
          date,
          closed: Boolean(body.closed),
          startTime: body.startTime ?? null,
          endTime: body.endTime ?? null,
          reason: body.reason ?? null,
        };
        clinic = [...clinic.filter((existing) => existing.date !== date), row];
        return ok(200, row);
      }

      if (path === '/api/schedules/dentist/7/exceptions') return ok(200, dentist);
      const dentistMatch = path.match(/^\/api\/schedules\/dentist\/7\/exceptions\/(\d{4}-\d{2}-\d{2})$/);
      if (dentistMatch) {
        const date = dentistMatch[1];
        if (method === 'DELETE') {
          dentist = dentist.filter((row) => row.date !== date);
          return ok(204);
        }
        const row = {
          date,
          closed: Boolean(body.closed),
          startTime: body.startTime ?? null,
          endTime: body.endTime ?? null,
          reason: body.reason ?? null,
        };
        dentist = [...dentist.filter((existing) => existing.date !== date), row];
        return ok(200, row);
      }

      if (path === '/api/schedules/dentist/7/time-off') {
        if (options.timeOffFail) return ok(500, { message: 'Error' });
        if (method === 'POST') {
            const row = { id: 50, allDay: body.startTime == null && body.endTime == null, ...body };
          offs = [...offs, row];
          return ok(201, row);
        }
        return ok(200, offs);
      }
      const offMatch = path.match(/^\/api\/schedules\/dentist\/7\/time-off\/(\d+)$/);
      if (offMatch) {
        const id = Number(offMatch[1]);
        if (method === 'DELETE') {
          offs = offs.filter((row) => row.id !== id);
          return ok(204);
        }
        const row = { id, allDay: body.startTime == null && body.endTime == null, ...body };
        offs = offs.map((existing) => (existing.id === id ? row : existing));
        return ok(200, row);
      }

      if (path === '/api/schedules/dentist/7') return ok(200, DENTIST_SCHEDULE);
      return Promise.reject(new Error(`Sin stub para ${method} ${path}`));
    });

    return {
      writes: () => calls.filter(({ method }) => method !== 'GET').map(({ method, path }) => ({ method, path })),
      lastBody: (method: string, path: string) =>
        [...calls].reverse().find((call) => call.method === method && call.path === path)?.body,
    };
  }

  function section(title: string) {
    return screen.getByRole('heading', { name: title }).closest('section')!;
  }

  async function block(title: string) {
    if (useAuthStore.getState().user?.role === 'DENTIST') {
      const tab = title === 'Excepciones por fecha' ? 'Excepciones' : title === 'Ausencias' ? 'Ausencias' : null;
      if (tab) fireEvent.click(await screen.findByRole('tab', { name: tab }));
      if (title === 'Excepciones por fecha') {
        const create = await screen.findByRole('button', { name: 'Nueva excepción' });
        await waitFor(() => expect(create).toBeEnabled());
        fireEvent.click(create);
      }
      if (title === 'Ausencias') {
        const create = await screen.findByRole('button', { name: 'Nueva ausencia' });
        await waitFor(() => expect(create).toBeEnabled());
        fireEvent.click(create);
      }
    }
    const heading = await screen.findByRole('heading', { name: title === 'Ausencias' && useAuthStore.getState().user?.role === 'DENTIST' ? 'Ausencias programadas' : title });
    return useAuthStore.getState().user?.role === 'DENTIST' ? heading.closest('[role="tabpanel"]') as HTMLElement : heading.closest('div')!;
  }

  it('OWNER crea, edita y elimina una excepción de la clínica', async () => {
    useAuthStore.setState({ user: user('OWNER') });
    const api = crud();
    renderPage(<SchedulingPage />);

    const panel = section('Excepciones de la clínica');
    await within(panel).findByText('Sin excepciones registradas.');

    fireEvent.change(within(panel).getByLabelText('Fecha'), { target: { value: '2026-11-02' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Añadir excepción' }));
    await waitFor(() =>
      expect(api.writes()).toContainEqual({ method: 'PUT', path: '/api/schedules/clinic/exceptions/2026-11-02' }),
    );
    expect(api.lastBody('PUT', '/api/schedules/clinic/exceptions/2026-11-02')).toEqual({
      closed: true,
      startTime: null,
      endTime: null,
      reason: null,
    });

    await within(panel).findByText(/2026-11-02/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Editar' }));
    fireEvent.change(within(panel).getByLabelText('Motivo (opcional)'), { target: { value: 'Festivo local' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(api.lastBody('PUT', '/api/schedules/clinic/exceptions/2026-11-02')).toEqual({
        closed: true,
        startTime: null,
        endTime: null,
        reason: 'Festivo local',
      }),
    );

    fireEvent.click(within(panel).getByRole('button', { name: 'Eliminar excepción' }));
    await waitFor(() =>
      expect(api.writes()).toContainEqual({ method: 'DELETE', path: '/api/schedules/clinic/exceptions/2026-11-02' }),
    );
    await within(panel).findByText('Sin excepciones registradas.');
  });

  it('exige horas cuando la excepción no cubre el día completo y no envía nada', async () => {
    useAuthStore.setState({ user: user('OWNER') });
    const api = crud();
    renderPage(<SchedulingPage />);

    const panel = section('Excepciones de la clínica');
    await within(panel).findByText('Sin excepciones registradas.');
    fireEvent.change(within(panel).getByLabelText('Fecha'), { target: { value: '2026-11-04' } });
    fireEvent.click(within(panel).getByLabelText('Cerrado todo el día'));
    fireEvent.submit(within(panel).getByRole('button', { name: 'Añadir excepción' }).closest('form')!);

    expect(
      await within(panel).findByText('Indica la hora de apertura y la de cierre de la excepción.'),
    ).toBeInTheDocument();
    expect(api.writes()).toEqual([]);
  });

  it('DENTIST crea una excepción de su propio perfil', async () => {
    useAuthStore.setState({ user: { ...user('DENTIST'), dentistId: 7 } });
    const api = crud();
    renderPage(<SchedulingPage />);

    const panel = await block('Excepciones por fecha');
    await within(panel).findByText('Sin excepciones registradas.');
    fireEvent.change(within(panel).getByLabelText('Fecha'), { target: { value: '2026-11-05' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Añadir excepción' }));
    await waitFor(() =>
      expect(api.writes()).toContainEqual({ method: 'PUT', path: '/api/schedules/dentist/7/exceptions/2026-11-05' }),
    );
  });

  it.each(['OWNER', 'DENTIST'] as const)('%s registra, actualiza y elimina una ausencia con los mismos payloads y textos consistentes', async (role) => {
    useAuthStore.setState({ user: { ...user(role), dentistId: 7 } });
    const api = crud();
    renderPage(<SchedulingPage />);
    const panel = await block('Ausencias');
    await within(panel).findByText('Sin ausencias registradas.');
    expect(within(panel).getByText('La ausencia parcial debe ser de un solo día.')).toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/franquici/i);
    fireEvent.change(within(panel).getByLabelText('Desde'), { target: { value: '2026-11-09' } });
    fireEvent.change(within(panel).getByLabelText('Hasta'), { target: { value: '2026-11-10' } });
    fireEvent.change(within(panel).getByLabelText('Motivo (opcional)'), { target: { value: 'Vacaciones' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Registrar ausencia' }));
    await within(panel).findByText('Ausencia registrada.');
    const payload = { startDate: '2026-11-09', endDate: '2026-11-10', startTime: null, endTime: null, reason: 'Vacaciones' };
    expect(api.lastBody('POST', '/api/schedules/dentist/7/time-off')).toEqual(payload);
    await within(panel).findByText(/2026-11-09 → 2026-11-10/);
    fireEvent.click(within(panel).getByRole('button', { name: 'Editar' }));
    fireEvent.change(within(panel).getByLabelText('Motivo (opcional)'), { target: { value: 'Vacaciones actualizadas' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Guardar cambios' }));
    await within(panel).findByText('Ausencia actualizada.');
    expect(api.lastBody('PUT', '/api/schedules/dentist/7/time-off/50')).toEqual({ ...payload, reason: 'Vacaciones actualizadas' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Eliminar' }));
    expect(window.confirm).toHaveBeenCalledWith('¿Eliminar la ausencia del 2026-11-09?');
    await within(panel).findByText('Ausencia eliminada.');
    await within(panel).findByText('Sin ausencias registradas.');
    expect(panel).not.toHaveTextContent(/franquici/i);
    expect(api.writes()).toEqual([
      { method: 'POST', path: '/api/schedules/dentist/7/time-off' },
      { method: 'PUT', path: '/api/schedules/dentist/7/time-off/50' },
      { method: 'DELETE', path: '/api/schedules/dentist/7/time-off/50' },
    ]);
  });

  it.each(['OWNER', 'DENTIST'] as const)('%s edita una ausencia existente con PUT y nunca con POST', async (role) => {
    useAuthStore.setState({ user: { ...user(role), dentistId: 7 } });
    const api = crud({ timeOffs: [TIME_OFF] });
    renderPage(<SchedulingPage />);

    const panel = await block('Ausencias');
    await within(panel).findByText('2026-10-15 → 2026-10-16 (todo el día)');
    fireEvent.click(within(panel).getByRole('button', { name: 'Editar' }));
    expect(within(panel).getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText('Motivo (opcional)'), { target: { value: 'Vacaciones' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(api.writes()).toContainEqual({ method: 'PUT', path: '/api/schedules/dentist/7/time-off/40' }),
    );
    expect(api.writes().some(({ method }) => method === 'POST')).toBe(false);
    expect(api.lastBody('PUT', '/api/schedules/dentist/7/time-off/40')).toEqual({
      startDate: '2026-10-15',
      endDate: '2026-10-16',
      startTime: null,
      endTime: null,
      reason: 'Vacaciones',
    });
  });

  it.each(['OWNER', 'DENTIST'] as const)('%s valida ausencias parciales con las mismas reglas y terminología por rol', async (role) => {
    useAuthStore.setState({ user: { ...user(role), dentistId: 7 } });
    const api = crud();
    renderPage(<SchedulingPage />);

    const panel = await block('Ausencias');
    const createLabel = 'Registrar ausencia';
    await within(panel).findByRole('button', { name: createLabel });
    const submit = () =>
      fireEvent.submit(within(panel).getByRole('button', { name: createLabel }).closest('form')!);
    fireEvent.click(within(panel).getByLabelText('Todo el día (permite varios días)'));
    submit();
    expect(
      await within(panel).findByText('Indica la hora de inicio y la de fin de la ausencia parcial.'),
    ).toBeInTheDocument();

    fireEvent.change(within(panel).getByLabelText('Hora inicio'), { target: { value: '14:00' } });
    fireEvent.change(within(panel).getByLabelText('Hora fin'), { target: { value: '13:00' } });
    submit();
    expect(
      await within(panel).findByText('La hora de inicio debe ser anterior a la de fin.'),
    ).toBeInTheDocument();

    fireEvent.change(within(panel).getByLabelText('Hora fin'), { target: { value: '16:00' } });
    fireEvent.change(within(panel).getByLabelText('Desde'), { target: { value: '2026-10-15' } });
    fireEvent.change(within(panel).getByLabelText('Hasta'), { target: { value: '2026-10-16' } });
    submit();
    expect(
      await within(panel).findByText('Una ausencia con horas cubre un único día; para varios días usa días completos.'),
    ).toBeInTheDocument();
    expect(api.writes()).toEqual([]);
  });

  it.each(['OWNER', 'DENTIST'] as const)('%s muestra los mismos estados vacíos con terminología por rol', async (role) => {
    useAuthStore.setState({ user: { ...user(role), dentistId: 7 } });
    crud();
    renderPage(<SchedulingPage />);

    expect(
      await within(section('Excepciones de la clínica')).findByText('Sin excepciones registradas.'),
    ).toBeInTheDocument();
    expect(await within(await block('Excepciones por fecha')).findByText('Sin excepciones registradas.')).toBeInTheDocument();
    expect(await within(await block('Ausencias')).findByText('Sin ausencias registradas.')).toBeInTheDocument();
  });

  it('muestra el error de lectura de excepciones y franquicias sin permitir escritura', async () => {
    useAuthStore.setState({ user: user('OWNER') });
    const api = crud({ clinicExceptionsFail: true, timeOffFail: true });
    renderPage(<SchedulingPage />);

    expect(
      await within(section('Excepciones de la clínica')).findByText('No se pudieron cargar las excepciones.'),
    ).toBeInTheDocument();
    expect(
      await within(await block('Ausencias')).findByText('No se pudieron cargar las ausencias del dentista.'),
    ).toBeInTheDocument();
    expect(api.writes()).toEqual([]);
  });

  it('RECEPTIONIST ve excepciones y franquicias en solo lectura, sin acciones de escritura', async () => {
    useAuthStore.setState({ user: user('RECEPTIONIST') });
    crud({ clinicExceptions: [CLINIC_EXCEPTION], dentistExceptions: [DENTIST_EXCEPTION], timeOffs: [TIME_OFF] });
    renderPage(<SchedulingPage />);

    const clinicPanel = section('Excepciones de la clínica');
    await within(clinicPanel).findByText(/2026-11-02/);
    expect(within(clinicPanel).queryByRole('button', { name: 'Añadir excepción' })).not.toBeInTheDocument();
    expect(within(clinicPanel).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(within(clinicPanel).queryByRole('button', { name: 'Eliminar excepción' })).not.toBeInTheDocument();

    const franquicias = section('Ausencias del dentista');
    await within(franquicias).findByText('2026-10-15 → 2026-10-16 (todo el día)');
    expect(within(franquicias).queryByRole('button', { name: 'Registrar ausencia' })).not.toBeInTheDocument();
    expect(within(franquicias).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(within(franquicias).queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
  });

  it('no inventa horas al abrir un día sin franja y no guarda hasta completarlo (H-A17)', async () => {
    useAuthStore.setState({ user: user('OWNER') });
    const days = CLINIC_SCHEDULE.days.map((day) =>
      day.dayOfWeek === 1 ? { ...day, open: true, startTime: null, endTime: null } : day,
    );
    const api = crud({ clinicSchedule: { ...CLINIC_SCHEDULE, days } });
    renderPage(<SchedulingPage />);

    const panel = section('Horario de la clínica');
    await waitFor(() => expect(within(panel).getByLabelText('Inicio Lunes')).toHaveValue(''));
    fireEvent.click(within(panel).getByRole('button', { name: 'Guardar horario' }));

    expect(
      await within(panel).findByText('Lunes: indica la hora de apertura y la de cierre.'),
    ).toBeInTheDocument();
    expect(api.writes()).toEqual([]);
  });
});
