import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tokenStore } from '../api/http';
import { useAuthStore } from './authStore';
import type { UserDto } from '../api/auth';
import { PatientDetailPage } from '../components/patients/PatientDetailPage';

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

function user(role: UserDto['role']): UserDto {
  return { id: 10, email: `${role.toLowerCase()}@clinica.com`, role, active: true, createdAt: '2026-01-01T00:00:00Z' };
}

const PATIENT = {
  id: 1,
  firstName: 'Ana',
  lastName: 'Pérez',
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
};

const TREATMENT = {
  id: 5,
  patientId: 1,
  appointmentId: 9,
  description: 'Limpieza dental',
  diagnosis: 'Sarro acumulado',
  status: 'IN_PROGRESS' as const,
  notes: 'Revisar en la próxima cita',
  price: '75.50',
  createdAt: '2026-02-01T00:00:00Z',
  toothFdis: [],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/patients/1']}>
        <Routes>
          <Route path="/patients/:id" element={<PatientDetailPage />} />
          <Route path="/appointments/:id" element={<h1>Detalle de cita</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stub(routes: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined) {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const result = routes(url, init);
    if (result) return Promise.resolve(result);
    return Promise.reject(new Error(`Sin stub para ${url}`));
  });
}

function baseRoutes(treatments: unknown): (url: string, init?: RequestInit) => Response | undefined {
  return (url) => {
    if (url.includes('/api/patients/1/odontogram')) return response(200, []);
    if (url.includes('/api/patients/1/clinical/notes')) return response(200, []);
    if (url.includes('/api/patients/1/clinical/treatments')) return response(200, treatments);
    if (url.includes('/api/patients/1/clinical')) return response(200, { patientId: 1 });
    if (url.includes('/api/patients/1')) return response(200, PATIENT);
    return undefined;
  };
}

beforeEach(() => {
  tokenStore.set(null);
  useAuthStore.setState({ status: 'authenticated', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Tratamientos — expediente clínico', () => {
  it('DENTIST ve los tratamientos con etiquetas en español y puede crear/editar', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST') });
    stub(baseRoutes([TREATMENT]));
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Limpieza dental' })).toBeInTheDocument();
    expect(screen.getByText('En progreso')).toBeInTheDocument();
    expect(screen.getByText('Sarro acumulado')).toBeInTheDocument();
    expect(screen.getByText('Revisar en la próxima cita')).toBeInTheDocument();
    expect(screen.getByText('75,5')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cita #9' })).toHaveAttribute('href', '/appointments/9');
    expect(screen.getByRole('button', { name: 'Nuevo tratamiento' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Editar/ })).toBeInTheDocument();
  });

  it('OWNER ve los tratamientos y puede crear/editar como personal clínico', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub(baseRoutes([TREATMENT]));
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Tratamientos' }));

    expect(await screen.findByRole('heading', { name: 'Limpieza dental' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo tratamiento' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Editar/ })).toBeInTheDocument();
  });

  it('muestra la lista vacía cuando no hay tratamientos', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST') });
    stub(baseRoutes([]));
    renderPage();

    expect(await screen.findByText('Todavía no hay tratamientos registrados.')).toBeInTheDocument();
  });

  it('indica "Sin piezas relacionadas" cuando el tratamiento no tiene piezas', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub(baseRoutes([{ ...TREATMENT, toothFdis: [] }]));
    renderPage();

    expect(await screen.findByText('Piezas relacionadas')).toBeInTheDocument();
    expect(screen.getByText('Sin piezas relacionadas')).toBeInTheDocument();
  });

  it('muestra una pieza relacionada por su número FDI', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub(baseRoutes([{ ...TREATMENT, toothFdis: [17] }]));
    renderPage();

    const card = await screen.findByLabelText('Tratamiento Limpieza dental');
    expect(within(card).getByText('Piezas relacionadas')).toBeInTheDocument();
    expect(within(card).getByText('17')).toBeInTheDocument();
    expect(within(card).queryByText('Sin piezas relacionadas')).not.toBeInTheDocument();
  });

  it('muestra varias piezas relacionadas (dentición permanente y temporal)', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    stub(baseRoutes([{ ...TREATMENT, toothFdis: [17, 26, 36, 51, 85] }]));
    renderPage();

    const card = await screen.findByLabelText('Tratamiento Limpieza dental');
    expect(within(card).getByText('Piezas relacionadas')).toBeInTheDocument();
    for (const toothFdi of ['17', '26', '36', '51', '85']) {
      expect(within(card).getByText(toothFdi)).toBeInTheDocument();
    }
    expect(within(card).queryByText('Sin piezas relacionadas')).not.toBeInTheDocument();
  });

  it('crea un tratamiento enviando el payload del backend', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST') });
    let createBody: Record<string, unknown> | null = null;
    stub((url, init) => {
      if (url.includes('/api/patients/1/clinical/treatments') && init?.method === 'POST') {
        createBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return response(201, { ...TREATMENT, ...createBody, id: 6 });
      }
      if (url.includes('/api/appointments')) return response(200, { content: [], page: 0, size: 100, totalElements: 0, totalPages: 0 });
      return baseRoutes([TREATMENT])(url, init);
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo tratamiento' }));
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'Empaste' } });
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'COMPLETED' } });
    fireEvent.change(screen.getByLabelText('Precio de referencia (opcional)'), { target: { value: '120,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear tratamiento' }));

    await waitFor(() =>
      expect(createBody).toMatchObject({ description: 'Empaste', status: 'COMPLETED', price: 120.5, appointmentId: null }),
    );
  });

  it('edita un tratamiento y cambia su estado con PUT al endpoint correcto', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST') });
    let putUrl = '';
    let putBody: Record<string, unknown> | null = null;
    stub((url, init) => {
      if (url.includes('/clinical/treatments/5') && init?.method === 'PUT') {
        putUrl = url;
        putBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return response(200, { ...TREATMENT, status: 'COMPLETED' });
      }
      return baseRoutes([TREATMENT])(url, init);
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Editar/ }));
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'COMPLETED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(putBody).toMatchObject({ status: 'COMPLETED' }));
    expect(putUrl).toContain('/api/patients/1/clinical/treatments/5');
  });

  it('muestra un error si falla la carga de tratamientos', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST') });
    stub((url, init) => {
      if (url.includes('/api/patients/1/clinical/treatments')) return response(500, { message: 'boom' });
      return baseRoutes([])(url, init);
    });
    renderPage();

    expect(await screen.findByText('No se pudieron cargar los tratamientos.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  async function openEvolution(card: HTMLElement): Promise<HTMLElement> {
    if (useAuthStore.getState().user?.role === 'OWNER') fireEvent.click(await screen.findByRole('tab', { name: 'Tratamientos' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Evolución' }));
    return within(card).getByLabelText('Evolución del tratamiento');
  }

  describe('Tratamientos — evolución clínica (RF-TR-07)', () => {
    const EVOLUTION_BASE = (content: string, id: number) => ({
      id,
      content,
      authorDentistId: 2,
      authorName: 'Dra. Ana',
      createdAt: '2026-03-01T10:00:00Z',
    });

    it('solo carga la evolución al abrir la sección desplegable', async () => {
      useAuthStore.setState({ status: 'authenticated', user: user('DENTIST') });
      let evolutionRequests = 0;
      stub((url) => {
        if (url.includes('/evolution')) {
          evolutionRequests += 1;
          return response(200, []);
        }
        return baseRoutes([TREATMENT])(url);
      });
      renderPage();

      const card = await screen.findByLabelText('Tratamiento Limpieza dental');
      expect(evolutionRequests).toBe(0);
      fireEvent.click(within(card).getByRole('button', { name: 'Evolución' }));
      expect(await within(card).findByText('Sin registros de evolución.')).toBeInTheDocument();
      expect(evolutionRequests).toBe(1);
    });

    it('muestra el estado vacío para un tratamiento sin evolución', async () => {
      useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
      stub((url) => {
        if (url.includes('/evolution')) return response(200, []);
        return baseRoutes([TREATMENT])(url);
      });
      renderPage();

      const card = await screen.findByLabelText('Tratamiento Limpieza dental');
      const panel = await openEvolution(card);
      expect(await within(panel).findByText('Sin registros de evolución.')).toBeInTheDocument();
      expect(within(card).queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument();
    });

    it('muestra varias entradas en orden cronológico con autor y fecha', async () => {
      useAuthStore.setState({ status: 'authenticated', user: user('DENTIST') });
      stub((url) => {
        if (url.includes('/evolution')) {
          return response(200, [
            EVOLUTION_BASE('Primera valoración.', 1),
            EVOLUTION_BASE('Evolución favorable.', 2),
          ]);
        }
        return baseRoutes([TREATMENT])(url);
      });
      renderPage();

      const card = await screen.findByLabelText('Tratamiento Limpieza dental');
      const panel = await openEvolution(card);
      const items = await within(panel).findAllByRole('listitem');
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent('Primera valoración.');
      expect(items[1]).toHaveTextContent('Evolución favorable.');
      expect(within(panel).getAllByText(/Dra\. Ana ·/)).toHaveLength(2);
    });

    it('registra una nota, la envía sin autor ni fecha y actualiza el listado automáticamente', async () => {
      useAuthStore.setState({ status: 'authenticated', user: user('DENTIST') });
      const entries: unknown[] = [];
      let postBody: Record<string, unknown> | null = null;
      stub((url, init) => {
        if (url.includes('/evolution') && init?.method === 'POST') {
          postBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          const created = EVOLUTION_BASE(String(postBody.content), 1);
          entries.push(created);
          return response(201, created);
        }
        if (url.includes('/evolution')) return response(200, entries);
        return baseRoutes([TREATMENT])(url, init);
      });
      renderPage();

      const card = await screen.findByLabelText('Tratamiento Limpieza dental');
      const panel = await openEvolution(card);
      await within(panel).findByText('Sin registros de evolución.');

      const textarea = within(panel).getByLabelText('Nueva nota de evolución');
      fireEvent.change(textarea, { target: { value: 'Paciente sin molestias.' } });
      fireEvent.click(within(panel).getByRole('button', { name: 'Registrar nota' }));

      await waitFor(() => expect(postBody).toEqual({ content: 'Paciente sin molestias.' }));
      expect(await within(panel).findByText('Paciente sin molestias.')).toBeInTheDocument();
      expect(within(panel).getByText(/Dra\. Ana ·/u)).toBeInTheDocument();
      expect((textarea as HTMLTextAreaElement).value).toBe('');
    });

    it('valida contenido vacío y longitud máxima sin enviar la petición', async () => {
      useAuthStore.setState({ status: 'authenticated', user: user('DENTIST') });
      let evolutionPosts = 0;
      stub((url, init) => {
        if (url.includes('/evolution') && init?.method === 'POST') {
          evolutionPosts += 1;
          return response(201, EVOLUTION_BASE('x', 1));
        }
        if (url.includes('/evolution')) return response(200, []);
        return baseRoutes([TREATMENT])(url, init);
      });
      renderPage();

      const card = await screen.findByLabelText('Tratamiento Limpieza dental');
      const panel = await openEvolution(card);
      const textarea = within(panel).getByLabelText('Nueva nota de evolución');

      fireEvent.click(within(panel).getByRole('button', { name: 'Registrar nota' }));
      expect(within(panel).getByText('El contenido es obligatorio.')).toBeInTheDocument();

      fireEvent.change(textarea, { target: { value: 'a'.repeat(4001) } });
      fireEvent.click(within(panel).getByRole('button', { name: 'Registrar nota' }));
      expect(within(panel).getByText('El contenido admite hasta 4000 caracteres.')).toBeInTheDocument();

      expect(evolutionPosts).toBe(0);
    });

    it('deshabilita el botón y muestra progreso mientras guarda', async () => {
      useAuthStore.setState({ status: 'authenticated', user: user('DENTIST') });
      const entries: unknown[] = [];
      let resolvePost!: (result: Response) => void;
      stub((url, init) => {
        if (url.includes('/evolution') && init?.method === 'POST') {
          return new Promise<Response>((resolve) => {
            resolvePost = resolve;
          });
        }
        if (url.includes('/evolution')) return response(200, entries);
        return baseRoutes([TREATMENT])(url, init);
      });
      renderPage();

      const card = await screen.findByLabelText('Tratamiento Limpieza dental');
      const panel = await openEvolution(card);
      const textarea = within(panel).getByLabelText('Nueva nota de evolución');
      fireEvent.change(textarea, { target: { value: 'En observación.' } });

      const submit = within(panel).getByRole('button', { name: 'Registrar nota' });
      fireEvent.click(submit);

      const saving = within(panel).getByRole('button', { name: 'Guardando…' });
      expect(saving).toBeDisabled();

      await waitFor(() => expect(resolvePost).toBeDefined());
      entries.push(EVOLUTION_BASE('En observación.', 1));
      resolvePost(response(201, entries[0]));
      expect(await within(panel).findByText('En observación.')).toBeInTheDocument();
    });

    it('muestra error de carga con reintento y error de guardado preservando el texto', async () => {
      useAuthStore.setState({ status: 'authenticated', user: user('DENTIST') });
      let failLoad = true;
      let evolutionPosts = 0;
      stub((url, init) => {
        if (url.includes('/evolution') && init?.method === 'POST') {
          evolutionPosts += 1;
          return response(500);
        }
        if (url.includes('/evolution')) {
          return failLoad ? response(500) : response(200, []);
        }
        return baseRoutes([TREATMENT])(url, init);
      });
      renderPage();

      const card = await screen.findByLabelText('Tratamiento Limpieza dental');
      const panel = await openEvolution(card);
      expect(
        await within(panel).findByText('No se pudieron cargar los registros de evolución.'),
      ).toBeInTheDocument();

      failLoad = false;
      fireEvent.click(within(panel).getByRole('button', { name: 'Reintentar' }));
      expect(await within(panel).findByText('Sin registros de evolución.')).toBeInTheDocument();

      const textarea = within(panel).getByLabelText('Nueva nota de evolución');
      fireEvent.change(textarea, { target: { value: 'Aguanta el texto.' } });
      fireEvent.click(within(panel).getByRole('button', { name: 'Registrar nota' }));

      expect(await within(panel).findByText('No se pudo guardar la evolución.')).toBeInTheDocument();
      expect((textarea as HTMLTextAreaElement).value).toBe('Aguanta el texto.');
      expect(evolutionPosts).toBe(1);
    });
  });
});
