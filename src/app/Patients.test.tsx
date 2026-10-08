import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tokenStore } from '../api/http';
import { useAuthStore } from './authStore';
import type { UserDto } from '../api/auth';
import { PatientsPage } from '../components/patients/PatientsPage';
import { PatientDetailPage } from '../components/patients/PatientDetailPage';

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

function user(role: UserDto['role'], patientId?: number): UserDto {
  return {
    id: 10,
    email: `${role.toLowerCase()}@clinica.com`,
    role,
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...(patientId ? { patientId } : {}),
  };
}

function renderAt(ui: React.ReactNode, path = '/patients') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/patients" element={ui} />
          <Route path="/patients/:id" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const PATIENTS_PAGE = {
  content: [
    {
      id: 1,
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'ana@correo.com',
      phone: '+34 600',
      active: true,
      createdAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 2,
      firstName: 'Luis',
      lastName: 'Gómez',
      active: false,
      createdAt: '2026-01-02T00:00:00Z',
    },
  ],
  page: 0,
  size: 20,
  totalElements: 2,
  totalPages: 1,
};

beforeEach(() => {
  tokenStore.set(null);
  useAuthStore.setState({ status: 'authenticated', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Pacientes — listado', () => {
  it('OWNER ve el listado y dispone del alta', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/patients')) return Promise.resolve(response(200, PATIENTS_PAGE));
      return Promise.reject(new Error(`Sin stub para ${url}`));
    });

    renderAt(<PatientsPage />);

    expect(await screen.findByText('Pérez, Ana')).toBeInTheDocument();
    expect(screen.getByText('Gómez, Luis')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo paciente' })).toBeInTheDocument();
  });

  it('PATIENT no dispone del alta y no ve filtros', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT', 1) });
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/patients')) {
        return Promise.resolve(
          response(200, { ...PATIENTS_PAGE, content: [PATIENTS_PAGE.content[0]], totalElements: 1 }),
        );
      }
      return Promise.reject(new Error(`Sin stub para ${url}`));
    });

    renderAt(<PatientsPage />);

    expect(await screen.findByText('Pérez, Ana')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo paciente' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Estado')).not.toBeInTheDocument();
  });

  it('el alta envía el payload administrativo y refresca', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
    let createBody: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/patients') && init?.method === 'POST') {
        createBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Promise.resolve(response(201, { id: 3, ...createBody }));
      }
      if (url.includes('/api/patients')) return Promise.resolve(response(200, PATIENTS_PAGE));
      return Promise.reject(new Error(`Sin stub para ${url}`));
    });

    renderAt(<PatientsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo paciente' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Marta' } });
    fireEvent.change(screen.getByLabelText('Apellidos'), { target: { value: 'Ruiz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear paciente' }));

    await waitFor(() => expect(createBody).toMatchObject({ firstName: 'Marta', lastName: 'Ruiz' }));
  });
});

describe('Paciente — detalle', () => {
  const PATIENT = {
    id: 1,
    firstName: 'Ana',
    lastName: 'Pérez',
    email: 'ana@correo.com',
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('RECEPTIONIST edita datos administrativos pero no ve el expediente clínico', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('RECEPTIONIST') });
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/patients/1/clinical')) {
        return Promise.reject(new Error('no debe consultarse clínico'));
      }
      if (url.includes('/api/patients/1')) return Promise.resolve(response(200, PATIENT));
      return Promise.reject(new Error(`Sin stub para ${url}`));
    });

    renderAt(<PatientDetailPage />, '/patients/1');

    expect(await screen.findByDisplayValue('Ana')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
    expect(screen.queryByText('Expediente clínico')).not.toBeInTheDocument();
  });

  it('DENTIST ve el expediente en modo edición; OWNER en modo lectura', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST') });
    const routes = (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/patients/1/clinical/notes')) return Promise.resolve(response(200, []));
      if (url.includes('/api/patients/1/clinical')) {
        return Promise.resolve(response(200, { patientId: 1, allergies: 'Penicilina' }));
      }
      if (url.includes('/api/patients/1')) return Promise.resolve(response(200, PATIENT));
      return Promise.reject(new Error(`Sin stub para ${url}`));
    };
    vi.stubGlobal('fetch', routes);

    const { unmount } = renderAt(<PatientDetailPage />, '/patients/1');
    expect(await screen.findByText('Expediente clínico')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Penicilina')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Añadir nota' })).toBeInTheDocument();
    unmount();

    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    vi.stubGlobal('fetch', routes);
    renderAt(<PatientDetailPage />, '/patients/1');
    expect(await screen.findByText('Expediente clínico')).toBeInTheDocument();
    expect(await screen.findByText('Penicilina')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Añadir nota' })).not.toBeInTheDocument();
  });
});