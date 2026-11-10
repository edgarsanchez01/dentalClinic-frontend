import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
          <Route path="/patients/:id" element={<PatientDetailPage />} />
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

    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByText('Luis Gómez')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo paciente' })).toBeInTheDocument();
  });

  it('PATIENT que visita /patients abre directamente su ficha sin consultar el listado', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT', 1) });
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/patients/1/odontogram') return Promise.resolve(response(200, []));
      if (url === '/api/patients/1') return Promise.resolve(response(200, PATIENTS_PAGE.content[0]));
      return Promise.reject(new Error(`Sin stub para ${url}`));
    });
    vi.stubGlobal('fetch', fetcher);

    renderAt(<PatientsPage />);

    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mis datos' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Volver al listado/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo paciente' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Estado')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Buscar')).not.toBeInTheDocument();
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual(['/api/patients/1', '/api/patients/1/odontogram']);
  });

  it('PATIENT sin vínculo ve un estado claro sin consultar ni inferir una ficha', () => {
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT') });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    renderAt(<PatientsPage />);
    expect(screen.getByRole('heading', { name: 'Mis datos' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No tienes una ficha de paciente vinculada a tu cuenta.');
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Nuevo paciente' })).not.toBeInTheDocument();
  });

  it.each(['OWNER', 'DENTIST', 'RECEPTIONIST'] as const)('%s conserva búsqueda, filtros y permisos del listado', async (role) => {
    useAuthStore.setState({ status: 'authenticated', user: user(role) });
    const requests: string[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      requests.push(String(input));
      return Promise.resolve(response(200, PATIENTS_PAGE));
    });
    renderAt(<PatientsPage />);
    // Ambos roles comparten el listado editorial y su contrato de consulta.
    await screen.findByText('Ana Pérez');
    expect(screen.getByRole('heading', { name: 'Pacientes' })).toBeInTheDocument();
    expect(screen.getByLabelText('Buscar')).toBeInTheDocument();
    expect(screen.getByLabelText('Estado')).toBeInTheDocument();
    expect(Boolean(screen.queryByRole('button', { name: 'Nuevo paciente' }))).toBe(role !== 'DENTIST');
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'active' } });
    await waitFor(() => expect(requests.at(-1)).toBe('/api/patients?search=Ana&active=true&page=0&size=20'));
  });

  it.each(['OWNER', 'RECEPTIONIST'] as const)('%s: el alta envía el payload administrativo y refresca', async (role) => {
    useAuthStore.setState({ status: 'authenticated', user: user(role) });
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

  it('pagina el listado y conserva búsqueda y filtros', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    const requests: string[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      const page = new URL(url, 'http://localhost').searchParams.get('page');
      if (page === '1') {
        return Promise.resolve(response(200, {
          content: [{ id: 42, firstName: 'Pilar', lastName: 'Ruiz', active: true, createdAt: '2026-01-03T00:00:00Z' }],
          page: 1,
          size: 20,
          totalElements: 21,
          totalPages: 2,
        }));
      }
      return Promise.resolve(response(200, { ...PATIENTS_PAGE, totalElements: 21, totalPages: 2 }));
    });

    renderAt(<PatientsPage />);
    await screen.findByText('Ana Pérez');
    expect(screen.getByText('21 pacientes')).toBeInTheDocument();
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Siguientes' }));
    expect(await screen.findByText('Pilar Ruiz')).toBeInTheDocument();
    expect(requests.at(-1)).toBe('/api/patients?page=1&size=20');
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguientes' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Anteriores' }));
    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
    expect(requests.at(-1)).toBe('/api/patients?page=0&size=20');
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
    let odontogramCalls = 0;
    let summaryCalls = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/patients/1/odontogram/reception-summary')) {
        summaryCalls += 1; return Promise.resolve(response(200, []));
      }
      if (url.includes('/api/patients/1/odontogram')) {
        odontogramCalls += 1;
        return Promise.reject(new Error('el odontograma no debe consultarse para RECEPTIONIST'));
      }
      if (url.includes('/api/patients/1/clinical')) {
        return Promise.reject(new Error('no debe consultarse clínico'));
      }
      if (url.includes('/api/patients/1')) return Promise.resolve(response(200, PATIENT));
      return Promise.reject(new Error(`Sin stub para ${url}`));
    });

    renderAt(<PatientDetailPage />, '/patients/1');

    // UX-04E.1: la ficha de RECEPTIONIST abre en modo consulta; la edición es
    // explícita. Se comprueba que sigue habiendo edición administrativa y que
    // no se consulta ni se muestra nada clínico.
    expect(await screen.findByRole('heading', { name: 'Ana Pérez' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar datos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editar datos' }));
    expect(await screen.findByDisplayValue('Ana')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
    expect(screen.queryByText('Expediente clínico')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Odontograma' })).toBeInTheDocument();
    expect(summaryCalls).toBe(1);
    expect(odontogramCalls).toBe(0);
  });

  it('DENTIST y OWNER ven el expediente en modo edición', async () => {
    const routes = (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/patients/1/odontogram')) return Promise.resolve(response(200, []));
      if (url.includes('/api/patients/1/clinical/notes')) return Promise.resolve(response(200, []));
      if (url.includes('/api/patients/1/clinical/treatments')) return Promise.resolve(response(200, []));
      if (url.includes('/api/patients/1/clinical')) {
        return Promise.resolve(response(200, { patientId: 1, allergies: 'Penicilina' }));
      }
      if (url.includes('/api/patients/1')) return Promise.resolve(response(200, PATIENT));
      return Promise.reject(new Error(`Sin stub para ${url}`));
    };

    for (const role of ['DENTIST', 'OWNER'] as const) {
      useAuthStore.setState({ status: 'authenticated', user: user(role) });
      vi.stubGlobal('fetch', routes);

      const { unmount } = renderAt(<PatientDetailPage />, '/patients/1');
      if (role === 'OWNER') fireEvent.click(await screen.findByRole('tab', { name: 'Expediente clínico' }));
      expect(await screen.findByRole('heading', { name: 'Expediente clínico' })).toBeInTheDocument();
      expect(await screen.findByDisplayValue('Penicilina')).toBeInTheDocument();
      if (role === 'OWNER') fireEvent.click(screen.getByRole('tab', { name: 'Notas clínicas' }));
      expect(screen.getByRole('button', { name: 'Añadir nota' })).toBeInTheDocument();
      if (role === 'OWNER') fireEvent.click(screen.getByRole('tab', { name: 'Odontograma' }));
      expect(screen.getByRole('heading', { name: 'Odontograma' })).toBeInTheDocument();
      expect(screen.getByText(/Registro clínico/)).toBeInTheDocument();
      expect(
        await screen.findByRole('button', { name: /Pieza 16 Superior derecho Permanente: sin registro/ }),
      ).toBeInTheDocument();
      unmount();
    }
  });

  it.each([undefined, 7])('H-A04: OWNER con dentistId=%s conserva escritura clínica', async (dentistId) => {
    useAuthStore.setState({ status: 'authenticated', user: {
      ...user('OWNER'), ...(dentistId === undefined ? {} : { dentistId }),
    } });
    const clinicalMethods: string[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/patients/1/odontogram')) return Promise.resolve(response(200, []));
      if (url.includes('/api/patients/1/clinical')) {
        clinicalMethods.push(init?.method ?? 'GET');
        return Promise.resolve(response(200, url.includes('/notes') || url.includes('/treatments')
          ? [] : { patientId: 1, allergies: 'Penicilina' }));
      }
      if (url.includes('/api/patients/1')) return Promise.resolve(response(200, PATIENT));
      return Promise.reject(new Error(`Sin stub para ${url}`));
    });
    renderAt(<PatientDetailPage />, '/patients/1');
    fireEvent.click(await screen.findByRole('tab', { name: 'Expediente clínico' }));
    const heading = await screen.findByRole('heading', { name: 'Expediente clínico' });
    expect(await screen.findByDisplayValue('Penicilina')).toBeInTheDocument();
    const clinical = within(heading.closest('section')!);
    expect(clinical.getByText('Los datos clínicos son sensibles. Las notas son inmutables una vez registradas.')).toBeInTheDocument();
    expect(clinical.getByText('Dato de salud protegido')).toBeInTheDocument();
    expect(clinical.getAllByRole('textbox').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Guardar expediente' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Notas clínicas' }));
    expect(screen.getByRole('button', { name: 'Añadir nota' })).toBeInTheDocument();
    // Includes the new read-only confirmed patient declarations (never a draft).
    await waitFor(() => expect(clinicalMethods).toEqual(['GET', 'GET', 'GET', 'GET']));
  });

  it('PATIENT consulta el resumen de su propio odontograma sin expediente completo', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT', 1) });
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/patients/1/odontogram')) {
        return Promise.resolve(response(200, [
          { toothFdi: 16, dentition: 'PERMANENT', condition: 'CARIES' },
          { toothFdi: 26, dentition: 'PERMANENT', condition: 'RESTORED' },
        ]));
      }
      if (url.includes('/api/patients/1')) return Promise.resolve(response(200, PATIENT));
      return Promise.reject(new Error(`Sin stub para ${url}`));
    });

    renderAt(<PatientDetailPage />, '/patients/1');

    expect(await screen.findByRole('heading', { name: 'Odontograma' })).toBeInTheDocument();
    expect(screen.queryByText('Expediente clínico')).not.toBeInTheDocument();
    expect(screen.queryByText('Añadir nota')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Pieza 16/ })).toBeInTheDocument();
  });

  it('PATIENT no consulta ni muestra datos administrativos o clínicos de una ficha ajena', () => {
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT', 7) });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);

    renderAt(<PatientDetailPage />, '/patients/1');

    expect(screen.getByRole('alert')).toHaveTextContent('No se encontró tu ficha de paciente.');
    expect(screen.queryByText('Pérez, Ana')).not.toBeInTheDocument();
    expect(screen.queryByText('Odontograma')).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('un vínculo que devuelve 404 muestra un estado seguro sin consultar el odontograma', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('PATIENT', 1) });
    const fetcher = vi.fn(async () => response(404, { message: 'No encontrado.' }));
    vi.stubGlobal('fetch', fetcher);
    renderAt(<PatientDetailPage />, '/patients/1');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se encontró tu ficha de paciente.');
    expect(screen.getByRole('heading', { name: 'Mis datos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
