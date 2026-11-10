import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '../api/auth';
import { cancelSessionRequests, tokenStore } from '../api/http';
import { renderApp } from '../test/renderApp';
import { useAuthStore } from './authStore';

const PRIVATE = 'Aviso sintético privado de la sesión';
const landingHeading = /Tu sonrisa,.*nuestra prioridad/;
function response(body?: unknown, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}
function fixture(role: Role, status = 204) {
  let finish!: () => void;
  const logoutResponse = new Promise<Response>(resolve => { finish = () => resolve(response(undefined, status)); });
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === '/api/auth/refresh') return response({ accessToken: 'logout-test-token' });
    if (path === '/api/auth/me') return response({ id: 1, role, email: 'synthetic@logout.test', active: true, createdAt: '2026-01-01' });
    if (path === '/api/auth/logout') return logoutResponse;
    if (path === '/api/notifications/unread-count') return response({ unread: 0 });
    if (path.startsWith('/api/notifications?')) return response({ content: [{ id: 1, title: PRIVATE, body: 'Solo esta cuenta', priority: 'NORMAL', read: true, createdAt: '2026-01-01' }], page: 0, size: 20, totalElements: 1, totalPages: 1 });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return { finish, fetcher };
}

beforeEach(() => {
  cancelSessionRequests(); tokenStore.set(null);
  useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'restoring', user: null, restorationError: false });
  window.history.replaceState({}, '', '/notifications');
});
afterEach(() => {
  cleanup(); cancelSessionRequests(); tokenStore.set(null);
  useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'anonymous', user: null });
  window.history.replaceState({}, '', '/'); vi.unstubAllGlobals();
});

describe('Logout global hacia landing pública', () => {
  it.each<Role>(['OWNER', 'DENTIST', 'RECEPTIONIST', 'PATIENT'])('%s limpia sesión/caché y no pasa por login mientras espera el cierre remoto', async role => {
    const api = fixture(role);
    const { router } = renderApp();
    await screen.findByRole('heading', { name: PRIVATE });
    const previousClient = useAuthStore.getState().queryClient;
    expect(previousClient.getQueryCache().getAll().length).toBeGreaterThan(0);
    const routes: string[] = [];
    const unsubscribe = router.subscribe(state => { routes.push(state.location.pathname); });
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('heading', { name: landingHeading })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().user).toBeNull();
    expect(tokenStore.get()).toBeNull();
    expect(previousClient.getQueryCache().getAll()).toHaveLength(0);
    expect(useAuthStore.getState().queryClient).not.toBe(previousClient);
    expect(screen.queryByText(PRIVATE)).not.toBeInTheDocument();
    await act(async () => api.finish());
    expect(routes).not.toContain('/login');
    expect(router.state.location.pathname).toBe('/');
    expect(api.fetcher.mock.calls.filter(([path]) => String(path) === '/api/auth/logout')).toHaveLength(1);
    expect(api.fetcher).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST', credentials: 'include' }));
    unsubscribe();
  });

  it('si el servidor falla mantiene limpieza local y muestra el aviso existente en la landing', async () => {
    const api = fixture('OWNER', 503);
    renderApp(); await screen.findByRole('heading', { name: PRIVATE });
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await screen.findByRole('heading', { name: landingHeading });
    await act(async () => api.finish());
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo confirmar el cierre remoto.');
    expect(window.location.pathname).toBe('/');
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(tokenStore.get()).toBeNull();
    await waitFor(() => expect(screen.queryByText(PRIVATE)).not.toBeInTheDocument());
  });
});
