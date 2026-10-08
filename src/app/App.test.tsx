import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tokenStore } from '../api/http';
import { useAuthStore } from './authStore';
import { App } from './App';

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
  it('sin sesion valida muestra el login', async () => {
    mockFetch({
      '/api/auth/refresh': { status: 401 },
      '/api/onboarding/status': ONBOARDING_COMPLETE,
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });

  it('con refresh valido hidrata el perfil desde /me', async () => {
    mockFetch({
      '/api/auth/refresh': { status: 200, body: { accessToken: 'access-1' } },
      '/api/auth/me': { status: 200, body: ANA },
      '/api/onboarding/status': ONBOARDING_COMPLETE,
      '/actuator/health': { status: 200, body: { status: 'UP' } },
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'ana@clinica.com' })).toBeInTheDocument();
    expect(screen.getByText('Rol: Propietario')).toBeInTheDocument();
    expect(tokenStore.get()).toBe('access-1');
  });

  it('el login fallido muestra el mensaje neutro del backend', async () => {
    mockFetch({
      '/api/auth/refresh': { status: 401 },
      '/api/onboarding/status': ONBOARDING_COMPLETE,
      '/api/auth/login': {
        status: 401,
        body: { status: 401, error: 'Unauthorized', message: 'Credenciales incorrectas.', path: '/api/auth/login', timestamp: 't' },
      },
    });

    render(<App />);
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
      '/actuator/health': { status: 200, body: { status: 'UP' } },
    });

    render(<App />);
    await screen.findByRole('heading', { name: 'Iniciar sesión' });

    fireEvent.change(screen.getByLabelText('Correo electrónico'), {
      target: { value: 'ana@clinica.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'Clave1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByRole('heading', { name: 'ana@clinica.com' })).toBeInTheDocument();
    await waitFor(() => expect(tokenStore.get()).toBe('access-2'));
  });
});