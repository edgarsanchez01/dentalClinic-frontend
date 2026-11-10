import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserDto } from '../api/auth';
import { cancelSessionRequests, tokenStore } from '../api/http';
import { LoginPage } from '../components/auth/LoginPage';
import { useAuthStore } from './authStore';
import { RequireAuth, RequireGuest } from './guards';

const BASE: UserDto = { id: 1, email: 'a@example.com', role: 'PATIENT', active: true, createdAt: '2026-01-01' };
const PATIENT = { ...BASE, patientId: 41 };
const DENTIST: UserDto = { ...BASE, role: 'DENTIST', dentistId: 72 };

function response(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mockLogin(profile: UserDto, me: () => Promise<Response> = () => Promise.resolve(response(200, profile))) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/api/auth/login')) {
      // Igual que el contrato observado: login no trae asociaciones de perfil.
      return Promise.resolve(response(200, { accessToken: 'token-A', user: { ...BASE, role: profile.role } }));
    }
    if (path.endsWith('/api/auth/me')) return me();
    if (path.endsWith('/api/auth/refresh')) return Promise.resolve(response(401));
    if (path.endsWith('/api/auth/logout')) return Promise.resolve(response(204));
    throw new Error(`Sin stub para ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function ProfileDestination() {
  const user = useAuthStore((state) => state.user);
  return <div><h1>Perfil listo</h1><p>{user?.role === 'PATIENT'
    ? `Paciente ${user.patientId}` : `Profesional ${user?.dentistId}`}</p></div>;
}

function renderLoginRoute() {
  render(
    <MemoryRouter initialEntries={['/appointments']}>
      <Routes>
        <Route path="/login" element={<RequireGuest><LoginPage /></RequireGuest>} />
        <Route path="/appointments" element={<RequireAuth><ProfileDestination /></RequireAuth>} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: BASE.email } });
  fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

beforeEach(() => {
  cancelSessionRequests();
  tokenStore.set(null);
  useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'anonymous', user: null });
});

afterEach(() => {
  cleanup();
  cancelSessionRequests();
  tokenStore.set(null);
  useAuthStore.getState().queryClient.clear();
  vi.unstubAllGlobals();
});

describe('H-A01 — perfil autoritativo inmediatamente tras login', () => {
  it.each([
    PATIENT,
    DENTIST,
    { ...BASE, role: 'OWNER' as const },
    { ...BASE, role: 'RECEPTIONIST' as const },
    { ...BASE, role: 'OWNER' as const, dentistId: 73 },
  ])('usa exactamente /me para $role (patientId=$patientId, dentistId=$dentistId)', async (profile) => {
    const fetchMock = mockLogin(profile);
    await useAuthStore.getState().login(BASE.email, 'password');
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user).toEqual(profile);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/auth/me'), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer token-A' }),
    }));
    expect(tokenStore.get()).toBe('token-A');
  });

  it.each([PATIENT, DENTIST])('no navega hasta resolver /me; $role tiene su ID sin recargar', async (profile) => {
    const pending = deferred<Response>();
    const fetchMock = mockLogin(profile, () => pending.promise);
    const authenticated: UserDto[] = [];
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.status === 'authenticated' && state.user) authenticated.push(state.user);
    });
    renderLoginRoute();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/me'), expect.anything(),
    ));
    expect(useAuthStore.getState().status).not.toBe('authenticated');
    expect(useAuthStore.getState().user).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Perfil listo' })).not.toBeInTheDocument();
    await act(async () => { pending.resolve(response(200, profile)); });
    expect(await screen.findByRole('heading', { name: 'Perfil listo' })).toBeInTheDocument();
    expect(screen.getByText(profile.role === 'PATIENT' ? 'Paciente 41' : 'Profesional 72')).toBeInTheDocument();
    expect(authenticated).toEqual([profile]);
    unsubscribe();
  });

  it.each(['503', 'red', '401'] as const)('fallo de /me (%s) no deja token ni perfil aparentemente valido', async (failure) => {
    mockLogin(PATIENT, () => failure === 'red'
      ? Promise.reject(new Error('Sin conexion')) : Promise.resolve(response(Number(failure))));
    await expect(useAuthStore.getState().login(BASE.email, 'password')).rejects.toBeDefined();
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().user).toBeNull();
    expect(tokenStore.get()).toBeNull();
  });

  it('fallo de /me muestra error en login y no navega', async () => {
    mockLogin(PATIENT, () => Promise.resolve(response(503, { message: 'Perfil no disponible.' })));
    renderLoginRoute();
    expect(await screen.findByRole('alert')).toHaveTextContent('Perfil no disponible.');
    expect(screen.queryByRole('heading', { name: 'Perfil listo' })).not.toBeInTheDocument();
    expect(tokenStore.get()).toBeNull();
  });

  it.each([200, 503])('/me tardio de A (%s) no reemplaza ni invalida a B y su cache', async (status) => {
    const pending = deferred<Response>();
    const profileB = { ...PATIENT, id: 2, email: 'b@example.com', patientId: 42 };
    let current = 'A';
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/auth/login')) return Promise.resolve(response(200, {
        accessToken: `token-${current}`, user: BASE,
      }));
      if (path.endsWith('/api/auth/me')) return current === 'A'
        ? pending.promise : Promise.resolve(response(200, profileB));
      throw new Error(`Sin stub para ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const oldClient = useAuthStore.getState().queryClient;
    oldClient.setQueryData(['appointments'], 'privado-A');
    const oldLogin = useAuthStore.getState().login(BASE.email, 'password');
    const assertion = expect(oldLogin).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    current = 'B';
    await useAuthStore.getState().login(profileB.email, 'password');
    const clientB = useAuthStore.getState().queryClient;
    clientB.setQueryData(['appointments'], 'privado-B');
    pending.resolve(response(status, PATIENT));
    await assertion;
    expect(useAuthStore.getState().user).toEqual(profileB);
    expect(tokenStore.get()).toBe('token-B');
    expect(useAuthStore.getState().queryClient).toBe(clientB);
    expect(clientB.getQueryData(['appointments'])).toBe('privado-B');
    expect(oldClient.getQueryData(['appointments'])).toBeUndefined();
  });

  it('logout durante /me impide que un perfil tardio reabra la sesion', async () => {
    const pending = deferred<Response>();
    const fetchMock = mockLogin(PATIENT, () => pending.promise);
    const login = useAuthStore.getState().login(BASE.email, 'password');
    const assertion = expect(login).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await useAuthStore.getState().logout();
    pending.resolve(response(200, PATIENT));
    await assertion;
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().user).toBeNull();
    expect(tokenStore.get()).toBeNull();
  });

  it('si /me renueva el token conserva el token renovado al publicar el perfil', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(200, { accessToken: 'token-A', user: BASE }))
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, { accessToken: 'renovado-A' }))
      .mockResolvedValueOnce(response(200, PATIENT));
    vi.stubGlobal('fetch', fetchMock);
    await useAuthStore.getState().login(BASE.email, 'password');
    expect(useAuthStore.getState().user).toEqual(PATIENT);
    expect(tokenStore.get()).toBe('renovado-A');
  });
});
