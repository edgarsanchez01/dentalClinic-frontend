import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelSessionRequests, tokenStore } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import { HomePage } from '../app/HomePage';

/**
 * UX-05A — Inicio del DENTIST.
 *
 * Estas pruebas cubren la composición propia del dentista (`DentistDashboard`) con HTTP
 * simulado. Se separaron del archivo compartido `CareDashboard.test.tsx` para no mezclar
 * las aserciones del DENTIST con las de PATIENT (congeladas).
 */

const NOW = '2026-11-01T01:00:00Z';
const appointment = { id: 7, patientId: 4, dentistId: 3, occurrenceVersion: 2, status: 'SCHEDULED',
  patientFirstName: 'Paciente', patientLastName: 'Propio', dentistFirstName: 'Olivia', dentistLastName: 'Prueba',
  startAt: '2026-11-01T02:00:00Z', endAt: '2026-11-01T03:00:00Z', notes: 'SECRETO INTERNO', reason: 'DIAGNOSTICO SENSIBLE',
  service: { id: 2, name: 'Servicio autorizado', description: 'DETALLE SENSIBLE', durationMinutes: 60, referencePrice: 99 } };
const page = (content: unknown[] = [], size = 5, page = 0, totalElements = content.length) => ({ content, size, page, totalElements, totalPages: Math.ceil(totalElements / size) });
interface Options { empty?: boolean; fail?: string; loading?: string; zone?: string; missing?: boolean; invalid?: 'scope' | 'status' | 'page'; role?: 'OWNER' | 'DENTIST'; noticeCount?: number; }
function setup(options: Options = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  useAuthStore.setState({ status: 'authenticated', user: { id: 1, role: options.role ?? 'DENTIST', email: 'actor@dentist.test', active: true, createdAt: NOW,
    ...(options.missing ? {} : { dentistId: 3 }) }, queryClient: client });
  const requests: URL[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost'); requests.push(url);
    if (url.pathname === options.loading) return new Promise<Response>(() => {});
    if (url.pathname === options.fail) return new Response('{}', { status: 503 });
    let body: unknown;
    switch (url.pathname) {
      case '/api/auth/logout': return new Response(null, { status: 204 });
      case '/api/availability/policy': body = { timezone: options.zone ?? 'America/Mexico_City' }; break;
      case '/api/appointments': {
        const size = Number(url.searchParams.get('size')), currentPage = Number(url.searchParams.get('page'));
        const isDay = url.searchParams.has('to');
        const content = isDay && size === 5 ? ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map((status, index) => ({
          ...appointment, id: index + 20, patientFirstName: `Paciente ${currentPage}-${index}`, status,
          startAt: `2026-10-31T${13 + index}:00:00Z`, endAt: `2026-10-31T${14 + index}:00:00Z`,
        })) : [appointment, ...(size === 5 ? [{ ...appointment, id: 8, patientFirstName: 'Segundo', service: { ...appointment.service, name: 'Servicio siguiente' }, startAt: '2026-11-02T02:00:00Z', endAt: '2026-11-02T03:00:00Z' }] : [])];
        if (options.invalid === 'scope') content[0] = { ...content[0]!, patientId: 900, dentistId: 900 };
        if (options.invalid === 'status') content[0] = { ...content[0]!, status: 'COMPLETED' };
        body = options.invalid === 'page' ? {} : page(options.empty ? [] : content, size, currentPage, options.empty ? 0 : 107);
        break;
      }
      case '/api/notifications': body = page(options.empty ? [] : options.noticeCount ? Array.from({ length: options.noticeCount }, (_, i) => ({ id: i + 1, title: `Aviso ${i + 1}`, body: `Texto completo ${i + 1}`, createdAt: NOW, read: i === 1, priority: i === 0 ? 'HIGH' : 'NORMAL' })) : [{ id: 1, title: 'TITULO SENSIBLE', body: 'CUERPO SENSIBLE', createdAt: NOW, read: false, priority: 'NORMAL' }]); break;
      case '/api/notifications/unread-count': body = { unread: 1 }; break;
      default: return new Response('{}', { status: 404 });
    }
    return new Response(JSON.stringify(body));
  });
  vi.stubGlobal('fetch', fetchMock);
  function Destination() { const location = useLocation(); return <p>Destino: {location.pathname}{location.search}</p>; }
  function Boundary() {
    const current = useAuthStore(state => state.queryClient), version = useAuthStore(state => state.sessionVersion);
    return <QueryClientProvider key={version} client={current}><MemoryRouter initialEntries={[options.role === 'OWNER' ? '/?scope=mine&dentistId=900' : '/']}><Routes>
      <Route path="/" element={<HomePage />} /><Route path="*" element={<Destination />} />
    </Routes></MemoryRouter></QueryClientProvider>;
  }
  render(<Boundary />);
  return { requests, client, fetchMock };
}
const region = (name: string) => within(screen.getByRole('region', { name }));
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); tokenStore.set('dentist-test'); });
afterEach(() => {
  cleanup(); useAuthStore.getState().queryClient.clear(); cancelSessionRequests(); tokenStore.set(null);
  useAuthStore.setState({ status: 'anonymous', user: null, sessionVersion: useAuthStore.getState().sessionVersion + 1 });
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('UX-05A — Inicio del DENTIST', () => {
  it('prioriza el siguiente paciente, la agenda del día y los estados reales; filtra cada consulta en servidor', async () => {
    const { requests } = setup();
    expect(screen.getByRole('heading', { name: 'Mi jornada clínica' })).toBeInTheDocument();
    expect(document.querySelector('.owner-personal-home')).toBeNull();
    const next = region('Próxima cita propia');
    const day = within(await screen.findByRole('region', { name: 'Mi agenda de hoy' }));
    expect(await next.findByText('Paciente Propio')).toBeInTheDocument();
    expect(await day.findByText('107')).toBeInTheDocument();
    for (const label of ['Programada', 'Completada', 'Cancelada', 'No asistió']) expect(day.getAllByText(label).length).toBeGreaterThan(0);
    expect(next.getByRole('link', { name: 'Abrir expediente' })).toHaveAttribute('href', '/patients/4?appointmentId=7&occurrenceVersion=2');
    expect(next.getByRole('link', { name: 'Abrir cita' })).toHaveAttribute('href', '/appointments/7');
    expect(screen.queryByText(/SECRETO|DIAGNOSTICO|DETALLE SENSIBLE/)).not.toBeInTheDocument();
    const calls = requests.filter(url => url.pathname === '/api/appointments');
    expect(calls).toHaveLength(3);
    expect(calls.every(url => url.searchParams.get('dentistId') === '3')).toBe(true);
    expect(requests.some(url => /\/patients|clinical|financial|charges|users|feedback|\/clinic$/.test(url.pathname))).toBe(false);
    expect(screen.getByRole('region', { name: 'Tus notificaciones' })).toBeInTheDocument();
  });

  it('muestra el destacado salvia con hora, servicio y estado del siguiente paciente', async () => {
    setup();
    const next = region('Próxima cita propia');
    expect(await next.findByText('Paciente Propio')).toBeInTheDocument();
    const time = next.getByText('20:00');
    expect(time).toBeInTheDocument();
    expect(next.getByText('Servicio autorizado')).toBeInTheDocument();
    expect(next.getByText('Programada')).toBeInTheDocument();
  });

  it('presenta vacío útil y notificaciones vacías, no errores como cero', async () => {
    setup({ empty: true });
    expect(await screen.findByText('No tienes próximas citas programadas. Las citas cuya hora ya pasó siguen en tu agenda del día.')).toBeInTheDocument();
    expect(await screen.findByText('No tienes notificaciones todavía.')).toBeInTheDocument();
    expect(await screen.findByText('No tienes citas para hoy')).toBeInTheDocument();
  });

  it('carga citas sin bloquear notificaciones', async () => {
    setup({ loading: '/api/appointments' });
    expect(await screen.findByRole('status', { name: 'Cargando próximas citas' })).toBeInTheDocument();
    expect(await screen.findByText('TITULO SENSIBLE')).toBeInTheDocument();
    expect(screen.getByText('CUERPO SENSIBLE')).toBeInTheDocument();
  });

  it('error de citas permite reintento independiente y nunca muestra un conteo cero', async () => {
    const { requests } = setup({ fail: '/api/appointments' });
    const next = region('Próxima cita propia');
    expect(await next.findByRole('alert')).toBeInTheDocument();
    expect(region('Mi agenda de hoy').queryByText('0')).not.toBeInTheDocument();
    expect(await screen.findByText('TITULO SENSIBLE')).toBeInTheDocument();
    fireEvent.click(next.getByRole('button', { name: /Reintentar/ }));
    await waitFor(() => expect(requests.filter(url => url.pathname === '/api/appointments')).toHaveLength(4));
  });

  it('rechaza una respuesta de alcance ajeno sin exponer filas', async () => {
    setup({ invalid: 'scope' });
    expect(await region('Próxima cita propia').findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/AJENO/)).not.toBeInTheDocument();
  });

  it.each(['status', 'page'] as const)('rechaza una respuesta incompatible (%s) sin exponer filas', async invalid => {
    setup({ invalid });
    expect(await region('Próxima cita propia').findByRole('alert')).toBeInTheDocument();
  });

  it('sin vínculo no lanza una consulta global ni deduce identidad', async () => {
    const { requests } = setup({ missing: true });
    expect(await region('Perfil vinculado').findByRole('alert')).toHaveTextContent('vinculad');
    await screen.findByText('TITULO SENSIBLE');
    expect(requests.some(url => url.pathname === '/api/appointments')).toBe(false);
  });

  it.each(['', 'bad/zone'])('sin zona (%s) suspende consultas temporales pero mantiene bandeja y acciones', async zone => {
    const { requests } = setup({ zone });
    expect(await screen.findByText(/No mostraremos fechas con una zona distinta/)).toBeInTheDocument();
    expect(await screen.findByText('TITULO SENSIBLE')).toBeInTheDocument();
    expect(requests.some(url => url.pathname === '/api/appointments')).toBe(false);
    expect(screen.getByRole('link', { name: 'Consultar mi agenda' })).toBeInTheDocument();
  });

  it('agenda pagina a demanda con límite 5 y conserva el filtro propio', async () => {
    const { requests } = setup();
    const day = within(await screen.findByRole('region', { name: 'Mi agenda de hoy' }));
    await day.findByText('Paciente 0-0 Propio');
    fireEvent.click(day.getByRole('button', { name: 'Siguiente' }));
    expect(await day.findByText('Paciente 1-0 Propio')).toBeInTheDocument();
    expect(day.queryByText('Paciente 0-0 Propio')).not.toBeInTheDocument();
    expect(day.getByRole('status')).toHaveTextContent('Página 2 de 22');
    const calls = requests.filter(url => url.pathname === '/api/appointments');
    expect(calls).toHaveLength(4);
    expect(Object.fromEntries(calls[3]!.searchParams)).toMatchObject({ dentistId: '3', page: '1', size: '5' });
    fireEvent.click(day.getByRole('button', { name: 'Anterior' }));
    expect(await day.findByText('Paciente 0-0 Propio')).toBeInTheDocument();
  });

  it('acciones clínicas navegan sin pedir el expediente hasta abandonar inicio', async () => {
    const { requests } = setup();
    const next = region('Próxima cita propia'); await next.findByText('Paciente Propio');
    fireEvent.click(next.getByRole('link', { name: 'Abrir expediente' }));
    expect(await screen.findByText('Destino: /patients/4?appointmentId=7&occurrenceVersion=2')).toBeInTheDocument();
    expect(requests.some(url => url.pathname.includes('clinical'))).toBe(false);
  });

  it('el enlace a la agenda completa conserva la fecha clínica y el filtro propio', async () => {
    setup();
    await region('Próxima cita propia').findByText('Paciente Propio');
    const agenda = screen.getByRole('link', { name: 'Consultar mi agenda' });
    expect(agenda).toHaveAttribute('href', '/appointments?view=day&date=2026-10-31&dentistId=3');
  });

  it('actualiza el día clínico al recuperar foco y mantiene la invalidación de citas existente', async () => {
    const { requests, client } = setup();
    const day = within(await screen.findByRole('region', { name: 'Mi agenda de hoy' })); await day.findByText('107');
    await client.invalidateQueries({ queryKey: ['appointments'] });
    expect(requests.filter(url => url.pathname === '/api/appointments')).toHaveLength(6);
    vi.setSystemTime('2026-11-01T06:01:00Z'); fireEvent(window, new Event('focus'));
    await waitFor(() => expect(requests.some(url => url.searchParams.get('to') === '2026-11-02T06:00:00.000Z')).toBe(true));
  });

  it('logout limpia los datos del dashboard y reemplaza la caché de sesión', async () => {
    const { client } = setup(); await screen.findByText('Paciente Propio');
    await act(() => useAuthStore.getState().logout());
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(useAuthStore.getState().queryClient).not.toBe(client);
    expect(screen.queryByText('Paciente Propio')).not.toBeInTheDocument();
  });
});

describe('OWNER — Inicio personal reutiliza las primitivas de DENTIST', () => {
  it('reutiliza el lenguaje aprobado sin cambiar filtros, consultas, estados o retorno personal', async () => {
    const { requests } = setup({ role: 'OWNER' });
    const next = region('Próxima cita propia');
    expect(await next.findByRole('heading', { name: 'Paciente Propio', level: 2 })).toBeInTheDocument();
    expect(next.getByText('Siguiente paciente')).toBeInTheDocument();
    expect(next.getByText('sábado, 31 de octubre de 2026')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mi jornada clínica' }).closest('.dentist-home')).not.toBeNull();
    const day = region('Mi agenda de hoy');
    const row = await day.findByRole('article', { name: /Paciente 0-0 Propio/ });
    expect(row).toHaveClass('dentist-visit');
    expect(within(row).getByText('07:00')).toBeInTheDocument();
    expect(within(row).getByText('– 08:00')).toBeInTheDocument();
    for (const status of ['Programada', 'Completada', 'Cancelada', 'No asistió']) expect(day.getByText(status)).toBeInTheDocument();
    expect(day.getAllByRole('article')).toHaveLength(4);
    const calls = requests.filter(url => url.pathname === '/api/appointments');
    expect(calls).toHaveLength(3);
    expect(calls.every(url => url.searchParams.get('dentistId') === '3')).toBe(true);
    expect(calls.map(url => Object.fromEntries(url.searchParams))).toEqual(expect.arrayContaining([
      { dentistId: '3', from: new Date(NOW).toISOString(), status: 'SCHEDULED', page: '0', size: '1' },
      { dentistId: '3', from: '2026-10-31T06:00:00.000Z', to: '2026-11-01T06:00:00.000Z', status: 'SCHEDULED', page: '0', size: '1' },
      { dentistId: '3', from: '2026-10-31T06:00:00.000Z', to: '2026-11-01T06:00:00.000Z', page: '0', size: '5' },
    ]));
    expect(decodeURIComponent(next.getByRole('link', { name: 'Abrir cita' }).getAttribute('href')!)).toContain('dentistId=3&scope=mine');
    expect(next.getByRole('link', { name: 'Abrir expediente' })).toHaveAttribute('href', '/patients/4?appointmentId=7&occurrenceVersion=2');
    expect(requests.some(url => /financial|clinical|users|feedback|\/clinic$/.test(url.pathname))).toBe(false);
  });

  it('conserva toda la página de notificaciones, prioridad, lectura y cuerpos completos sin mutaciones', async () => {
    const { requests } = setup({ role: 'OWNER', noticeCount: 5 });
    const notices = region('Tus notificaciones');
    await notices.findByText('Aviso 5');
    expect(notices.getAllByRole('listitem')).toHaveLength(5);
    for (let i = 1; i <= 5; i++) expect(notices.getByText(`Texto completo ${i}`)).toBeInTheDocument();
    expect(notices.getByText('Prioridad alta')).toBeInTheDocument();
    expect(notices.getByText('Leída')).toBeInTheDocument();
    expect(notices.getAllByText('No leída')).toHaveLength(4);
    expect(notices.getByRole('link', { name: 'Abrir mis notificaciones' })).toHaveAttribute('href', '/notifications');
    expect(requests.some(url => /\/notifications\/\d+\/read/.test(url.pathname))).toBe(false);
  });

  it('mantiene la paginación, los históricos y las acciones clínicas de cada fila', async () => {
    const { requests } = setup({ role: 'OWNER' });
    const day = region('Mi agenda de hoy');
    await day.findByText('Paciente 0-0 Propio');
    expect(day.getAllByRole('link', { name: 'Abrir expediente' })).toHaveLength(4);
    fireEvent.click(day.getByRole('button', { name: 'Siguiente' }));
    expect(await day.findByText('Paciente 1-0 Propio')).toBeInTheDocument();
    expect(day.getByRole('status')).toHaveTextContent('Página 2 de 22');
    expect(Object.fromEntries(requests.filter(url => url.pathname === '/api/appointments').at(-1)!.searchParams)).toMatchObject({ dentistId: '3', page: '1', size: '5' });
    fireEvent.click(day.getByRole('button', { name: 'Anterior' }));
    expect(await day.findByText('Paciente 0-0 Propio')).toBeInTheDocument();
  });

  it.each([{ empty: true }, { invalid: 'scope' as const }, { missing: true }, { zone: 'bad/zone' }])('mantiene las barreras y estados existentes %j', async options => {
    const { requests } = setup({ role: 'OWNER', ...options });
    if ('empty' in options) {
      expect(await screen.findByText('No tienes citas para hoy')).toBeInTheDocument();
      expect(await screen.findByText('No tienes notificaciones todavía.')).toBeInTheDocument();
    } else if ('invalid' in options) {
      expect(await region('Próxima cita propia').findByRole('alert')).toBeInTheDocument();
      expect(region('Mi agenda de hoy').queryByRole('article')).not.toBeInTheDocument();
    } else {
      await screen.findByText('TITULO SENSIBLE');
      expect(requests.some(url => url.pathname === '/api/appointments')).toBe(false);
    }
  });
});
