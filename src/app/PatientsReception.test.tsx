import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function receptionist(): UserDto {
  return {
    id: 10,
    email: 'recepcion@clinica.com',
    role: 'RECEPTIONIST',
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

function renderAt(ui: React.ReactNode, path = '/patients') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/patients" element={ui} />
          <Route path="/patients/new" element={ui} />
          <Route path="/patients/:id" element={<PatientDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const LIST = {
  content: [
    { id: 1, firstName: 'Ana', lastName: 'Pérez', email: 'ana@correo.com', phone: '+34 600', birthDate: '1990-03-14', active: true, createdAt: '2026-01-01T00:00:00Z' },
    { id: 2, firstName: 'Luis', lastName: 'Gómez', active: false, createdAt: '2026-01-02T00:00:00Z' },
  ],
  page: 0,
  size: 20,
  totalElements: 2,
  totalPages: 1,
};

beforeEach(() => {
  tokenStore.set(null);
  useAuthStore.setState({ status: 'authenticated', user: receptionist() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(['OWNER', 'RECEPTIONIST', 'DENTIST'] as const)('Pacientes %s — listado editorial compartido', (role) => {
  beforeEach(() => {
    useAuthStore.setState({ user: { ...receptionist(), role } });
  });

  it('muestra filas con identidad completa, recuento y estado por defecto', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(response(200, LIST)));
    renderAt(<PatientsPage />);

    const rows = await screen.findAllByRole('link', { name: /Ana Pérez/ });
    const row = rows[0].closest('li')!;
    // Nombre en orden natural, como lo usa recepción al atender.
    expect(within(row).getByText('Ana Pérez')).toBeInTheDocument();
    expect(within(row).getByText('ana@correo.com · +34 600')).toBeInTheDocument();
    expect(within(row).getByText('14 mar 1990')).toBeInTheDocument();
    expect(within(row).getByText('Activo')).toBeInTheDocument();
    expect(within(row).getByText('Ver ficha')).toBeInTheDocument();
    // La fila secundaria usa el fallback honesto, sin datos inventados.
    const second = screen.getByText('Luis Gómez').closest('li')!;
    expect(within(second).getByText('No registrado')).toBeInTheDocument();
    expect(within(second).getByText('No registrada')).toBeInTheDocument();
    expect(screen.getByText('2 pacientes', { exact: true })).toBeInTheDocument();
    // Sin filtros, Limpiar está deshabilitado.
    expect(screen.getByRole('button', { name: 'Limpiar' })).toBeDisabled();
  });

  it('distingue personas homónimas por fecha de nacimiento y contacto', async () => {
    const twins = {
      content: [
        { id: 1, firstName: 'Ana', lastName: 'Pérez', email: 'ana1@correo.com', birthDate: '1990-03-14', active: true, createdAt: '2026-01-01T00:00:00Z' },
        { id: 2, firstName: 'Ana', lastName: 'Pérez', phone: '+34 611', birthDate: '1985-11-02', active: false, createdAt: '2026-01-02T00:00:00Z' },
      ],
      page: 0, size: 20, totalElements: 2, totalPages: 1,
    };
    vi.stubGlobal('fetch', () => Promise.resolve(response(200, twins)));
    renderAt(<PatientsPage />);

    const rows = await screen.findAllByRole('link', { name: /Ana Pérez/ });
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('14 mar 1990')).toBeInTheDocument();
    expect(within(rows[1]).getByText('2 nov 1985')).toBeInTheDocument();
    expect(within(rows[1]).getByText('+34 611')).toBeInTheDocument();
  });

  it('el borrador de búsqueda se aplica con debounce y resetea la página', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      requests.push(String(input));
      return Promise.resolve(response(200, LIST));
    });
    renderAt(<PatientsPage />);
    await screen.findAllByRole('link', { name: /Ana Pérez/ });

    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'Ana P' } });
    await waitFor(() => expect(requests.at(-1)).toBe('/api/patients?search=Ana+P&page=0&size=20'));
    expect(requests.some((url) => url.includes('search=Ana&'))).toBe(false);
    expect(screen.getByRole('button', { name: 'Limpiar' })).toBeEnabled();
  });

  it('el error de carga ofrece reintento sin inventar contenido', async () => {
    let attempt = 0;
    vi.stubGlobal('fetch', () => {
      attempt += 1;
      return attempt === 1
        ? Promise.resolve(response(500, {}))
        : Promise.resolve(response(200, LIST));
    });
    renderAt(<PatientsPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No se pudo cargar el listado de pacientes.');
    fireEvent.click(within(alert).getByRole('button', { name: 'Reintentar el listado' }));
    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
  });

  it('el estado vacío con filtros ofrece limpiarlos', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      return Promise.resolve(response(200, url.includes('search=') ? { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 } : LIST));
    });
    renderAt(<PatientsPage />);
    await screen.findAllByRole('link', { name: /Ana Pérez/ });
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'zzz' } });

    expect(await screen.findByText('No hay pacientes que coincidan con la búsqueda.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar búsqueda y filtros' }));
    expect(await screen.findByText('Ana Pérez')).toBeInTheDocument();
  });

  it('la carga inicial muestra estados de espera con la forma del listado', async () => {
    vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
    renderAt(<PatientsPage />);
    expect(await screen.findByText('Cargando pacientes…')).toBeInTheDocument();
    expect(document.querySelectorAll('.reception-patients-skeleton-row').length).toBeGreaterThan(0);
  });

  it('pagina conservando búsqueda y estado, y limpia los filtros', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      const page = Number(new URL(url, 'http://localhost').searchParams.get('page') ?? 0);
      return Promise.resolve(response(200, { ...LIST, page, totalElements: 21, totalPages: 2 }));
    });
    renderAt(<PatientsPage />);
    await screen.findByText('Ana Pérez');
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'active' } });
    await waitFor(() => expect(requests.at(-1)).toBe('/api/patients?search=Ana&active=true&page=0&size=20'));
    fireEvent.click(screen.getByRole('button', { name: 'Siguientes' }));
    await waitFor(() => expect(requests.at(-1)).toBe('/api/patients?search=Ana&active=true&page=1&size=20'));
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Anteriores' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Anteriores' }));
    await waitFor(() => expect(requests.at(-1)).toBe('/api/patients?search=Ana&active=true&page=0&size=20'));
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar' }));
    await waitFor(() => expect(requests.at(-1)).toBe('/api/patients?page=0&size=20'));
    expect(screen.getByLabelText('Buscar')).toHaveValue('');
    expect(screen.getByLabelText('Estado')).toHaveValue('all');
  });
});

describe('Pacientes DENTIST — consulta administrativa', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { ...receptionist(), role: 'DENTIST', dentistId: 7 } });
  });

  it.each(['/patients', '/patients?create=1'])('%s no monta el alta ni envía escrituras', async (path) => {
    const requests: Array<{ path: string; method: string }> = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ path: String(input), method: init?.method ?? 'GET' });
      return Promise.resolve(response(200, LIST));
    });
    renderAt(<PatientsPage />, path);
    const row = await screen.findByRole('link', { name: /Ana Pérez/ });
    expect(row).toHaveAttribute('href', '/patients/1');
    expect(screen.getByText('Busca y consulta los datos administrativos de los pacientes.')).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Nuevo paciente|Crear paciente|Editar|Desactivar|Reactivar/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'inactive' } });
    await waitFor(() => expect(requests.at(-1)?.path).toContain('active=false'));
    expect(requests.every(({ method }) => method === 'GET')).toBe(true);
  });

  it('un formulario obtenido como recepción no escribe después de cambiar a DENTIST', async () => {
    useAuthStore.setState({ user: receptionist() });
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      return Promise.resolve(response(200, LIST));
    });
    vi.stubGlobal('fetch', fetcher);
    renderAt(<PatientsPage />, '/patients?create=1');
    fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'Marta' } });
    fireEvent.change(screen.getByLabelText('Apellidos'), { target: { value: 'Ruiz' } });
    const form = screen.getByRole('form', { name: 'Alta administrativa de paciente' });
    act(() => {
      useAuthStore.setState({ user: { ...receptionist(), role: 'DENTIST', dentistId: 7 } });
      fireEvent.submit(form);
    });
    await screen.findByText('Ana Pérez');
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo paciente' })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });
});

describe('Pacientes Recepción — alta', () => {
  it('oculta listado, búsqueda y filtros mientras se registra', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(response(200, LIST)));
    renderAt(<PatientsPage />, '/patients?create=1');

    expect(await screen.findByRole('heading', { name: 'Nuevo paciente' })).toBeInTheDocument();
    expect(screen.getByText('Registra los datos administrativos de una persona sin crearle una cuenta de acceso.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Pacientes' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Buscar')).not.toBeInTheDocument();
    expect(screen.queryByText('Ana Pérez')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Volver a pacientes' })).toHaveAttribute('href', '/patients');
  });

  it('valida nombre y apellidos junto al campo sin enviar la petición', async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(response(200, LIST));
    });
    vi.stubGlobal('fetch', fetcher);
    renderAt(<PatientsPage />, '/patients?create=1');

    fireEvent.click(await screen.findByRole('button', { name: 'Crear paciente' }));
    expect(screen.getByText('Indica el nombre del paciente.')).toBeInTheDocument();
    expect(screen.getByText('Indica los apellidos del paciente.')).toBeInTheDocument();
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(0);
  });

  it('Cancelar cierra el alta y devuelve al listado conservando los filtros', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(response(200, LIST)));
    renderAt(<PatientsPage />, '/patients?create=1');
    await screen.findByRole('heading', { name: 'Nuevo paciente' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('heading', { name: 'Nuevo paciente' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Pacientes' })).toBeInTheDocument();
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
  });

  it('el envío exitoso limpia el formulario, avisa y enlaza a la ficha', async () => {
    let created: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        created = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Promise.resolve(response(201, { id: 9, ...created }));
      }
      return Promise.resolve(response(200, LIST));
    });
    renderAt(<PatientsPage />, '/patients?create=1');
    fireEvent.change(await screen.findByLabelText('Nombre'), { target: { value: 'Marta' } });
    fireEvent.change(screen.getByLabelText('Apellidos'), { target: { value: 'Ruiz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear paciente' }));

    await waitFor(() => expect(created).toMatchObject({ firstName: 'Marta', lastName: 'Ruiz' }));
    expect(await screen.findByText(/Paciente Marta Ruiz creado\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver ficha de Marta' })).toHaveAttribute('href', '/patients/9');
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
    // Vuelve al listado una vez creado el paciente.
    expect(screen.getByRole('heading', { name: 'Pacientes' })).toBeInTheDocument();
  });
});

describe('Pacientes Recepción — ficha administrativa', () => {
  const PATIENT = {
    id: 1,
    firstName: 'Ana',
    lastName: 'Pérez',
    email: 'ana@correo.com',
    phone: '+34 600',
    birthDate: '1990-03-14',
    administrativeNotes: 'Nota real.',
    active: true,
    userId: 44,
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('abre en modo consulta con los datos como texto, no como formulario', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/patients\/1\/(clinical|odontogram)/.test(url)) {
        return Promise.reject(new Error('recepción no consulta datos clínicos'));
      }
      if (url === '/api/patients/1') return Promise.resolve(response(200, PATIENT));
      return Promise.reject(new Error(`Sin stub para ${url}`));
    });
    renderAt(<PatientDetailPage />, '/patients/1');

    expect(await screen.findByRole('heading', { name: 'Ana Pérez' })).toBeInTheDocument();
    expect(screen.getAllByText('Activo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Con cuenta de acceso').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: '← Volver al listado' })).toHaveAttribute('href', '/patients');
    // Los datos se leen, no se editan.
    expect(screen.getByText('14 mar 1990')).toBeInTheDocument();
    expect(screen.getByText('ana@correo.com')).toBeInTheDocument();
    expect(screen.getByText('+34 600')).toBeInTheDocument();
    expect(screen.getByText('Nota real.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Notas administrativas (opcional)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar datos' })).toBeInTheDocument();
    expect(screen.queryByText('Expediente clínico')).not.toBeInTheDocument();
  });

  it('muestra «No registrado» cuando el contrato no trae el dato', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(response(200, { id: 1, firstName: 'Luis', lastName: 'Gómez', active: false, createdAt: '2026-01-01T00:00:00Z' })));
    renderAt(<PatientDetailPage />, '/patients/1');

    await screen.findByRole('heading', { name: 'Luis Gómez' });
    expect(screen.getAllByText('No registrado').length).toBeGreaterThan(0);
    expect(screen.getByText('No registrada')).toBeInTheDocument();
    expect(screen.getAllByText('Sin cuenta de acceso').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inactivo').length).toBeGreaterThan(0);
  });

  it('«Editar datos» abre el formulario y «Cancelar edición» lo cierra sin persistir', async () => {
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void init;
      if (String(input) === '/api/patients/1') return Promise.resolve(response(200, PATIENT));
      return Promise.resolve(response(200, LIST));
    });
    vi.stubGlobal('fetch', fetcher);
    renderAt(<PatientDetailPage />, '/patients/1');

    fireEvent.click(await screen.findByRole('button', { name: 'Editar datos' }));
    expect(screen.getByLabelText('Notas administrativas (opcional)')).toHaveValue('Nota real.');
    fireEvent.change(screen.getByLabelText('Teléfono (opcional)'), { target: { value: '555-9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar edición' }));

    // Vuelve a consulta y el borrador se descarta: no hubo PATCH.
    expect(screen.queryByLabelText('Teléfono (opcional)')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar datos' })).toBeInTheDocument();
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === 'PATCH')).toHaveLength(0);
    // Reabrir precarga el valor real, no el descartado.
    fireEvent.click(screen.getByRole('button', { name: 'Editar datos' }));
    expect(screen.getByLabelText('Teléfono (opcional)')).toHaveValue('+34 600');
  });

  it('guarda los datos administrativos por PATCH, confirma y vuelve a consulta', async () => {
    let patch: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'PATCH' && url === '/api/patients/1') {
        patch = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Promise.resolve(response(200, { ...PATIENT, ...patch }));
      }
      if (url === '/api/patients/1') return Promise.resolve(response(200, PATIENT));
      return Promise.resolve(response(200, LIST));
    });
    renderAt(<PatientDetailPage />, '/patients/1');
    fireEvent.click(await screen.findByRole('button', { name: 'Editar datos' }));
    fireEvent.change(screen.getByLabelText('Teléfono (opcional)'), { target: { value: '555-9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(patch).toMatchObject({ phone: '555-9999', active: true }));
    expect(await screen.findByText('Datos actualizados.')).toBeInTheDocument();
    // Modo consulta con el dato actualizado.
    expect(screen.queryByLabelText('Teléfono (opcional)')).not.toBeInTheDocument();
    expect(screen.getByText('555-9999')).toBeInTheDocument();
  });

  it('si el servidor rechaza el guardado conserva el formulario y muestra el error', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/odontogram/reception-summary')) return Promise.resolve(response(200, []));
      if (init?.method === 'PATCH' && url === '/api/patients/1') {
        return Promise.resolve(response(400, { message: 'El correo no es válido.' }));
      }
      if (url === '/api/patients/1') return Promise.resolve(response(200, PATIENT));
      return Promise.resolve(response(200, LIST));
    });
    renderAt(<PatientDetailPage />, '/patients/1');
    fireEvent.click(await screen.findByRole('button', { name: 'Editar datos' }));
    fireEvent.change(screen.getByLabelText('Teléfono (opcional)'), { target: { value: '555-9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El correo no es válido.');
    expect(screen.getByLabelText('Teléfono (opcional)')).toHaveValue('555-9999');
  });

  it('mantiene el acceso a cargos como acción secundaria cuando el permiso existe', async () => {
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/patients/1') return Promise.resolve(response(200, PATIENT));
      return Promise.reject(new Error(`Sin stub para ${url}`));
    });
    renderAt(<PatientDetailPage />, '/patients/1');

    const charges = await screen.findByRole('link', { name: 'Ver cargos de este paciente' });
    expect(charges).toHaveAttribute('href', '/finances?patientId=1');
  });

  it('el 404 muestra el mensaje seguro y no ofrece edición', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(response(404, { message: 'No encontrado.' })));
    renderAt(<PatientDetailPage />, '/patients/1');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se encontró el paciente.');
    expect(screen.queryByRole('button', { name: 'Editar datos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument();
  });
});

describe('Pacientes Recepción — permisos y contratos', () => {
  it('PATIENT no recibe la experiencia de recepción', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: { id: 1, email: 'p@x.com', role: 'PATIENT', active: true, createdAt: '2026-01-01T00:00:00Z', patientId: 1 },
    });
    vi.stubGlobal('fetch', () => Promise.resolve(response(200, LIST)));
    renderAt(<PatientsPage />);
    expect(await screen.findByRole('heading', { name: 'Mis datos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo paciente' })).not.toBeInTheDocument();
  });
});
