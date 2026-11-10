import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tokenStore } from '../api/http';
import { useAuthStore } from './authStore';
import { renderApp } from '../test/renderApp';

const ANA = {
  id: 1,
  email: 'owner@clinica.com',
  role: 'OWNER',
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
};

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

beforeEach(() => {
  tokenStore.set(null);
  useAuthStore.setState({ status: 'restoring', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('Onboarding de la instalación', () => {
  it('la entrada explícita de instalación nueva completa el wizard sin desplazar la landing', async () => {
    window.history.pushState({}, '', '/onboarding');
    let completed = false;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/notifications/unread-count')) return Promise.resolve(response(200, { unread: 0 }));
      if (url.includes('/api/onboarding/status')) {
        return Promise.resolve(
          response(200, {
            status: completed ? 'COMPLETED' : 'AWAITING_FIRST_USER',
            clinicConfigured: completed,
          }),
        );
      }
      if (url.includes('/api/onboarding')) {
        completed = true;
        return Promise.resolve(response(201, { status: 'COMPLETED', ownerUserId: 1, clinicId: 1 }));
      }
      if (url.includes('/api/auth/login')) {
        return Promise.resolve(
          response(200, {
            accessToken: 'access-1',
            tokenType: 'Bearer',
            accessTokenExpiresAt: '2026-01-01T00:15:00Z',
            user: ANA,
          }),
        );
      }
      if (url.includes('/api/auth/refresh')) {
        return Promise.resolve(response(401));
      }
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(response(200, ANA));
      }
      if (url.includes('/actuator/health')) {
        return Promise.resolve(response(200, { status: 'UP' }));
      }
      void init;
      return Promise.reject(new Error(`Sin stub para ${url}`));
    });

    renderApp();

    expect(await screen.findByRole('heading', { name: 'Prepara tu clínica' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@clinica.com' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'Clave-2026' } });
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: 'Clave-2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Apellidos'), { target: { value: 'Pérez' } });
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '+34 600 000 000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    fireEvent.change(await screen.findByLabelText('Nombre de la clínica'), {
      target: { value: 'Clínica Dental' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Crear clínica' }));

    expect(await screen.findByRole('heading', { name: 'Resumen de la clínica' })).toBeInTheDocument();
    await waitFor(() => expect(tokenStore.get()).toBe('access-1'));
  });
});
