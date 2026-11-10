import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserDto } from '../api/auth';
import { apiFetch, cancelSessionRequests, tokenStore } from '../api/http';
import { useAuthStore } from './authStore';
import { renderApp } from '../test/renderApp';

const A: UserDto = { id: 1, email: 'a@example.com', role: 'PATIENT', active: true, createdAt: '2026-01-01' };
const B: UserDto = { ...A, id: 2, email: 'b@example.com' };
const KEY = ['appointments']; // Misma clave privada para ambas identidades.

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function PrivateData() {
  const query = useQuery({ queryKey: KEY, queryFn: () => apiFetch<string>('/api/appointments') });
  return <p>{query.data ?? 'Cargando datos privados'}</p>;
}

/** Misma frontera de provider/remontaje que App, sin rutas ajenas al hallazgo. */
function SessionView() {
  const { queryClient, sessionVersion, status } = useAuthStore();
  return (
    <QueryClientProvider key={sessionVersion} client={queryClient}>
      {status === 'authenticated' ? <PrivateData /> : <p>{status}</p>}
    </QueryClientProvider>
  );
}

function mockLoginAndData(pendingData?: Promise<Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/api/auth/login')) {
      return Promise.resolve(response(200, { accessToken: 'token-B', user: B }));
    }
    if (path.endsWith('/api/auth/logout')) return Promise.resolve(response(204));
    if (path.endsWith('/api/auth/me')) return Promise.resolve(response(200, B));
    if (path.endsWith('/api/appointments')) {
      const headers = init?.headers as Record<string, string>;
      return headers.Authorization === 'Bearer token-A'
        ? (pendingData ?? Promise.resolve(response(200, 'privado-A')))
        : Promise.resolve(response(200, 'privado-B'));
    }
    throw new Error(`Sin stub para ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  cancelSessionRequests();
  tokenStore.set('token-A');
  useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'authenticated', user: A });
});

afterEach(() => {
  cleanup();
  cancelSessionRequests();
  useAuthStore.getState().queryClient.clear();
  tokenStore.set(null);
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('H-A03 — aislamiento de cache entre sesiones', () => {
  it('App real: PATIENT abre Mis datos y cambiar a OWNER restaura Pacientes sin reutilizar la cache anterior', async () => {
    const pendingB = deferred<Response>();
    const patientA = { ...A, patientId: 41, medicalOnboarding: { requirement: 'EXEMPT_EXISTING' as const, progress: 'NOT_STARTED' as const, pending: false } };
    const ownerB: UserDto = { ...B, role: 'OWNER' };
    const page = (name: string) => ({
      content: [{ id: 1, firstName: name, lastName: 'Privado', active: true, createdAt: '2026-01-01' }],
      page: 0, size: 20, totalElements: 1, totalPages: 1,
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/api/notifications/unread-count')) return Promise.resolve(response(200, { unread: 0 }));
      if (path.endsWith('/api/auth/refresh')) return Promise.resolve(response(200, { accessToken: 'token-A' }));
      if (path.endsWith('/api/auth/me')) {
        return Promise.resolve(response(200,
          (init?.headers as Record<string, string>).Authorization === 'Bearer token-A' ? patientA : ownerB));
      }
      if (path.endsWith('/api/auth/logout')) return Promise.resolve(response(204));
      if (path.endsWith('/api/auth/login')) return Promise.resolve(response(200, { accessToken: 'token-B', user: ownerB }));
      if (path.endsWith('/api/onboarding/status')) return Promise.resolve(response(200, { status: 'COMPLETED', clinicConfigured: true }));
      if (path.endsWith('/actuator/health')) return Promise.resolve(response(200, { status: 'UP' }));
      if (path.includes('/odontogram')) return Promise.resolve(response(200, []));
      if (path.includes('/clinical')) return Promise.resolve(response(200,
        path.endsWith('/notes') || path.endsWith('/treatments') ? [] : { patientId: 41 }));
      if (path.endsWith('/api/patients/41')) return Promise.resolve(response(200, {
        ...page((init?.headers as Record<string, string>).Authorization === 'Bearer token-A' ? 'Usuario-A' : 'Usuario-B').content[0],
        id: 41, userId: A.id,
      }));
      if (path.includes('/api/patients')) return pendingB.promise;
      throw new Error(`Sin stub para ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/');
    renderApp();
    await screen.findByRole('heading', { name: 'Tu atención dental' });
    const ownLink = within(screen.getByRole('navigation', { name: 'Navegación de escritorio' })).getByRole('link', { name: 'Mis datos' });
    expect(ownLink).toHaveAttribute('href', '/patients/41');
    expect(screen.queryByRole('link', { name: 'Pacientes' })).not.toBeInTheDocument();
    fireEvent.click(ownLink);
    expect(await screen.findByText('Usuario-A Privado')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mis datos' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/patients/41');
    expect(fetchMock.mock.calls.filter(([path]) => String(path).includes('/api/auth/me'))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([path]) => String(path).startsWith('/api/patients?') || String(path) === '/api/patients')).toBe(false);
    const oldClient = useAuthStore.getState().queryClient;
    await act(() => useAuthStore.getState().logout());
    await screen.findByRole('heading', { name: 'Iniciar sesión' });
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: B.email } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    const staffNav = await screen.findByRole('navigation', { name: 'Navegación de escritorio' });
    const staffLink = within(staffNav).getByRole('link', { name: 'Pacientes' });
    expect(staffLink).toHaveAttribute('href', '/patients');
    expect(screen.queryByRole('link', { name: 'Mis datos' })).not.toBeInTheDocument();
    fireEvent.click(staffLink);
    await screen.findByRole('heading', { name: 'Pacientes' });
    expect(screen.queryByText(/Usuario-A/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Buscar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo paciente' })).toBeInTheDocument();
    expect(oldClient.getQueryCache().getAll()).toHaveLength(0);
    await act(async () => { pendingB.resolve(response(200, page('Usuario-B'))); });
    expect(await screen.findByText('Usuario-B Privado')).toBeInTheDocument();
    expect(screen.queryByText(/Usuario-A/)).not.toBeInTheDocument();
  });

  it.each(['logout', 'login directo'] as const)('A → B mediante %s nunca renderiza datos de A para B', async (mode) => {
    mockLoginAndData();
    render(<SessionView />);
    expect(await screen.findByText('privado-A')).toBeInTheDocument();
    const oldClient = useAuthStore.getState().queryClient;
    const observedByB: unknown[] = [];
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.user?.id === B.id) observedByB.push(state.queryClient.getQueryData(KEY));
    });

    if (mode === 'logout') {
      await act(() => useAuthStore.getState().logout());
      expect(screen.queryByText('privado-A')).not.toBeInTheDocument();
    }
    await act(() => useAuthStore.getState().login(B.email, 'password'));

    expect(await screen.findByText('privado-B')).toBeInTheDocument();
    expect(screen.queryByText('privado-A')).not.toBeInTheDocument();
    expect(observedByB).not.toContain('privado-A');
    expect(oldClient.getQueryCache().getAll()).toHaveLength(0);
    expect(useAuthStore.getState().queryClient).not.toBe(oldClient);
    unsubscribe();
  });

  it('limpia de inmediato aunque el logout server-side falle', async () => {
    const logout = deferred<Response>();
    vi.stubGlobal('fetch', () => logout.promise);
    const oldClient = useAuthStore.getState().queryClient;
    oldClient.setQueryData(KEY, 'privado-A');
    const result = useAuthStore.getState().logout();
    const assertion = expect(result).rejects.toMatchObject({ status: 503 });
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(oldClient.getQueryData(KEY)).toBeUndefined();
    expect(tokenStore.get()).toBeNull();
    logout.resolve(response(503));
    await assertion;
  });

  it('descarta respuestas privadas tardias aunque el transporte ignore abort', async () => {
    const pending = deferred<Response>();
    const fetchMock = mockLoginAndData(pending.promise);
    render(<SessionView />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/appointments'), expect.anything(),
    ));
    const oldClient = useAuthStore.getState().queryClient;
    const signal = fetchMock.mock.calls[0]![1]!.signal!;
    await act(() => useAuthStore.getState().logout());
    await act(() => useAuthStore.getState().login(B.email, 'password'));
    expect(await screen.findByText('privado-B')).toBeInTheDocument();
    await act(async () => { pending.resolve(response(200, 'privado-A')); });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText('privado-A')).not.toBeInTheDocument();
    expect(oldClient.getQueryData(KEY)).toBeUndefined();
    expect(useAuthStore.getState().queryClient.getQueryData(KEY)).toBe('privado-B');
  });

  it('una mutacion de A tardia no puede ejecutar su callback con datos privados', async () => {
    const pending = deferred<Response>();
    mockLoginAndData();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(() => pending.promise);
    const oldClient = useAuthStore.getState().queryClient;
    const onSuccess = vi.fn((data: string) => oldClient.setQueryData(KEY, data));
    const mutation = oldClient.getMutationCache().build(oldClient, {
      mutationFn: () => apiFetch<string>('/api/appointments', { method: 'POST' }), onSuccess,
    });
    const result = mutation.execute(undefined);
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await useAuthStore.getState().logout();
    await useAuthStore.getState().login(B.email, 'password');
    pending.resolve(response(200, 'privado-A'));
    await assertion;
    expect(onSuccess).not.toHaveBeenCalled();
    expect(useAuthStore.getState().queryClient.getQueryData(KEY)).toBeUndefined();
  });

  it.each(['rechazo', 'red', '401 tras renovar'] as const)('invalida y limpia ante %s de renovacion', async (mode) => {
    const oldClient = useAuthStore.getState().queryClient;
    oldClient.setQueryData(KEY, 'privado-A');
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/auth/refresh')) {
        if (mode === 'red') return Promise.reject(new Error('Sin conexion'));
        return Promise.resolve(response(mode === 'rechazo' ? 401 : 200, { accessToken: 'renovado-A' }));
      }
      return Promise.resolve(response(401));
    });
    await expect(apiFetch('/api/appointments')).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(oldClient.getQueryData(KEY)).toBeUndefined();
    expect(tokenStore.get()).toBeNull();
  });

  it.each([true, false])('restauracion (valida=%s) elimina cache anterior antes de resolver /me', async (valid) => {
    const pending = deferred<Response>();
    const oldClient = useAuthStore.getState().queryClient;
    oldClient.setQueryData(KEY, 'privado-A');
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => String(input).endsWith('/api/auth/refresh')
      ? pending.promise : Promise.resolve(response(200, B)));
    const hydration = useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().status).toBe('restoring');
    expect(oldClient.getQueryData(KEY)).toBeUndefined();
    pending.resolve(response(valid ? 200 : 401, { accessToken: 'token-B' }));
    await hydration;
    expect(useAuthStore.getState().status).toBe(valid ? 'authenticated' : 'anonymous');
    expect(useAuthStore.getState().queryClient.getQueryData(KEY)).toBeUndefined();
    expect(useAuthStore.getState().user?.id).toBe(valid ? B.id : undefined);
  });

  it('un refresh tardio de A no restaura su token ni invalida a B', async () => {
    const pending = deferred<Response>();
    mockLoginAndData();
    vi.mocked(fetch).mockImplementationOnce(() => Promise.resolve(response(401)))
      .mockImplementationOnce(() => pending.promise);
    const oldRequest = apiFetch('/api/appointments');
    const assertion = expect(oldRequest).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await useAuthStore.getState().logout();
    await useAuthStore.getState().login(B.email, 'password');
    pending.resolve(response(200, { accessToken: 'renovado-A' }));
    await assertion;
    expect(tokenStore.get()).toBe('token-B');
    expect(useAuthStore.getState().user?.id).toBe(B.id);
  });

  it('renovacion valida de A reintenta con su token nuevo sin cambiar su cache', async () => {
    const client = useAuthStore.getState().queryClient;
    client.setQueryData(KEY, 'privado-A');
    const fetchMock = vi.fn().mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { accessToken: 'renovado-A' }))
      .mockResolvedValueOnce(response(200, 'privado-A'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiFetch('/api/appointments')).resolves.toBe('privado-A');
    expect(fetchMock.mock.calls[2]![1].headers.Authorization).toBe('Bearer renovado-A');
    expect(useAuthStore.getState().queryClient).toBe(client);
    expect(useAuthStore.getState().user?.id).toBe(A.id);
  });

  it('un login tardio no reabre A despues de logout y login B', async () => {
    const pending = deferred<Response>();
    mockLoginAndData();
    vi.mocked(fetch).mockImplementationOnce(() => pending.promise);
    const oldLogin = useAuthStore.getState().login(A.email, 'password');
    const assertion = expect(oldLogin).rejects.toMatchObject({ name: 'AbortError' });
    await useAuthStore.getState().logout();
    await useAuthStore.getState().login(B.email, 'password');
    pending.resolve(response(200, { accessToken: 'token-A', user: A }));
    await assertion;
    expect(tokenStore.get()).toBe('token-B');
    expect(useAuthStore.getState().user?.id).toBe(B.id);
  });
});
