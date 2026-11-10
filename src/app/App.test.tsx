import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tokenStore } from '../api/http';
import { useAuthStore } from './authStore';
import { renderApp } from '../test/renderApp';

interface StubResponse {
  status: number;
  body?: unknown;
}

function stubResponse({ status, body }: StubResponse): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

/** Enruta las llamadas fetch por ruta, de modo que cada test describe su backend. */
function mockFetch(routes: Record<string, StubResponse>): void {
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/notifications/unread-count')) return Promise.resolve(stubResponse({ status: 200, body: { unread: 0 } }));
    const match = Object.keys(routes).find((path) => url.includes(path));
    if (!match) {
      return Promise.reject(new Error(`Sin stub para ${url}`));
    }
    return Promise.resolve(stubResponse(routes[match]!));
  });
}

const ANA = {
  id: 1,
  email: 'ana@clinica.com',
  role: 'OWNER',
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
};

const ONBOARDING_COMPLETE = {
  status: 200,
  body: { status: 'COMPLETED', clinicConfigured: true },
} as const;



beforeEach(() => {
  tokenStore.set(null);
  useAuthStore.setState({ status: 'restoring', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('Arranque y restauracion de sesion', () => {
  it('StrictMode restaura una sola vez para no consumir dos veces el refresh rotativo', async () => {
    let refreshes = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes('/api/auth/refresh')) { refreshes++; return stubResponse({ status: 200, body: { accessToken: 'single-refresh' } }); }
      if (path.includes('/api/auth/me')) return stubResponse({ status: 200, body: ANA });
      if (path.includes('/api/onboarding/status')) return stubResponse(ONBOARDING_COMPLETE);
      if (path.includes('/api/notifications/unread-count')) return stubResponse({ status: 200, body: { unread: 0 } });
      return stubResponse({ status: 200, body: { status: 'UP' } });
    });
    renderApp({ strict: true });
    expect(await screen.findByRole('heading', { name: 'Resumen de la clínica' })).toBeInTheDocument();
    expect(refreshes).toBe(1);
  });
  it('sin sesion valida muestra la landing pública', async () => {
    mockFetch({
      '/api/auth/refresh': { status: 401 },
      '/api/onboarding/status': ONBOARDING_COMPLETE,
    });

    renderApp();

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
    expect(screen.getByRole('heading', { name: /Tu sonrisa,.*nuestra prioridad/ })).toBeInTheDocument();
  });

  it('con refresh valido hidrata el perfil desde /me', async () => {
    mockFetch({
      '/api/auth/refresh': { status: 200, body: { accessToken: 'access-1' } },
      '/api/auth/me': { status: 200, body: ANA },
      '/api/onboarding/status': ONBOARDING_COMPLETE,
      '/actuator/health': { status: 200, body: { status: 'UP' } },
    });

    renderApp();

    expect(await screen.findByRole('heading', { name: 'Resumen de la clínica' })).toBeInTheDocument();
    expect(useAuthStore.getState().user).toEqual(ANA);
    expect(tokenStore.get()).toBe('access-1');
  });

  it('el login fallido muestra el mensaje neutro del backend', async () => {
    window.history.pushState({}, '', '/login');
    mockFetch({
      '/api/auth/refresh': { status: 401 },
      '/api/onboarding/status': ONBOARDING_COMPLETE,
      '/api/auth/login': {
        status: 401,
        body: { status: 401, error: 'Unauthorized', message: 'Credenciales incorrectas.', path: '/api/auth/login', timestamp: 't' },
      },
    });

    renderApp();
    await screen.findByRole('heading', { name: 'Iniciar sesión' });

    fireEvent.change(screen.getByLabelText('Correo electrónico'), {
      target: { value: 'ana@clinica.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'mala' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales incorrectas.');
  });
});

describe('Login correcto', () => {
  it('guarda el token en memoria y entra a la home', async () => {
    window.history.pushState({}, '', '/login');
    mockFetch({
      '/api/auth/refresh': { status: 401 },
      '/api/onboarding/status': ONBOARDING_COMPLETE,
      '/api/auth/login': {
        status: 200,
        body: {
          accessToken: 'access-2',
          tokenType: 'Bearer',
          accessTokenExpiresAt: '2026-01-01T00:15:00Z',
          user: ANA,
        },
      },
      '/api/auth/me': { status: 200, body: ANA },
      '/actuator/health': { status: 200, body: { status: 'UP' } },
    });

    renderApp();
    await screen.findByRole('heading', { name: 'Iniciar sesión' });

    fireEvent.change(screen.getByLabelText('Correo electrónico'), {
      target: { value: 'ana@clinica.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'Clave1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('heading', { name: 'Resumen de la clínica' })).toBeInTheDocument();
    await waitFor(() => expect(tokenStore.get()).toBe('access-2'));
  });
});
