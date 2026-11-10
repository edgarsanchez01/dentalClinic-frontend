import { focusManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Role, UserDto } from '../api/auth';
import { cancelSessionRequests, tokenStore } from '../api/http';
import type { NotificationDto } from '../api/notifications';
import { notificationKeys } from '../components/notifications/notificationQueries';
import { renderApp } from '../test/renderApp';
import { useAuthStore } from './authStore';

const A: UserDto = { id: 1, email: 'a@example.com', role: 'PATIENT', active: true, createdAt: '2026-01-01' };
const B: UserDto = { ...A, id: 2, email: 'b@example.com' };
const NOTICE: NotificationDto = { id: 12, title: 'Aviso A', body: 'Solo A', priority: 'NORMAL', read: false, createdAt: '2026-10-12T09:00:00Z' };
const inbox = (title: string, page = 0) => ({ content: [{ ...NOTICE, title }], page, size: 20, totalElements: 21, totalPages: 2 });

function response(body?: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  focusManager.setFocused(false);
  cancelSessionRequests();
  tokenStore.set(null);
  useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'restoring', user: null });
  window.history.replaceState({}, '', '/notifications');
});

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  cancelSessionRequests();
  useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'anonymous', user: null });
  tokenStore.set(null);
  window.history.replaceState({}, '', '/');
  vi.unstubAllGlobals();
});

describe('Ruta real /notifications y frontera de sesión', () => {
  it.each<Role>(['OWNER', 'DENTIST', 'RECEPTIONIST', 'PATIENT'])('permite acceso autenticado a %s con AppShell y un solo contador', async (role) => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/availability/policy') return response({ timezone: 'America/Mexico_City' });
      if (path === '/api/auth/refresh') return response({ accessToken: 'route-token' });
      if (path === '/api/auth/me') return response({ ...A, role });
      if (path === '/api/notifications/unread-count') return response({ unread: 3 });
      if (path === '/api/notifications?page=0&size=20') return response(inbox('Aviso del buzón'));
      throw new Error(`Sin stub para ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Aviso del buzón' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notificaciones' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Notificaciones: 3 sin leer' })).toHaveAttribute('href', '/notifications');
    expect(screen.getByRole('navigation', { name: 'Navegación de escritorio' })).toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('unread-count'))).toHaveLength(1);
    expect(fetcher.mock.calls.some(([path]) => String(path).endsWith('/read'))).toBe(false);
  });

  it('redirige a login sin consultar el buzón cuando no hay sesión', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/availability/policy') return response({ timezone: 'America/Mexico_City' });
      if (path === '/api/auth/refresh') return response(undefined, 401);
      if (path === '/api/onboarding/status') return response({ status: 'COMPLETED', clinicConfigured: true });
      throw new Error(`Sin stub para ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    renderApp();
    await screen.findByRole('heading', { name: 'Iniciar sesión' });
    expect(fetcher.mock.calls.some(([path]) => String(path).startsWith('/api/notifications'))).toBe(false);
    expect(window.location.pathname).toBe('/login');
  });

  it('si la sesión expira al regresar limpia los datos privados y deja de consultar notificaciones', async () => {
    let expired = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/availability/policy') return response({ timezone: 'America/Mexico_City' });
      if (path === '/api/auth/refresh') return expired ? response(undefined, 401) : response({ accessToken: 'token-A' });
      if (path === '/api/auth/me') return response(A);
      if (path === '/api/onboarding/status') return response({ status: 'COMPLETED', clinicConfigured: true });
      if (expired && path.startsWith('/api/notifications')) return response(undefined, 401);
      if (path === '/api/notifications/unread-count') return response({ unread: 5 });
      if (path.startsWith('/api/notifications?')) return response(inbox('Aviso privado A'));
      throw new Error(`Sin stub para ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    renderApp();
    await screen.findByRole('heading', { name: 'Aviso privado A' });
    await screen.findByRole('link', { name: 'Notificaciones: 5 sin leer' });
    const oldClient = useAuthStore.getState().queryClient;
    expect(oldClient.getQueryData(notificationKeys.list(A.id))).toBeDefined();
    expired = true;
    await act(async () => { focusManager.setFocused(true); });
    await screen.findByRole('heading', { name: 'Iniciar sesión' });
    expect(screen.queryByRole('heading', { name: 'Aviso privado A' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Notificaciones:/ })).not.toBeInTheDocument();
    expect(oldClient.getQueryCache().getAll()).toHaveLength(0);
    expect(tokenStore.get()).toBeNull();
    const requestsAfterExpiry = fetcher.mock.calls.length;
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    expect(fetcher).toHaveBeenCalledTimes(requestsAfterExpiry);
  });

  it('un marcado tardío de A no altera el buzón de B y la nueva sesión comienza en página cero', async () => {
    const pending = deferred<Response>();
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/availability/policy') return response({ timezone: 'America/Mexico_City' });
      if (path === '/api/auth/refresh') return response({ accessToken: 'token-A' });
      if (path === '/api/auth/login') return response({ accessToken: 'token-B', user: B });
      if (path === '/api/auth/me') return response(tokenStore.get() === 'token-A' ? A : B);
      if (path === '/api/onboarding/status') return response({ status: 'COMPLETED', clinicConfigured: true });
      if (path === '/actuator/health') return response({ status: 'UP' });
      if (path === '/api/notifications/12/read') return pending.promise;
      const isA = (init?.headers as Record<string, string>).Authorization === 'Bearer token-A';
      if (path === '/api/notifications/unread-count') return response({ unread: isA ? 5 : 8 });
      if (path.includes('/api/notifications?')) {
        requests.push(`${isA ? 'A' : 'B'}:${path}`);
        const page = Number(new URL(path, 'http://localhost').searchParams.get('page'));
        return response(inbox(isA ? 'Aviso A' : 'Aviso B', page));
      }
      throw new Error(`Sin stub para ${path}`);
    }));
    renderApp();
    await screen.findByRole('heading', { name: 'Aviso A' });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByText('Página 2 de 2');
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída' }));
    await screen.findByText('Marcando notificación como leída…');
    await act(() => useAuthStore.getState().login(B.email, 'password'));
    // 9D.3: RequireGuest conserva el destino interno solicitado para PATIENT, también al restaurar.
    // La nueva sesión vuelve a su buzón, sin montar un dashboard intermedio.
    fireEvent.click(await screen.findByRole('link', { name: 'Notificaciones: 8 sin leer' }));
    await screen.findByRole('heading', { name: 'Aviso B' });
    expect(screen.queryByRole('heading', { name: 'Aviso A' })).not.toBeInTheDocument();
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument();
    await screen.findByRole('link', { name: 'Notificaciones: 8 sin leer' });
    await waitFor(() => expect(useAuthStore.getState().queryClient.isFetching()).toBe(0));
    const requestsBeforeLateResponse = [...requests];
    await act(async () => { pending.resolve(response({ ...NOTICE, read: true })); });
    expect(screen.getByText('No leída')).toBeInTheDocument();
    expect(screen.queryByText('Notificación marcada como leída.')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(requests).toEqual(requestsBeforeLateResponse);
    // El buzón sigue comenzando en página cero y no hay preview de Inicio intermedio.
    expect(new Set(requests.filter((request) => request.startsWith('B:')))).toEqual(new Set([
      'B:/api/notifications?page=0&size=20',
    ]));
  });
});
