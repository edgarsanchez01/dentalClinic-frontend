import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { cancelSessionRequests, tokenStore } from '../api/http';
import { useAuthStore } from './authStore';
import { RequireAuth, RequireGuest } from './guards';
import { RegisterPage } from '../components/auth/RegisterPage';

const user = { id: 9, email: 'paciente@correo.com', role: 'PATIENT', active: true, createdAt: '2026-01-01T00:00:00Z', patientId: 7,
  medicalOnboarding: { requirement: 'REQUIRED', progress: 'NOT_STARTED', pending: true } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function renderRegistration() {
  render(<MemoryRouter initialEntries={[{ pathname: '/register', state: { from: '/appointments?create=1' } }]}>
    <Routes>
      <Route path="/register" element={<RequireGuest><RegisterPage /></RequireGuest>} />
      <Route path="/patient-onboarding" element={<RequireAuth><h1>Cuestionario médico</h1></RequireAuth>} />
      <Route path="/" element={<h1>Dashboard</h1>} />
    </Routes>
  </MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'Clave-2026' } });
  fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'Clave-2026' } });
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } });
  fireEvent.change(screen.getByLabelText('Apellidos'), { target: { value: 'Pérez' } });
  fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
}

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

beforeEach(() => {
  cancelSessionRequests();
  tokenStore.set(null);
  useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'anonymous', user: null, restorationError: false });
});

afterEach(() => {
  cancelSessionRequests();
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('Registro público de pacientes', () => {
  it('crea sesión una sola vez, espera /me y navega directamente al cuestionario', async () => {
    const me = deferred<Response>();
    let registerBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/register')) {
        registerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Promise.resolve(response(201, { accessToken: 'registration-token', user: { ...user, patientId: undefined } }));
      }
      if (url.endsWith('/api/auth/me')) return me.promise;
      return Promise.reject(new Error(`Sin stub para ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRegistration();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toHaveTextContent('Creando tu cuenta e iniciando sesión');
    expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
    expect(useAuthStore.getState().user).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
    await act(async () => me.resolve(response(200, user)));
    expect(await screen.findByRole('heading', { name: 'Cuestionario médico' })).toBeInTheDocument();
    expect(registerBody).toMatchObject({
      email: 'paciente@correo.com',
      firstName: 'Ana',
      lastName: 'Pérez',
    });
    expect(registerBody).not.toHaveProperty('role');
    expect(fetchMock.mock.calls.map(([path]) => String(path))).toEqual(['/api/auth/register', '/api/auth/me']);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'include', headers: expect.objectContaining({ Authorization: 'Bearer registration-token' }) }));
    expect(useAuthStore.getState().user).toEqual(user);
    expect(tokenStore.get()).toBe('registration-token');
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toMatch(/registration-token|paciente@correo/);
  });

  it('rechazo del alta no consulta /me ni publica credenciales', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(409, { message: 'El correo ya está registrado.' }));
    vi.stubGlobal('fetch', fetchMock);
    renderRegistration();
    expect(await screen.findByRole('alert')).toHaveTextContent('El correo ya está registrado.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(tokenStore.get()).toBeNull();
  });

  it('si /me falla después del alta recupera con refresh, nunca repite registro ni pide login', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(201, { accessToken: 'registration-token', user }))
      .mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response(200, { accessToken: 'renewed-token' }))
      .mockResolvedValueOnce(response(200, user));
    vi.stubGlobal('fetch', fetchMock);
    renderRegistration();
    expect(await screen.findByRole('button', { name: 'Reintentar sesión' })).toBeInTheDocument();
    expect(tokenStore.get()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Cuestionario médico' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([path]) => String(path))).toEqual(['/api/auth/register', '/api/auth/me', '/api/auth/refresh', '/api/auth/me']);
    expect(tokenStore.get()).toBe('renewed-token');
  });

  it('logout durante un registro tardío no reabre sesión ni publica el token', async () => {
    const pending = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn((path: string) => path.endsWith('/register') ? pending.promise : Promise.resolve(response(204))));
    const registration = useAuthStore.getState().register({ email: user.email, password: 'Clave-2026', firstName: 'Ana', lastName: 'Perez' });
    const assertion = expect(registration).rejects.toMatchObject({ name: 'AbortError' });
    await useAuthStore.getState().logout();
    pending.resolve(response(201, { accessToken: 'late-token', user }));
    await assertion;
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(tokenStore.get()).toBeNull();
  });

  it('respuesta perdida del registro recupera la cookie sin repetir el alta', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('Respuesta perdida'))
      .mockResolvedValueOnce(response(200, { accessToken: 'recovered-token' })).mockResolvedValueOnce(response(200, user));
    vi.stubGlobal('fetch', fetchMock);
    renderRegistration();
    fireEvent.click(await screen.findByRole('button', { name: 'Reintentar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Cuestionario médico' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([path]) => String(path))).toEqual(['/api/auth/register', '/api/auth/refresh', '/api/auth/me']);
  });

  it('401 en /me y refresh denegado no vuelven a ofrecer el POST de registro automáticamente', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(201, { accessToken: 'registration-token', user }))
      .mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(401));
    vi.stubGlobal('fetch', fetchMock);
    renderRegistration();
    expect(await screen.findByRole('button', { name: 'Reintentar sesión' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear cuenta' })).not.toBeInTheDocument();
    expect(useAuthStore.getState().user).toBeNull();
    expect(tokenStore.get()).toBeNull();
  });
});
