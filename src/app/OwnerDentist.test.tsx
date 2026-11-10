import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { Role } from '../api/auth';
import { cancelSessionRequests } from '../api/http';
import { HomePage } from '../components/app/HomePage';
import { AppointmentsPage } from '../components/appointments/AppointmentsPage';
import { SchedulingPage } from '../components/scheduling/SchedulingPage';
import { useAuthStore } from './authStore';
import { UnsavedChangesProvider } from './UnsavedChangesProvider';

const NOW = '2026-10-26T07:00:00Z';
const days = Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, open: true, startTime: '09:00:00', endTime: '17:00:00', breaks: [] }));
const directory = [8, 7].map(dentistId => ({ dentistId, firstName: 'Profesional', lastName: String(dentistId), days }));
const appointment = { id: 20, patientId: 4, patientFirstName: 'Paciente', patientLastName: 'Propio', dentistId: 7,
  dentistFirstName: 'Profesional', dentistLastName: '7', startAt: '2026-10-26T09:00:00Z', endAt: '2026-10-26T10:00:00Z',
  durationMinutes: 60, status: 'SCHEDULED', occurrenceVersion: 1, createdByUserId: 1, createdAt: NOW };
const clients: QueryClient[] = [];
const routers: ReturnType<typeof createMemoryRouter>[] = [];
function mount(path: string, options: { missing?: boolean; role?: Role; failure?: boolean; hiddenProfile?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  useAuthStore.setState({ status: 'authenticated', user: { id: 1, role: options.role ?? 'OWNER', active: true,
    email: 'owner@example.test', createdAt: NOW, ...(options.missing ? {} : { dentistId: 7 }) }, queryClient: client });
  const calls: { url: URL; method: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost'), method = init?.method ?? 'GET', route = url.pathname;
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (options.failure && route === '/api/appointments') return new Response('{}', { status: 503 });
    let body: unknown;
    if (route === '/api/public/schedule') body = { timezone: 'UTC', days, exceptions: [], dentists: options.hiddenProfile ? [directory[0]] : directory };
    else if (route === '/api/clinic') body = { name: 'Clínica de prueba', timezone: 'UTC' };
    else if (route === '/api/availability/policy') body = { timezone: 'UTC', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 };
    else if (route === '/api/schedules/clinic') body = { timezone: 'UTC', days };
    else if (/\/schedules\/dentist\/\d+$/.test(route)) body = { dentistId: Number(route.split('/').at(-1)), timezone: 'UTC', days: method === 'PUT' ? JSON.parse(String(init?.body)).days : days };
    else if (route.endsWith('/exceptions') || route.endsWith('/time-off') || route === '/api/services' || route === '/api/users') body = [];
    else if (route === '/api/appointments') {
      const size = Number(url.searchParams.get('size') ?? 20);
      body = { content: [appointment], page: 0, size, totalElements: 1, totalPages: 1 };
    } else if (route === '/api/feedback') body = { content: [], count: 0, average: null };
    else if (route === '/api/notifications/unread-count') body = { unread: 0 };
    else body = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
    return new Response(JSON.stringify(body));
  });
  const router = createMemoryRouter([{ element: <UnsavedChangesProvider><Outlet /></UnsavedChangesProvider>, children: [
    { path: '/', element: <HomePage /> }, { path: '/appointments', element: <AppointmentsPage /> },
    { path: '/scheduling', element: <SchedulingPage /> }, { path: '/appointments/:id', element: <p>Atención existente</p> },
  ] }], { initialEntries: [path] }); routers.push(router);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { calls, router };
}
afterEach(() => {
  cleanup(); routers.splice(0).forEach(router => router.dispose()); clients.splice(0).forEach(client => client.clear());
  cancelSessionRequests(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); useAuthStore.setState({ status: 'anonymous', user: null });
});

it('mantiene Inicio administrativo por defecto y todos los accesos OWNER al entrar a clínica personal', async () => {
  const { calls } = mount('/');
  expect(await screen.findByRole('heading', { name: 'Resumen de la clínica' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Mi jornada clínica' })).not.toBeInTheDocument();
  const start = calls.length;
  fireEvent.click(screen.getByRole('link', { name: 'Mi actividad clínica' }));
  expect(await screen.findByRole('heading', { name: 'Mi jornada clínica' })).toBeInTheDocument();
  await within(screen.getByRole('region', { name: 'Mi agenda de hoy' })).findByText('Paciente Propio');
  for (const name of ['Equipo', 'Clínica', 'Finanzas']) expect(screen.getAllByRole('link', { name }).length).toBeGreaterThan(0);
  expect(calls.slice(start).filter(c => c.url.pathname === '/api/appointments').every(c => c.url.searchParams.get('dentistId') === '7')).toBe(true);
  expect(useAuthStore.getState().user?.role).toBe('OWNER');
});

it('Inicio personal reutiliza las consultas propias y abre la atención existente con retorno personal', async () => {
  const { calls } = mount('/?scope=mine&dentistId=8');
  const next = within(await screen.findByRole('region', { name: 'Próxima cita propia' }));
  await next.findByText('Paciente Propio');
  const link = next.getByRole('link', { name: 'Abrir cita' });
  expect(link.getAttribute('href')).toContain('/appointments/20?clinical=1&returnTo=');
  expect(decodeURIComponent(link.getAttribute('href')!)).toContain('scope=mine');
  expect(screen.getByRole('link', { name: 'Consultar mi agenda' })).toHaveAttribute('href', '/appointments?view=day&date=2026-10-26&dentistId=7&scope=mine');
  expect(screen.getByRole('link', { name: 'Mi horario' })).toHaveAttribute('href', '/scheduling?scope=mine');
  expect(calls.filter(c => c.url.pathname === '/api/appointments')).toHaveLength(3);
  expect(calls.some(c => /financial|\/users|\/clinic$/.test(c.url.pathname))).toBe(false);
});

it.each(['/?scope=mine', '/appointments?scope=mine'])('sin perfil no cae a agenda global en %s', async path => {
  const { calls } = mount(path, { missing: true });
  await screen.findByText(/Tu cuenta no tiene un perfil profesional vinculado/);
  expect(calls.some(c => c.url.pathname === '/api/appointments')).toBe(false);
  expect(within(screen.getByRole('navigation', { name: 'Ámbito de trabajo' })).getByRole('link', { name: 'Clínica' })).toBeInTheDocument();
});

it('un fallo de citas propias presenta reintento sin sustituirlas por la agenda general', async () => {
  const { calls } = mount('/?scope=mine', { failure: true });
  const next = within(await screen.findByRole('region', { name: 'Próxima cita propia' }));
  await next.findByRole('alert'); fireEvent.click(next.getByRole('button', { name: /Reintentar/ }));
  await waitFor(() => expect(calls.filter(c => c.url.pathname === '/api/appointments')).toHaveLength(4));
  expect(calls.filter(c => c.url.pathname === '/api/appointments').every(c => c.url.searchParams.get('dentistId') === '7')).toBe(true);
});

it('Citas propias ignora dentistId ajeno y conserva fecha, estado y alcance al abrir una atención', async () => {
  const { calls, router } = mount('/appointments?scope=mine&dentistId=8&date=2026-10-26&status=SCHEDULED');
  const visit = await screen.findByRole('button', { name: /Abrir cita de Paciente Propio/ });
  expect(calls.find(c => c.url.pathname === '/api/appointments')?.url.searchParams.get('dentistId')).toBe('7');
  expect(screen.queryByLabelText('Filtrar por dentista')).not.toBeVisible();
  fireEvent.click(visit);
  await screen.findByText('Atención existente');
  const params = new URLSearchParams(router.state.location.search);
  expect(params.get('clinical')).toBe('1');
  expect(params.get('returnTo')).toContain('scope=mine');
  expect(params.get('returnTo')).toContain('date=2026-10-26');
  expect(params.get('returnTo')).toContain('status=SCHEDULED');
});

it('cambiar Citas a Clínica recupera alcance global y permite elegir otro dentista; Atrás recupera la personal', async () => {
  const { calls, router } = mount('/appointments?scope=mine&date=2026-10-26');
  await screen.findByRole('button', { name: /Abrir cita de Paciente Propio/ });
  fireEvent.click(screen.getByRole('link', { name: 'Clínica' }));
  expect(await screen.findByLabelText('Filtrar por dentista')).toBeEnabled();
  await waitFor(() => expect(calls.some(c => c.url.pathname === '/api/appointments' && !c.url.searchParams.has('dentistId'))).toBe(true));
  fireEvent.change(screen.getByLabelText('Filtrar por dentista'), { target: { value: '8' } });
  await waitFor(() => expect(calls.some(c => c.url.pathname === '/api/appointments' && c.url.searchParams.get('dentistId') === '8')).toBe(true));
  await act(() => router.navigate(-2));
  expect(router.state.location.search).toContain('scope=mine');
});

it('la reserva personal fija el profesional y protege el borrador al cambiar de ámbito', async () => {
  mount('/appointments?scope=mine&create=1&dentistId=8&date=2026-10-26&patientId=4');
  expect(await screen.findByLabelText('Dentista', { exact: true })).toBeDisabled();
  expect(screen.getByLabelText('Dentista', { exact: true })).toHaveValue('7');
  fireEvent.click(screen.getByRole('link', { name: 'Clínica' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent(/sin guardar/);
});

it('Mi horario usa el perfil propio aunque no esté en el directorio y guarda con el contrato existente', async () => {
  const { calls } = mount('/scheduling?scope=mine&dentistId=8', { hiddenProfile: true });
  expect(screen.getByRole('link', { name: 'Gestionar mi horario' })).toHaveAttribute('href', '/scheduling?scope=mine&dentistId=8#professional-schedule-tools');
  const edit = await screen.findByRole('button', { name: 'Editar horario' });
  fireEvent.click(edit);
  fireEvent.change(screen.getByLabelText('Inicio Lunes'), { target: { value: '10:00' } });
  fireEvent.submit(screen.getByLabelText('Inicio Lunes').closest('form')!);
  await screen.findByText('Horario del dentista guardado.');
  expect(calls.filter(c => /\/schedules\/dentist\//.test(c.url.pathname)).every(c => c.url.pathname.startsWith('/api/schedules/dentist/7'))).toBe(true);
  expect(calls.find(c => c.method === 'PUT')?.url.pathname).toBe('/api/schedules/dentist/7');
  fireEvent.click(screen.getByRole('tab', { name: 'Ausencias' }));
  expect(screen.getByRole('button', { name: 'Nueva ausencia' })).toBeInTheDocument();
});

it('Mi horario sin perfil no adopta el primer odontólogo del directorio y conserva gestión general', async () => {
  const { calls } = mount('/scheduling?scope=mine', { missing: true });
  await screen.findByRole('heading', { name: 'Sin perfil profesional asociado' });
  expect(calls.some(c => /\/schedules\/dentist\//.test(c.url.pathname))).toBe(false);
  fireEvent.click(screen.getByRole('link', { name: 'Clínica y equipo' }));
  expect(await screen.findByRole('heading', { name: 'Horario de dentistas' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Política de reservas' })).toBeInTheDocument();
});

it('el selector de ámbito no aparece para DENTIST', async () => {
  mount('/appointments?scope=mine&date=2026-10-26', { role: 'DENTIST' });
  await screen.findByRole('button', { name: /Abrir cita de Paciente Propio/ });
  expect(screen.queryByRole('navigation', { name: 'Ámbito de trabajo' })).not.toBeInTheDocument();
});
