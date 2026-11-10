import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '../../api/auth';
import { cancelSessionRequests, tokenStore } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import { HomePage } from '../app/HomePage';

const NOW = '2026-11-01T01:00:00Z';
const page = (content: unknown[] = [], totalElements = content.length, size = 5) => ({
  content, totalElements, size, page: 0, totalPages: Math.ceil(totalElements / size),
});
const PORTFOLIO = { asOf: NOW, confirmedCharges: 207, billedAmount: 999999, appliedAmount: 200,
  pendingBalance: 1200.25, statusCounts: { pendiente: 105, parcial: 101, pagado: 1, anulado: 0 } };
const appointment = { id: 7, patientFirstName: 'Paciente', patientLastName: 'Prueba', dentistFirstName: 'Dra.',
  dentistLastName: 'Prueba', startAt: '2026-11-01T02:00:00Z', endAt: '2026-11-01T03:00:00Z', status: 'SCHEDULED' };

interface Options {
  fail?: string; partial?: string; loading?: string; empty?: boolean; zone?: string;
  today?: ReturnType<typeof page>; upcoming?: ReturnType<typeof page>; notices?: unknown[];
}
function setup(role: Role = 'OWNER', options: Options = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  useAuthStore.setState({ status: 'authenticated', user: { id: 1, email: 'actor@dashboard.test', role, active: true, createdAt: NOW }, queryClient: client });
  const requests: URL[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost'); requests.push(url);
    if (url.pathname === options.loading) return new Promise<Response>(() => {});
    if (url.pathname === '/api/auth/logout') return new Response(null, { status: 204 });
    if (url.pathname === options.fail) return new Response('{}', { status: 503 });
    if (url.pathname === options.partial) return new Response('{}');
    let body: unknown;
    switch (url.pathname) {
      case '/api/clinic': body = { name: 'Clínica del backend', timezone: options.zone ?? 'America/Mexico_City' }; break;
      case '/api/availability/policy': body = { timezone: options.zone ?? 'America/Mexico_City' }; break;
      case '/api/appointments': {
        const today = url.searchParams.has('to');
        const future = url.searchParams.get('size') === '3';
        const entry = { ...appointment, id: future ? 8 : 7, patientId: 4, occurrenceVersion: 1,
          startAt: future ? '2026-11-02T02:00:00Z' : appointment.startAt,
          endAt: future ? '2026-11-02T03:00:00Z' : appointment.endAt };
        body = (today ? options.today : !future ? options.upcoming : undefined)
          ?? page(options.empty ? [] : [entry], options.empty ? 0 : today ? 207 : 106, Number(url.searchParams.get('size'))); break;
      }
      case '/api/financial/reports/portfolio': body = PORTFOLIO; break;
      case '/api/financial/reports/cash-flow': body = { from: url.searchParams.get('from'), to: url.searchParams.get('to'), grossAmount: 25.50, reversalAmount: 30, netAmount: -4.50, methods: [] }; break;
      case '/api/feedback': body = { ...page([], options.empty ? 0 : 120, 20), count: options.empty ? 0 : 120, average: options.empty ? null : 4.25 }; break;
      case '/api/users': body = options.empty ? [] : [{ role: 'DENTIST', status: 'PENDING' }, { role: 'RECEPTIONIST', status: 'INACTIVE' }]; break;
      case '/api/notifications': body = page(options.notices ?? (options.empty ? [] : [{ id: 1, title: 'Aviso personal', body: 'Desde el backend', read: false, createdAt: NOW }])); break;
      case '/api/notifications/unread-count': body = { unread: 0 }; break;
      case '/actuator/health': body = { status: 'UP' }; break;
      default: return new Response('{}', { status: 404 });
    }
    return new Response(JSON.stringify(body));
  });
  vi.stubGlobal('fetch', fetchMock);
  function Destination() { const location = useLocation(); return <p>Destino: {location.pathname}{location.search}</p>; }
  function SessionBoundary() {
    const currentClient = useAuthStore(state => state.queryClient);
    const version = useAuthStore(state => state.sessionVersion);
    return <QueryClientProvider key={version} client={currentClient}><MemoryRouter><Routes>
      <Route path="/" element={<HomePage />} /><Route path="*" element={<Destination />} />
    </Routes></MemoryRouter></QueryClientProvider>;
  }
  render(<SessionBoundary />);
  return { requests, client, fetchMock };
}
const region = (name: string) => within(screen.getByRole('region', { name }));
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); tokenStore.set('dashboard-test'); });
afterEach(() => {
  cleanup(); useAuthStore.getState().queryClient.clear(); cancelSessionRequests(); tokenStore.set(null);
  useAuthStore.setState({ status: 'anonymous', user: null, sessionVersion: useAuthStore.getState().sessionVersion + 1 });
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('Dashboard administrativo 9A.2 (HTTP simulado)', () => {
  it('OWNER reutiliza la composición de Recepción sin perder indicadores ni secciones administrativas', async () => {
    setup();
    const heading = screen.getByRole('heading', { name: 'Resumen de la clínica', level: 1 });
    expect(heading.closest('header')).toHaveClass('reception-page-heading');
    expect(heading.closest('.owner-workspace')).toHaveClass('reception-shell');
    expect(await screen.findByText('Clínica del backend')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Crear cita' })).toHaveAttribute('href', '/appointments?create=1');
    expect(screen.getByRole('region', { name: 'Citas de hoy' })).toHaveClass('reception-today-sheet');
    for (const name of ['Agenda de hoy', 'Siguiente paciente']) {
      expect(screen.getByRole('region', { name }).parentElement).toHaveClass('reception-journal-grid');
    }
    for (const name of ['Próximas citas', 'Personal pendiente de activación', 'Notificaciones personales']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('region', { name: 'Resumen financiero' })).toHaveClass('reception-portfolio-strip');
    expect(heading.closest('.owner-home-hybrid')).toBeNull();
    expect((await region('Agenda de hoy').findByRole('link', { name: /^Cita con/ }))).toHaveClass('reception-visit');
  });

  it('OWNER muestra agregados reales del contrato, no la suma de la primera página ni facturación como ingreso', async () => {
    const { requests } = setup();
    expect(await screen.findByText('Clínica del backend')).toBeInTheDocument();
    expect(await region('Citas de hoy').findByText('207')).toBeInTheDocument();
    expect(await region('Cobrado este mes').findByText('$25.50 MXN')).toBeInTheDocument();
    expect(await region('Cartera pendiente').findByText('$1,200.25 MXN')).toBeInTheDocument();
    expect(await region('Evaluación global').findByText('4.25 / 5')).toBeInTheDocument();
    expect(region('Evaluación global').getByText(/120 evaluaciones/)).toBeInTheDocument();
    expect(await screen.findByText('-$4.50 MXN')).toBeInTheDocument();
    expect(await screen.findByText('1 cuenta de personal pendiente de activar su invitación.')).toBeInTheDocument();
    expect(screen.queryByText('$999,999.00 MXN')).not.toBeInTheDocument();
    const days = requests.find(url => url.pathname === '/api/appointments' && url.searchParams.get('size') === '6')!.searchParams;
    expect(Object.fromEntries(days)).toEqual({ from: '2026-10-31T06:00:00.000Z', to: '2026-11-01T06:00:00.000Z', page: '0', size: '6' });
    const cash = requests.filter(url => url.pathname.endsWith('cash-flow'));
    expect(cash).toHaveLength(1);
    expect(Object.fromEntries(cash[0]!.searchParams)).toEqual({ from: '2026-10-01T06:00:00.000Z', to: '2026-11-01T06:00:00.000Z' });
  });

  it('solo desglosa estados si ha recibido el día completo, sin sumar una página como total', async () => {
    const visits = ['COMPLETED', 'SCHEDULED', 'CANCELLED', 'NO_SHOW'].map((status, i) => ({ ...appointment, id: i + 1, status }));
    setup('OWNER', { today: page(visits, 4, 6) });
    expect(await region('Citas de hoy').findByText('4')).toBeInTheDocument();
    expect(region('Citas de hoy').getByText('1 completada · 1 programada · 1 cancelada · 1 ausencia')).toBeInTheDocument();
    expect(region('Agenda de hoy').getAllByRole('listitem')).toHaveLength(4);
  });

  it('una página diaria parcial no publica un desglose incompleto como si fuera global', async () => {
    setup('OWNER', { today: page([appointment], 54, 6) });
    expect(await region('Citas de hoy').findByText('54')).toBeInTheDocument();
    expect(region('Citas de hoy').queryByText(/1 programada/)).not.toBeInTheDocument();
    expect(await region('Agenda de hoy').findByText(/Mostrando 1 de 54/)).toBeInTheDocument();
    expect(region('Agenda de hoy').getByRole('link', { name: 'Consultar el resto de citas de hoy' })).toHaveAttribute('href', '/appointments?view=day&date=2026-10-31');
  });

  it('separa la siguiente cita de las posteriores a hoy usando la frontera clínica real', async () => {
    const { requests } = setup();
    expect(await region('Siguiente paciente').findByRole('heading', { name: 'Paciente Prueba' })).toBeInTheDocument();
    expect(region('Siguiente paciente').getByRole('link', { name: 'Abrir expediente' })).toHaveAttribute('href', '/patients/4?appointmentId=7&occurrenceVersion=1');
    const next = requests.find(url => url.pathname === '/api/appointments' && url.searchParams.get('size') === '5')!;
    const later = requests.find(url => url.pathname === '/api/appointments' && url.searchParams.get('size') === '3')!;
    expect(next.searchParams.get('from')).toBe(new Date(NOW).toISOString());
    expect(later.searchParams.get('from')).toBe('2026-11-01T06:00:00.000Z');
    expect(later.searchParams.get('status')).toBe('SCHEDULED');
    expect(requests.some(url => /clinical|odontogram/.test(url.pathname))).toBe(false);
  });

  it.each([
    page([], 5, 5),
    page([{ ...appointment, status: 'COMPLETED' }], 1, 5),
    page([{ ...appointment, startAt: '2026-10-30T02:00:00Z' }], 1, 5),
    page([{ ...appointment, startAt: '2026-11-01T04:00:00Z' }, appointment], 2, 5),
  ])('no afirma cuál es la siguiente cita ante detalle insuficiente o inconsistente %#', async upcoming => {
    setup('OWNER', { upcoming });
    expect(await region('Siguiente paciente').findByText('No se pudo identificar la siguiente cita con la información recibida.')).toBeInTheDocument();
    expect(region('Siguiente paciente').queryByRole('link', { name: 'Abrir cita' })).not.toBeInTheDocument();
  });

  it('limita el resumen a tres notificaciones sin marcarlas como leídas', async () => {
    const notices = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, title: `Aviso ${i + 1}`, body: 'Texto real de la bandeja', read: false, createdAt: NOW }));
    const { requests } = setup('OWNER', { notices });
    const list = region('Notificaciones personales');
    expect(await list.findByText('Aviso 1')).toBeInTheDocument();
    expect(list.getAllByRole('listitem')).toHaveLength(3);
    expect(list.queryByText('Aviso 4')).not.toBeInTheDocument();
    expect(list.getAllByText(/No leída/)).toHaveLength(3);
    expect(requests.some(url => /\/notifications\/\d+\/read/.test(url.pathname))).toBe(false);
  });

  it('RECEPTIONIST solo consulta contratos operativos autorizados', async () => {
    const { requests } = setup('RECEPTIONIST');
    expect(screen.getByRole('heading', { name: 'Recepción' })).toBeInTheDocument();
    expect(await region('Cargos pendientes').findByText('105')).toBeInTheDocument();
    expect(await region('Cargos parciales').findByText('101')).toBeInTheDocument();
    expect(await region('Próximas citas').findByText('Paciente Prueba')).toBeInTheDocument();
    const forbidden = ['/api/clinic', '/api/users', '/api/feedback', '/api/financial/reports/cash-flow'];
    expect(requests.some(url => forbidden.includes(url.pathname) || url.pathname.includes('/clinical'))).toBe(false);
    const actions = within(screen.getByRole('navigation', { name: 'Acciones rápidas' }));
    expect(actions.queryByText(/equipo|reseñas|reversa|anular/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Evaluación global' })).not.toBeInTheDocument();
  });

  it('UX-04D separa el encabezado de recepción del contexto operativo salvia', () => {
    setup('RECEPTIONIST');
    const title = screen.getByRole('heading', { name: 'Recepción', level: 1 });
    expect(title.closest('header')).toHaveClass('reception-page-heading');
    expect(title.closest('.reception-journal-cover')).toBeNull();
    expect(screen.getByText('Agenda, pacientes y seguimiento de cobros de la clínica.')).toBeInTheDocument();
    const context = screen.getByRole('region', { name: 'La jornada, en orden.' });
    expect(within(context).getByRole('heading', { level: 2 })).toHaveTextContent('La jornada, en orden.');
    expect(within(context).queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(within(context).getByRole('link', { name: 'Crear cita' })).toHaveAttribute('href', '/appointments?create=1');
  });

  it.each(['DENTIST', 'PATIENT'] as const)('%s no solicita datos administrativos desde su nuevo inicio', async role => {
    const { requests } = setup(role);
    expect(screen.getByRole('heading', { name: role === 'DENTIST' ? 'Mi jornada clínica' : 'Tu atención dental' })).toBeInTheDocument();
    await screen.findByText(/no tiene .* vinculad/);
    expect(requests.some(url => /financial|feedback|\/clinic|users|appointments/.test(url.pathname))).toBe(false);
  });

  it('rotula la lista limitada y no recorre todas las páginas para obtener totales', async () => {
    const { requests } = setup();
    expect(await screen.findByText(/Primeras 1 de 106/)).toBeInTheDocument();
    expect(screen.getByText(/La lista es parcial/)).toBeInTheDocument();
    expect(requests.filter(url => url.pathname === '/api/appointments')).toHaveLength(3);
    expect(requests.filter(url => url.pathname === '/api/feedback')).toHaveLength(1);
  });

  it('maneja vacíos de citas, reseñas, equipo y notificaciones sin valoraciones falsas', async () => {
    setup('OWNER', { empty: true });
    expect(await screen.findByText(/No hay próximas citas programadas/)).toBeInTheDocument();
    expect(await screen.findByText('No tienes notificaciones todavía.')).toBeInTheDocument();
    expect(await screen.findByText('No hay personal pendiente de activación.')).toBeInTheDocument();
    expect(region('Evaluación global').getByText('Aún no hay evaluaciones respondidas.')).toBeInTheDocument();
    expect(region('Citas de hoy').getByText('0')).toBeInTheDocument();
  });

  it('carga por bloques sin bloquear los indicadores restantes', async () => {
    setup('OWNER', { loading: '/api/feedback' });
    expect(region('Evaluación global').getByRole('status')).toHaveAccessibleName('Cargando evaluación global');
    expect(await region('Cartera pendiente').findByText('$1,200.25 MXN')).toBeInTheDocument();
  });

  it('error independiente y reintento sin presentar cero ni datos en caché como confirmados', async () => {
    const { requests } = setup('OWNER', { fail: '/api/financial/reports/portfolio' });
    expect(await region('Cartera pendiente').findByRole('alert')).toHaveTextContent('No se pudo cargar');
    expect(region('Cartera pendiente').queryByText('$0.00 MXN')).not.toBeInTheDocument();
    expect(await region('Cobrado este mes').findByText('$25.50 MXN')).toBeInTheDocument();
    fireEvent.click(region('Cartera pendiente').getByRole('button', { name: /Reintentar/ }));
    await waitFor(() => expect(requests.filter(url => url.pathname.endsWith('portfolio'))).toHaveLength(2));
  });

  it('una página con metadata incompleta no se transforma en un conteo cero', async () => {
    setup('OWNER', { partial: '/api/appointments' });
    expect(await region('Citas de hoy').findByRole('alert')).toBeInTheDocument();
    expect(region('Citas de hoy').queryByText('0')).not.toBeInTheDocument();
    expect(await region('Cobrado este mes').findByText('$25.50 MXN')).toBeInTheDocument();
  });

  it.each(['invalid/zone', ''])('sin zona válida (%s) no consulta citas ni un mes global de cobros', async zone => {
    const { requests } = setup('OWNER', { zone });
    expect(await screen.findByText(/no se calcularán con otra zona/)).toBeInTheDocument();
    expect(requests.some(url => url.pathname === '/api/appointments' || url.pathname.endsWith('cash-flow'))).toBe(false);
    expect(await region('Cartera pendiente').findByText('$1,200.25 MXN')).toBeInTheDocument();
  });

  it.each([
    ['Crear cita', '/appointments?create=1'], ['Registrar paciente', '/patients?create=1'],
    ['Consultar agenda', '/appointments?view=day&date=2026-10-31&status=SCHEDULED'],
    ['Consultar pacientes', '/patients'], ['Consultar equipo', '/users'],
    ['Consultar finanzas', '/finances'], ['Consultar reportes', '/finances/reports'],
  ])('la acción %s navega a una ruta existente con sus parámetros', async (name, destination) => {
    setup(); await screen.findByText('Clínica del backend');
    fireEvent.click(screen.getByRole('link', { name }));
    expect(await screen.findByText(`Destino: ${destination}`)).toBeInTheDocument();
  });

  it('el enlace financiero mantiene tab y límites exactos del mes de la clínica', async () => {
    setup(); await region('Cobrado este mes').findByText('$25.50 MXN');
    const to = region('Cobrado este mes').getByRole('link').getAttribute('href')!;
    const params = new URL(to, 'http://localhost').searchParams;
    expect(params.get('tab')).toBe('cobros');
    expect(params.get('from')).toBe('2026-10-01T06:00:00.000Z');
    expect(params.get('to')).toBe('2026-11-01T06:00:00.000Z');
  });

  it('reutiliza la invalidación existente para cartera y citas', async () => {
    const { client, requests } = setup(); await region('Cartera pendiente').findByText('$1,200.25 MXN');
    await client.invalidateQueries({ queryKey: ['financial-report'] });
    await client.invalidateQueries({ queryKey: ['appointments'] });
    expect(requests.filter(url => url.pathname.endsWith('portfolio'))).toHaveLength(2);
    expect(requests.filter(url => url.pathname === '/api/appointments')).toHaveLength(6);
  });

  it('al recuperar el foco después de medianoche renueva día y mes sin remontar ni usar UTC', async () => {
    const { requests } = setup(); await region('Cobrado este mes').findByText('$25.50 MXN');
    vi.setSystemTime('2026-11-01T06:01:00Z');
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(requests.some(url => url.pathname.endsWith('cash-flow')
      && url.searchParams.get('from') === '2026-11-01T06:00:00.000Z')).toBe(true));
    expect(requests.some(url => url.pathname === '/api/appointments' && url.searchParams.get('to') === '2026-11-02T06:00:00.000Z')).toBe(true);
  });

  it('una sesión nueva no hereda la caché ni publica datos del dashboard anterior', async () => {
    const { client } = setup(); await region('Cartera pendiente').findByText('$1,200.25 MXN');
    await act(() => useAuthStore.getState().logout());
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(useAuthStore.getState().queryClient).not.toBe(client);
    expect(screen.queryByText('Clínica del backend')).not.toBeInTheDocument();
    expect(screen.queryByText('$1,200.25 MXN')).not.toBeInTheDocument();
  });
});
