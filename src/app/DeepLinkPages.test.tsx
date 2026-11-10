import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Role } from '../api/auth';
import { cancelSessionRequests, tokenStore } from '../api/http';
import { renderApp } from '../test/renderApp';
import { useAuthStore } from './authStore';

const page = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };
const days = [1, 2, 3, 4, 5, 6, 7].map(dayOfWeek => ({ dayOfWeek, open: true, startTime: '08:00:00', endTime: '18:00:00', breaks: [] }));

function setup(path: string, role: Role = 'OWNER', loggedIn = true) {
  window.history.replaceState({}, '', path);
  cancelSessionRequests(); tokenStore.set(null);
  useAuthStore.setState({ status: 'restoring', user: null });
  const requests: URL[] = [];
  let authenticated = loggedIn;
  const user = { id: 10, role, email: 'actor@dc.test', active: true, createdAt: '2026-01-01', dentistId: 7, patientId: 1 };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    requests.push(url);
    const route = url.pathname;
    let body: unknown;
    if (route === '/api/auth/refresh') return authenticated ? new Response('{"accessToken":"deep-link-test"}') : new Response('{}', { status: 401 });
    if (route === '/api/auth/login') { authenticated = true; body = { accessToken: 'deep-link-test' }; }
    else if (route === '/api/auth/me') body = user;
    else if (route === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (route === '/api/notifications/unread-count') body = { unread: 0 };
    else if (route === '/api/public/schedule') body = { timezone: 'UTC', days, exceptions: [], dentists: [7, 8].map(dentistId => ({ dentistId, firstName: 'Profesional', lastName: String(dentistId), days })) };
    else if (route === '/api/availability/policy') body = { timezone: 'UTC' };
    else if (route === '/api/schedules/clinic') body = { timezone: 'UTC', days };
    else if (route === '/api/appointments' || route === '/api/patients') body = page;
    else if (route === '/api/patients/1') body = { id: 1, firstName: 'Paciente', lastName: 'Prueba', active: true };
    else if (route === '/api/services' || route === '/api/public/services') body = [];
    else if (route === '/api/financial/reports/cash-flow') body = { grossAmount: '123.45', reversalAmount: '0.00', netAmount: '123.45', methods: [] };
    else if (route === '/api/financial/reports/charges') body = { confirmedCharges: 0, billedAmount: '0.00', appliedAmount: '0.00', pendingBalance: '0.00', byPatient: [] };
    else if (route === '/api/financial/reports/portfolio') body = { asOf: '2026-10-01T00:00:00Z', confirmedCharges: 0, billedAmount: '0.00', appliedAmount: '0.00', pendingBalance: '0.00', statusCounts: { pendiente: 0, parcial: 0, pagado: 0, anulado: 0 } };
    else throw new Error(`Consulta no esperada en este enlace: ${route}`);
    return new Response(JSON.stringify(body));
  }));
  return { ...renderApp(), requests };
}

afterEach(() => {
  cancelSessionRequests(); tokenStore.set(null); vi.unstubAllGlobals();
  useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'anonymous', user: null });
  window.history.replaceState({}, '', '/');
});

it('abre agenda con día, estado, dentista y paciente reales y conserva filtros al recargar', async () => {
  const path = '/appointments?view=day&date=2026-10-13&status=SCHEDULED&dentistId=7&patientId=1';
  const first = setup(path);
  expect(await screen.findByLabelText('Fecha')).toHaveValue('2026-10-13');
  await waitFor(() => expect(first.requests.some(url => url.pathname === '/api/appointments' && url.searchParams.get('patientId') === '1')).toBe(true));
  const request = first.requests.find(url => url.pathname === '/api/appointments')!;
  expect(request.searchParams.get('from')).toBe('2026-10-13T00:00:00.000Z');
  expect(request.searchParams.get('to')).toBe('2026-10-14T00:00:00.000Z');
  expect(request.searchParams.get('dentistId')).toBe('7');
  expect(request.searchParams.get('status')).toBe('SCHEDULED');
  first.unmount(); first.router.dispose();
  setup(path);
  expect(await screen.findByLabelText('Fecha')).toHaveValue('2026-10-13');
  expect(screen.getByLabelText('Filtrar por estado')).toHaveValue('SCHEDULED');
});

it('conserva el deep link solicitado después del login', async () => {
  const path = '/appointments?view=day&date=2026-10-13&status=CANCELLED';
  setup(path, 'OWNER', false);
  await screen.findByRole('heading', { name: 'Iniciar sesión' });
  fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'actor@dc.test' } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'Password-2026' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  expect(await screen.findByLabelText('Fecha')).toHaveValue('2026-10-13');
  expect(window.location.pathname + window.location.search).toBe(path);
});

it('abre y enfoca el formulario existente de nueva cita', async () => {
  setup('/appointments?view=day&date=2026-10-13&dentistId=7&create=1');
  const heading = await screen.findByRole('heading', { name: 'Nueva cita' });
  await waitFor(() => expect(heading).toHaveFocus());
  expect(screen.getByLabelText('Día')).toHaveValue('2026-10-13');
  expect(screen.getByLabelText('Dentista', { exact: true })).toHaveValue('7');
});

it.each(['OWNER', 'RECEPTIONIST'] as const)('%s abre alta de paciente por URL y tras recarga', async (role) => {
  const path = '/patients?create=1';
  const first = setup(path, role);
  // Alta compartida: mismo deep link, foco y persistencia tras recarga.
  const heading = 'Nuevo paciente';
  expect(await screen.findByText(heading)).toBeInTheDocument();
  expect(screen.getByLabelText('Nombre')).toHaveFocus();
  first.unmount(); first.router.dispose();
  setup(path, role);
  expect(await screen.findByLabelText('Nombre')).toBeInTheDocument();
});

it('DENTIST no obtiene el formulario administrativo por añadir create a la URL', async () => {
  setup('/patients?create=1', 'DENTIST');
  await screen.findByRole('heading', { name: 'Pacientes' });
  expect(screen.queryByRole('heading', { name: 'Nuevo paciente' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
});

it('DENTIST conserva su filtro propio y PATIENT no adopta un patientId ajeno', async () => {
  const first = setup('/appointments?dentistId=8', 'DENTIST');
  await screen.findByLabelText('Fecha');
  await waitFor(() => expect(first.requests.some(url => url.pathname === '/api/appointments')).toBe(true));
  expect(first.requests.find(url => url.pathname === '/api/appointments')!.searchParams.get('dentistId')).toBe('7');
  first.unmount(); first.router.dispose();
  const second = setup('/appointments?patientId=999', 'PATIENT');
  await screen.findByRole('heading', { name: 'Mis citas' });
  await waitFor(() => expect(second.requests.some(url => url.pathname === '/api/appointments')).toBe(true));
  expect(second.requests.find(url => url.pathname === '/api/appointments')!.searchParams.has('patientId')).toBe(false);
});

it('reporte abre pestaña y período exacto, con Back/Forward sin perderlos', async () => {
  const path = '/finances/reports?tab=cobros&from=2026-10-01T06%3A00%3A00Z&to=2026-11-01T06%3A00%3A00Z';
  const view = setup(path, 'RECEPTIONIST');
  await screen.findAllByText('$123.45 MXN');
  expect(screen.getByRole('tab', { name: 'Cobros por período' })).toHaveAttribute('aria-selected', 'true');
  const query = view.requests.find(url => url.pathname.endsWith('/cash-flow'))!;
  expect(query.searchParams.get('from')).toBe('2026-10-01T06:00:00Z');
  expect(query.searchParams.get('to')).toBe('2026-11-01T06:00:00Z');
  fireEvent.click(screen.getByRole('tab', { name: 'Cargos y saldos' }));
  await screen.findByRole('form', { name: 'Filtrar cargos y saldos' });
  await act(async () => { await view.router.navigate(-1); });
  expect(screen.getByRole('tab', { name: 'Cobros por período' })).toHaveAttribute('aria-selected', 'true');
  expect(window.location.search).toContain('from=2026-10-01T06%3A00%3A00Z');
  await act(async () => { await view.router.navigate(1); });
  expect(screen.getByRole('tab', { name: 'Cargos y saldos' })).toHaveAttribute('aria-selected', 'true');
});

it('período inválido no dispara un reporte sin filtros', async () => {
  const view = setup('/finances/reports?tab=cobros&from=invalid');
  await screen.findByText(/El enlace contiene un período/);
  expect(view.requests.some(url => url.pathname.startsWith('/api/financial/reports'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Restablecer enlace' }));
  await waitFor(() => expect(view.requests.some(url => url.pathname.endsWith('/cash-flow'))).toBe(true));
});
