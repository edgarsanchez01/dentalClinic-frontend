import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelSessionRequests, tokenStore } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import { HomePage } from '../app/HomePage';

const NOW = '2026-11-01T01:00:00Z';
const appointment = { id: 7, patientId: 4, dentistId: 3, occurrenceVersion: 2, status: 'SCHEDULED',
  patientFirstName: 'Paciente', patientLastName: 'Propio', dentistFirstName: 'Olivia', dentistLastName: 'Prueba',
  startAt: '2026-11-01T02:00:00Z', endAt: '2026-11-01T03:00:00Z', notes: 'SECRETO INTERNO', reason: 'DIAGNOSTICO SENSIBLE',
  service: { id: 2, name: 'Servicio autorizado', description: 'DETALLE SENSIBLE', durationMinutes: 60, referencePrice: 99 } };
const page = (content: unknown[] = [], size = 5, page = 0, totalElements = content.length) => ({ content, size, page, totalElements, totalPages: Math.ceil(totalElements / size) });
interface Options { empty?: boolean; fail?: string; loading?: string; zone?: string; missing?: boolean; invalid?: 'scope' | 'status' | 'page'; }
function setup(role: 'DENTIST' | 'PATIENT', options: Options = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  useAuthStore.setState({ status: 'authenticated', user: { id: 1, role, email: 'actor@care.test', active: true, createdAt: NOW,
    ...(options.missing ? {} : { dentistId: 3, patientId: 4 }) }, queryClient: client });
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
      case '/api/notifications': body = page(options.empty ? [] : [{ id: 1, title: 'TITULO SENSIBLE', body: 'CUERPO SENSIBLE', createdAt: NOW, read: false }]); break;
      case '/api/notifications/unread-count': body = { unread: 1 }; break;
      default: return new Response('{}', { status: 404 });
    }
    return new Response(JSON.stringify(body));
  });
  vi.stubGlobal('fetch', fetchMock);
  function Destination() { const location = useLocation(); return <p>Destino: {location.pathname}{location.search}</p>; }
  function Boundary() {
    const current = useAuthStore(state => state.queryClient), version = useAuthStore(state => state.sessionVersion);
    return <QueryClientProvider key={version} client={current}><MemoryRouter><Routes>
      <Route path="/" element={<HomePage />} /><Route path="*" element={<Destination />} />
    </Routes></MemoryRouter></QueryClientProvider>;
  }
  render(<Boundary />);
  return { requests, client, fetchMock };
}
const region = (name: string) => within(screen.getByRole('region', { name }));
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); tokenStore.set('care-test'); });
afterEach(() => {
  cleanup(); useAuthStore.getState().queryClient.clear(); cancelSessionRequests(); tokenStore.set(null);
  useAuthStore.setState({ status: 'anonymous', user: null, sessionVersion: useAuthStore.getState().sessionVersion + 1 });
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('Dashboards 9B — integración frontend con HTTP simulado', () => {
  it('PATIENT usa autoservicio y una sola consulta para próxima y siguientes; no muestra salud ni administración', async () => {
    const { requests } = setup('PATIENT');
    const next = region('Tu próxima cita');
    expect(await next.findByText('Servicio autorizado')).toBeInTheDocument();
    expect(screen.getAllByText('Odontólogo: Olivia Prueba')).toHaveLength(2);
    expect(next.getByText(/31 de octubre de 2026/)).toHaveTextContent('20:00 – 21:00');
    expect(screen.queryByText(/SECRETO|DIAGNOSTICO|DETALLE SENSIBLE/)).not.toBeInTheDocument();
    expect(screen.getByText('TITULO SENSIBLE')).toBeInTheDocument();
    expect(screen.getByText('CUERPO SENSIBLE')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Mi agenda de hoy' })).not.toBeInTheDocument();
    expect(next.queryByText('Paciente Propio')).not.toBeInTheDocument();
    const calls = requests.filter(url => url.pathname === '/api/appointments');
    expect(calls).toHaveLength(2);
    const nextCalls = calls.filter(url => url.searchParams.get('size') === '5');
    expect(nextCalls).toHaveLength(1);
    expect(Object.fromEntries(nextCalls[0]!.searchParams)).toEqual({ from: '2026-11-01T01:00:00.000Z', status: 'SCHEDULED', page: '0', size: '5' });
    const agenda = calls.find(url => url.searchParams.get('size') === '100');
    expect(agenda).toBeTruthy();
    expect(Object.fromEntries(agenda!.searchParams)).toMatchObject({ status: 'SCHEDULED', page: '0', size: '100' });
    expect(requests.every(url => ['/api/appointments', '/api/availability/policy', '/api/notifications', '/api/notifications/unread-count'].includes(url.pathname))).toBe(true);
    expect(next.queryByRole('button', { name: /cancel|reprogram|completar/i })).not.toBeInTheDocument();
  });

  it('PATIENT presenta vacío útil y notificaciones vacías, no errores como cero', async () => {
    setup('PATIENT', { empty: true });
    expect(await screen.findByText(/Aún no tienes próximas citas/)).toBeInTheDocument();
    expect(await screen.findByText(/No tienes notificaciones todavía/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reservar un horario' })).toHaveAttribute('href', '/appointments?create=1');
  });

  it('PATIENT carga citas sin bloquear notificaciones', async () => {
    setup('PATIENT', { loading: '/api/appointments' });
    expect(await screen.findByRole('status', { name: 'Cargando próximas citas' })).toBeInTheDocument();
    expect(await screen.findByText('TITULO SENSIBLE')).toBeInTheDocument();
  });

  it.each(['scope', 'status', 'page'] as const)('PATIENT rechaza una respuesta incompatible (%s) sin exponer sus filas', async invalid => {
    setup('PATIENT', { invalid });
    expect(await region('Tu próxima cita').findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Servicio: Servicio autorizado')).not.toBeInTheDocument();
  });

  it('PATIENT sin vínculo no lanza una consulta global ni deduce identidad', async () => {
    const { requests } = setup('PATIENT', { missing: true });
    expect(await region('Perfil vinculado').findByRole('alert')).toHaveTextContent('vinculad');
    await screen.findByText('TITULO SENSIBLE');
    expect(requests.some(url => url.pathname === '/api/appointments')).toBe(false);
  });

  it.each(['', 'bad/zone'])('sin zona (%s) suspende consultas temporales pero mantiene bandeja y acciones', async zone => {
    const { requests } = setup('PATIENT', { zone });
    expect(await screen.findByText(/No mostraremos fechas con una zona distinta/)).toBeInTheDocument();
    expect(await screen.findByText('TITULO SENSIBLE')).toBeInTheDocument();
    expect(requests.some(url => url.pathname === '/api/appointments')).toBe(false);
    expect(screen.getByRole('link', { name: 'Agendar una cita' })).toBeInTheDocument();
  });

  it('error de zona y de notificaciones tienen reintentos propios', async () => {
    setup('PATIENT', { fail: '/api/availability/policy', loading: '/api/notifications' });
    expect(await region('Zona horaria').findByRole('button', { name: /Reintentar/ })).toBeInTheDocument();
    expect(region('Notificaciones personales').getByRole('status')).toHaveAccessibleName('Cargando notificaciones personales');
  });

  it.each([
    ['Agendar una cita', '/appointments?create=1'], ['Consultar mis citas e historial', '/appointments'],
    ['Consultar mis datos', '/patients/4'], ['Consultar mis notificaciones', '/notifications'],
  ])('acción paciente %s navega al destino autorizado', async (name, destination) => {
    setup('PATIENT'); await screen.findByText('Servicio autorizado');
    fireEvent.click(screen.getByRole('link', { name }));
    expect(await screen.findByText(`Destino: ${destination}`)).toBeInTheDocument();
  });

  it('logout limpia los datos del dashboard y reemplaza la caché de sesión', async () => {
    const { client } = setup('PATIENT'); await screen.findByText('Servicio autorizado');
    await act(() => useAuthStore.getState().logout());
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(useAuthStore.getState().queryClient).not.toBe(client);
    expect(screen.queryByText('Servicio autorizado')).not.toBeInTheDocument();
  });
});
