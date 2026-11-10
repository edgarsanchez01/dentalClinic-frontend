import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tokenStore } from '../api/http';
import { useAuthStore } from './authStore';
import type { UserDto } from '../api/auth';
import { PatientDetailPage } from '../components/patients/PatientDetailPage';
import { AttentionTraceSection } from '../components/appointments/AttentionTraceSection';

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

const PATIENT = { id: 1, firstName: 'Ana', lastName: 'Pérez', active: true, createdAt: '2026-01-01T00:00:00Z' };
const TREATMENT = {
  id: 5, patientId: 1, appointmentId: null, description: 'Limpieza dental', diagnosis: 'Sarro',
  status: 'IN_PROGRESS' as const, notes: null, price: '75.50', createdAt: '2026-02-01T00:00:00Z', toothFdis: [],
};

// Cadena append-only: raiz + una correccion. La correccion apunta a la raiz (correctsRecordId).
const NOTE_ROOT = { id: 1, content: 'Texto original', authorDentistId: 3, authorName: 'Dra. Ana', createdAt: '2026-02-01T00:00:00Z' };
const NOTE_CORRECTION = { id: 2, content: 'Texto corregido', authorDentistId: 4, authorName: 'Dr. Luis', createdAt: '2026-02-02T00:00:00Z', correctsRecordId: 1, correctionReason: 'Aclaración solicitada' };

const EVOLUTION_ROOT = { id: 21, content: 'Valoración inicial', authorDentistId: 3, authorName: 'Dra. Ana', createdAt: '2026-02-01T00:00:00Z', treatmentId: 5 };
const EVOLUTION_CORRECTION = { id: 22, content: 'Valoración inicial (corregida)', authorDentistId: 3, authorName: 'Dra. Ana', createdAt: '2026-02-03T00:00:00Z', treatmentId: 5, correctsRecordId: 21, correctionReason: 'Error de transcripción' };

function stub(routes: (url: string, init?: RequestInit) => Response | undefined) {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const result = routes(url, init);
    if (result) return Promise.resolve(result);
    return Promise.reject(new Error(`Sin stub para ${url}`));
  });
}

function baseRoutes(notes: unknown, evolution: unknown): (url: string, init?: RequestInit) => Response | undefined {
  return (url) => {
    if (url.includes('/api/patients/1/odontogram')) return response(200, []);
    if (url.includes('/evolution')) return response(200, evolution);
    if (url.includes('/api/patients/1/clinical/notes')) return response(200, notes);
    if (url.includes('/api/patients/1/clinical/treatments')) return response(200, [TREATMENT]);
    if (url.includes('/api/patients/1/clinical')) return response(200, { patientId: 1 });
    if (url.includes('/api/patients/1')) return response(200, PATIENT);
    return undefined;
  };
}

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

async function openEvolution(card: HTMLElement) {
  if (useAuthStore.getState().user?.role === 'OWNER') fireEvent.click(await screen.findByRole('tab', { name: 'Tratamientos' }));
  fireEvent.click(within(card).getByRole('button', { name: 'Evolución' }));
  return card;
}

beforeEach(() => {
  tokenStore.set(null);
  useAuthStore.setState({ status: 'authenticated', user: null });
});
afterEach(() => vi.unstubAllGlobals());

describe('Fase 1B.2 — correcciones clínicas append-only', () => {
  it('muestra la version vigente de la nota y conserva la original en el historial', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST') });
    stub(baseRoutes([NOTE_ROOT, NOTE_CORRECTION], []));
    renderPage();

    // La version vigente es la ultima correccion.
    expect(await screen.findByTestId('clinical-current-2')).toHaveTextContent('Texto corregido');
    expect(screen.getByText('Corregida · ver versiones anteriores (1)')).toBeInTheDocument();
    // La evidencia original y su motivo se conservan (no se sobrescriben ni se ocultan).
    expect(screen.getAllByText('Texto original')).toHaveLength(1);
    expect(screen.getByText('Motivo: Aclaración solicitada')).toBeInTheDocument();
    expect(screen.getByText('Original')).toBeInTheDocument();
    expect(screen.getByText('Corrección 1')).toBeInTheDocument();
  });

  it('corrige una nota enviando contenido completo y motivo al endpoint de correcciones', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST') });
    let correctionBody: Record<string, unknown> | null = null;
    let notes: unknown[] = [NOTE_ROOT];
    stub((url, init) => {
      if (url.includes('/clinical/notes/1/corrections') && init?.method === 'POST') {
        correctionBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        notes = [NOTE_ROOT, { ...NOTE_CORRECTION, content: correctionBody.content as string, correctionReason: correctionBody.correctionReason as string }];
        return response(201, notes[1]);
      }
      return baseRoutes(notes, [])(url, init);
    });
    renderPage();

    await screen.findByText('Texto original');
    fireEvent.click(screen.getByRole('button', { name: 'Corregir' }));
    const textarea = screen.getByLabelText('Contenido corregido') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Texto original');

    // El motivo es obligatorio: sin él no se puede enviar.
    fireEvent.change(textarea, { target: { value: 'Texto original corregido' } });
    expect(screen.getByRole('button', { name: 'Guardar corrección' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Motivo de la corrección'), { target: { value: 'Dato incompleto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar corrección' }));

    await waitFor(() => expect(correctionBody).toEqual({ content: 'Texto original corregido', correctionReason: 'Dato incompleto' }));
    expect(await screen.findByTestId('clinical-current-2')).toHaveTextContent('Texto original corregido');
    expect(screen.getByText('Texto original')).toBeInTheDocument();
    expect(screen.getByText('Motivo: Dato incompleto')).toBeInTheDocument();
  });

  it('corrige una entrada de evolucion apuntando a la raiz de la cadena', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('OWNER') });
    let correctionUrl = '';
    let correctionBody: Record<string, unknown> | null = null;
    let evolution: unknown[] = [EVOLUTION_ROOT];
    stub((url, init) => {
      if (url.includes('/evolution/21/corrections') && init?.method === 'POST') {
        correctionUrl = url;
        correctionBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        evolution = [EVOLUTION_ROOT, { ...EVOLUTION_CORRECTION, content: correctionBody.content as string }];
        return response(201, evolution[1]);
      }
      return baseRoutes([], evolution)(url, init);
    });
    renderPage();

    const card = await screen.findByLabelText('Tratamiento Limpieza dental');
    const panel = await openEvolution(card);
    await within(panel).findByText('Valoración inicial');
    fireEvent.click(within(panel).getByRole('button', { name: 'Corregir' }));
    fireEvent.change(within(panel).getByLabelText('Contenido corregido'), { target: { value: 'Valoración corregida' } });
    fireEvent.change(within(panel).getByLabelText('Motivo de la corrección'), { target: { value: 'Error de transcripción' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Guardar corrección' }));

    await waitFor(() => expect(correctionBody).toEqual({ content: 'Valoración corregida', correctionReason: 'Error de transcripción' }));
    expect(correctionUrl).toContain('/api/patients/1/clinical/treatments/5/evolution/21/corrections');
    expect(await within(panel).findByTestId('clinical-current-22')).toHaveTextContent('Valoración corregida');
    expect(within(panel).getByText('Valoración inicial')).toBeInTheDocument();
  });

  it('la trazabilidad de la atencion muestra la cadena con versiones anteriores', async () => {
    useAuthStore.setState({ status: 'authenticated', user: user('DENTIST') });
    const chain = (note: unknown) => ({ recordId: (note as { id: number }).id, originalEntry: NOTE_ROOT, corrections: note === NOTE_ROOT ? [] : [NOTE_CORRECTION], currentEntry: note });
    stub((url) => {
      if (url.includes('/trace')) {
        if (url.includes('section=EVOLUTIONS')) return response(200, {
          context: { appointmentId: 7, occurrenceVersion: 1, currentOccurrenceVersion: 1, currentStatus: 'SCHEDULED', kind: 'FROZEN', timezone: 'America/Mexico_City' },
          availableSections: ['NOTES', 'EVOLUTIONS'], section: 'EVOLUTIONS',
          results: { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 },
        });
        return response(200, {
          context: { appointmentId: 7, occurrenceVersion: 1, currentOccurrenceVersion: 1, currentStatus: 'SCHEDULED', kind: 'FROZEN', timezone: 'America/Mexico_City' },
          availableSections: ['NOTES', 'EVOLUTIONS'], section: 'NOTES',
          results: { content: [chain(NOTE_CORRECTION)], page: 0, size: 20, totalElements: 1, totalPages: 1 },
        });
      }
      return undefined;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AttentionTraceSection patientId={1} selection={{ appointmentId: 7, occurrenceVersion: 1 }} timeZone="America/Mexico_City" />
      </QueryClientProvider>,
    );

    expect((await screen.findAllByText('Texto corregido')).length).toBeGreaterThan(0);
    expect(screen.getByText('Corregida · ver versiones anteriores (1)')).toBeInTheDocument();
    expect(screen.getByText('Texto original')).toBeInTheDocument();
    expect(screen.getByText('Motivo: Aclaración solicitada')).toBeInTheDocument();
  });
});
