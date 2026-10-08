import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tokenStore } from '../api/http';
import { useAuthStore } from './authStore';
import { App } from './App';

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

describe('Registro público de pacientes', () => {
  it('crea la cuenta y muestra confirmación sin abrir sesión', async () => {
    window.history.pushState({}, '', '/register');
    useAuthStore.setState({ status: 'anonymous', user: null });

    let registerBody: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/refresh')) return Promise.resolve(response(401));
      if (url.includes('/api/onboarding/status')) {
        return Promise.resolve(response(200, { status: 'COMPLETED', clinicConfigured: true }));
      }
      if (url.includes('/api/auth/register')) {
        registerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Promise.resolve(
          response(201, {
            id: 9,
            email: 'paciente@correo.com',
            role: 'PATIENT',
            active: true,
            createdAt: '2026-01-01T00:00:00Z',
            patientId: 7,
          }),
        );
      }
      if (url.includes('/actuator/health')) {
        return Promise.resolve(response(200, { status: 'UP' }));
      }
      return Promise.reject(new Error(`Sin stub para ${url}`));
    });

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: 'Crear cuenta de paciente' }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Correo electrónico'), {
      target: { value: 'paciente@correo.com' },
    });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'Clave-2026' } });
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), {
      target: { value: 'Clave-2026' },
    });
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Apellidos'), { target: { value: 'Pérez' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(await screen.findByRole('heading', { name: 'Cuenta creada' })).toBeInTheDocument();
    expect(registerBody).toMatchObject({
      email: 'paciente@correo.com',
      firstName: 'Ana',
      lastName: 'Pérez',
    });
    expect(registerBody).not.toHaveProperty('role');
    // El registro no abre sesión: no queda access token en memoria.
    expect(tokenStore.get()).toBeNull();
  });
});