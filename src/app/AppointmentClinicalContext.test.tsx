import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserDto } from '../api/auth';
import { cancelSessionRequests, tokenStore } from '../api/http';
import { AppointmentDetailPage } from '../components/appointments/AppointmentDetailPage';
import { PatientDetailPage } from '../components/patients/PatientDetailPage';
import { useAuthStore } from './authStore';
import { UnsavedChangesProvider } from './UnsavedChangesProvider';

const appointment = {
  id: 7, patientId: 1, patientFirstName: 'Ana', patientLastName: 'Pérez', dentistId: 3,
  dentistFirstName: 'Olivia', dentistLastName: 'Profesional', status: 'SCHEDULED',
  startAt: '2026-10-13T16:00:00Z', endAt: '2026-10-13T17:00:00Z', durationMinutes: 60,
  occurrenceVersion: 1, createdByUserId: 10, createdAt: '2026-10-12T12:00:00Z',
};
const record = { patientId: 1, medicalBackground: 'Hipertensión', allergies: 'Penicilina', clinicalHistory: '', generalObservations: '' };
const treatment = { id: 9, patientId: 1, description: 'Tratamiento explícito', diagnosis: 'Diagnóstico escrito', status: 'IN_PROGRESS', appointmentId: 7, toothFdis: [], createdAt: '2026-10-13T15:00:00Z' };
const note = { id: 1, content: 'Nota previa del paciente', authorDentistId: 3, authorName: 'Olivia Profesional', createdAt: '2026-10-13T00:00:00Z' };
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;
type Handler = (path: string, init: RequestInit | undefined, url: URL) => Response | Promise<Response> | undefined;

function normalizedRecord(init: RequestInit | undefined) {
  const body = JSON.parse(String(init?.body)) as Record<string, string>;
  return { patientId: 1, ...Object.fromEntries(Object.entries(body).map(([key, value]) => [key, value.trim() || null])) };
}

function hasUnsavedChanges() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function traceResponse(url: URL, entries: unknown[] = []) {
  return response({ context: { appointmentId: 7, occurrenceVersion: Number(url.searchParams.get('occurrenceVersion')), currentOccurrenceVersion: 1,
    currentStatus: 'SCHEDULED', kind: entries.length ? 'FROZEN' : 'CURRENT_UNFROZEN', timezone: 'America/Mexico_City', scheduledStartAt: appointment.startAt },
    availableSections: ['NOTES', 'EVOLUTIONS'], section: url.searchParams.get('section'),
    results: { content: entries.map((entry) => ({ recordId: (entry as { id: number }).id, originalEntry: entry, corrections: [], currentEntry: entry })), page: 0, size: 20, totalElements: entries.length, totalPages: entries.length ? 1 : 0 } });
}

async function setup(role: UserDto['role'] = 'DENTIST', handler?: Handler, path = '/appointments/7', dentistId = 3, entries?: string[]) {
  useAuthStore.setState({ status: 'authenticated', user: { id: 10, role, dentistId, ...(role === 'PATIENT' ? { patientId: 1 } : {}), active: true, email: 'actor@dc.test', createdAt: '2026-01-01T00:00:00Z' } });
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  let current = { ...appointment };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname;
    const method = init?.method ?? 'GET';
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) as unknown : undefined });
    const custom = handler?.(path, init, url);
    if (custom) return custom;
    if (path === '/api/public/schedule') return response({ timezone: 'America/Mexico_City', days: [], exceptions: [], dentists: [] });
    if (path === '/api/appointments/7/complete') { current = { ...current, status: 'COMPLETED' }; return response(current); }
    if (path === '/api/appointments/7') return response(current);
    if (path === '/api/appointments/7/events') return response([]);
    if (path === '/api/appointments') return response({ content: [], page: 0, size: 100, totalPages: 0, totalElements: 0 });
    if (path === '/api/charges' || path.endsWith('/medical-intake/declarations')) return response({ content: [], page: 0, size: 10, totalPages: 0, totalElements: 0 });
    if (path === '/api/patients/1') return response({ id: 1, firstName: 'Ana', lastName: 'Pérez', active: true });
    if (path.endsWith('/trace')) return traceResponse(url);
    if (path.endsWith('/clinical/notes')) return response([note]);
    if (path.endsWith('/clinical/treatments')) return response([treatment]);
    if (path.endsWith('/evolution')) return response([]);
    if (path.endsWith('/clinical')) return response(record);
    if (path.endsWith('/odontogram')) return response([]);
    throw new Error(`Sin contrato de prueba: ${method} ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={entries ?? [path]}><UnsavedChangesProvider><Routes>
    <Route path="/" element={<div>Inicio</div>} />
    <Route path="/appointments" element={<div>Agenda recuperada</div>} />
    <Route path="/appointments/:id" element={<AppointmentDetailPage />} />
    <Route path="/patients/:id" element={<PatientDetailPage />} />
  </Routes></UnsavedChangesProvider></MemoryRouter></QueryClientProvider>);
  if (role === 'DENTIST') fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
  return { ...view, client, calls };
}

function panel(name: string) {
  const dentist = useAuthStore.getState().user?.role === 'DENTIST';
  const title = dentist ? ({ 'Historial del paciente': 'Historial del paciente', 'Expediente y antecedentes': 'Consultar expediente', 'Odontograma': 'Explorar odontograma' }[name] ?? name) : name;
  if (dentist && name === 'Esta atención') { const back = screen.queryByRole('button', { name: 'Volver a consulta' }); if (back) fireEvent.click(back); return; }
  if (dentist && name === 'Tratamientos y evolución') { expect(screen.getByRole('region', { name: 'Tratamientos del paciente' })).toBeVisible(); return; }
  fireEvent.click(screen.getByRole('button', { name: title }));
}

beforeEach(() => { tokenStore.set(null); });
afterEach(() => { cleanup(); cancelSessionRequests(); vi.unstubAllGlobals(); vi.restoreAllMocks(); useAuthStore.setState({ user: null, status: 'anonymous' }); });

describe('Fase 1A — atención contextual', () => {
  it.each(['DENTIST', 'OWNER'] as const)('%s consulta y guarda notas antes de completar usando el contrato del paciente', async (role) => {
    let notes = [note];
    const { calls, client } = await setup(role, (path, init, url) => {
      if (path.endsWith('/trace')) return traceResponse(url, url.searchParams.get('section') === 'NOTES' ? notes.slice(1) : []);
      if (path.endsWith('/clinical/notes')) {
        if (init?.method === 'POST') notes = [...notes, { ...note, id: 2, content: JSON.parse(String(init.body)).content as string }];
        return response(init?.method === 'POST' ? notes[1] : notes);
      }
      return undefined;
    });
    expect(await screen.findByText('Penicilina')).toBeInTheDocument();
    panel('Historial del paciente');
    expect(await screen.findByText('Nota previa del paciente')).toBeInTheDocument();
    // Midnight UTC is the previous clinical day: display uses Clinic timezone.
    expect(screen.getByText(/Olivia Profesional · lunes, 12 de octubre de 2026 18:00/)).toBeInTheDocument();
    if (role === 'DENTIST') panel('Esta atención');
    fireEvent.change(screen.getByLabelText(/Nueva nota clínica|Contenido de la nota/), { target: { value: 'Nota durante la atención' } });
    fireEvent.click(screen.getByRole('button', { name: /Añadir nota|Guardar nota/ }));
    if (role === 'DENTIST') fireEvent.click(screen.getByRole('button', { name: 'Registros de esta atención' }));
    expect(await screen.findByText('Nota durante la atención')).toBeInTheDocument();
    expect(calls.filter((item) => item.method === 'POST')).toEqual([{ path: '/api/patients/1/clinical/notes', method: 'POST', body: { content: 'Nota durante la atención', appointmentContext: { appointmentId: 7, occurrenceVersion: 1 } } }]);
    expect(screen.getByText('Programada')).toBeInTheDocument();
    await waitFor(() => expect(client.getQueryData(['clinical-notes', 1])).toEqual(notes));
  });

  it.each(['RECEPTIONIST', 'PATIENT'] as const)('%s no ve ni solicita datos clínicos restringidos', async (role) => {
    const { calls } = await setup(role);
    await screen.findByRole('heading', { name: role === 'PATIENT' ? 'Tu cita dental' : 'Cita #7' });
    expect(screen.queryByRole('region', { name: 'Atención clínica' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Abrir ficha y expediente' })).not.toBeInTheDocument();
    expect(calls.some((item) => item.path.includes('/clinical') || item.path.includes('/odontogram'))).toBe(false);
  });

  it('OWNER no asignado conserva clínica pero no puede completar', async () => {
    await setup('OWNER', undefined, '/appointments/7', 4);
    await screen.findByLabelText('Nueva nota clínica');
    expect(screen.queryByRole('button', { name: 'Completar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tratamientos y evolución' })).toBeInTheDocument();
  });

  it('conserva borradores al cambiar de herramientas sin entrar en un cierre prematuro', async () => {
    await setup();
    await screen.findByLabelText('Contenido de la nota');
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'Borrador sin guardar' } });
    panel('Historial del paciente');
    panel('Esta atención');
    expect(screen.queryByRole('button', { name: 'Completar cita' })).not.toBeInTheDocument();
    expect(screen.getByText('Nota · Cambios sin guardar')).toBeInTheDocument();
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('Borrador sin guardar');
  });

  it('mantiene nota tras error y evita doble envío durante guardado', async () => {
    let release!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    const { calls } = await setup('DENTIST', (path, init) => path.endsWith('/notes') && init?.method === 'POST' ? pending : undefined);
    await screen.findByLabelText('Contenido de la nota');
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'Borrador recuperable' } });
    const save = screen.getByRole('button', { name: 'Guardar nota' });
    act(() => { fireEvent.click(save); fireEvent.click(save); });
    await waitFor(() => expect(calls.filter((item) => item.method === 'POST')).toHaveLength(1));
    await act(async () => { release(response({ message: 'No se guardó. Reintenta.' }, 500)); });
    expect(await screen.findByText('No se guardó. Reintenta.')).toBeInTheDocument();
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('Borrador recuperable');
  });

  it('guarda expediente y actualiza alergias del resumen y caché compartida', async () => {
    const { calls, client } = await setup('OWNER', (path, init) => path.endsWith('/clinical') && init?.method === 'PUT' ? response(normalizedRecord(init)) : undefined);
    await screen.findByText('Penicilina');
    fireEvent.click(screen.getByRole('button', { name: 'Expediente y antecedentes' }));
    fireEvent.change(await screen.findByLabelText('Alergias'), { target: { value: ' Alergia actualizada ' } });
    expect(hasUnsavedChanges()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar expediente' }));
    await screen.findByText('Expediente guardado.');
    expect(screen.getByText('Alergia actualizada', { selector: 'dd' })).toBeInTheDocument();
    expect(client.getQueryData(['clinical-record', 1])).toMatchObject({ allergies: 'Alergia actualizada' });
    expect(screen.getByLabelText('Alergias')).toHaveValue('Alergia actualizada');
    expect(hasUnsavedChanges()).toBe(false);
    expect(calls.some((item) => item.path.includes('/complete'))).toBe(false);
  });

  it.each(['DENTIST', 'OWNER'] as const)('%s finaliza tras guardar el expediente normalizado, pero no con cambios reales pendientes', async role => {
    const { calls, client } = await setup(role, (path, init) => {
      if (path.endsWith('/clinical') && init?.method === 'PUT') return response(normalizedRecord(init));
      if (path.endsWith('/complete')) return response({ ...appointment, status: 'COMPLETED', completedAt: appointment.endAt });
      return undefined;
    }, '/appointments/7?clinical=1');
    fireEvent.click(await screen.findByRole('button', { name: 'Consultar expediente' }));
    fireEvent.change(await screen.findByLabelText('Alergias'), { target: { value: ' Penicilina ' } });
    fireEvent.change(screen.getByLabelText('Antecedentes médicos'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar atención' }));
    expect(screen.getByRole('button', { name: 'Confirmar finalización' })).toBeDisabled();
    expect(calls.some(item => item.path.endsWith('/complete'))).toBe(false);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar expediente' }));
    await screen.findByText('Expediente guardado.');
    expect(screen.getByLabelText('Alergias')).toHaveValue('Penicilina');
    expect(screen.getByLabelText('Antecedentes médicos')).toHaveValue('');
    expect(client.getQueryData(['clinical-record', 1])).toMatchObject({ allergies: 'Penicilina', medicalBackground: null, clinicalHistory: null, generalObservations: null });
    expect(hasUnsavedChanges()).toBe(false);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Borradores pendientes ·/ })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar atención' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar finalización' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar finalización' }));
    await screen.findByText('Agenda recuperada');
    expect(calls.filter(item => item.path.endsWith('/complete'))).toHaveLength(1);
    expect(client.getQueryData(['appointment', 7])).toMatchObject({ status: 'COMPLETED' });
    expect(calls.filter(item => item.method !== 'GET').map(item => item.path)).toEqual(['/api/patients/1/clinical', '/api/appointments/7/complete']);
  });

  it('guardar el expediente normalizado no libera el cierre si queda una nota sin guardar', async () => {
    const { calls } = await setup('DENTIST', (path, init) => path.endsWith('/clinical') && init?.method === 'PUT'
      ? response(normalizedRecord(init)) : undefined);
    fireEvent.change(await screen.findByLabelText('Contenido de la nota'), { target: { value: 'Nota pendiente real' } });
    panel('Expediente y antecedentes');
    fireEvent.change(await screen.findByLabelText('Alergias'), { target: { value: ' Penicilina ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar expediente' }));
    await screen.findByText('Expediente guardado.');
    expect(screen.getByLabelText('Alergias')).toHaveValue('Penicilina');
    await waitFor(() => expect(document.getElementById('clinical-record')).toHaveAttribute('data-clinical-draft', 'clean'));
    expect(hasUnsavedChanges()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar atención' }));
    expect(screen.getByRole('button', { name: 'Confirmar finalización' })).toBeDisabled();
    expect(calls.some(item => item.path.endsWith('/complete'))).toBe(false);
  });

  it('actualiza los cuatro campos de un expediente limpio tras refetch sin crear pendientes ni escrituras', async () => {
    let updated = false;
    const { client, calls } = await setup('DENTIST', path => path.endsWith('/clinical') && updated
      ? response({ ...record, medicalBackground: 'Antecedente confirmado', allergies: 'Látex', clinicalHistory: 'Historia confirmada', generalObservations: null }) : undefined);
    panel('Expediente y antecedentes');
    expect(await screen.findByLabelText('Alergias')).toHaveValue('Penicilina');
    updated = true;
    await act(async () => { await client.refetchQueries({ queryKey: ['clinical-record', 1] }); });
    await waitFor(() => expect(screen.getByLabelText('Alergias')).toHaveValue('Látex'));
    expect(screen.getByLabelText('Antecedentes médicos')).toHaveValue('Antecedente confirmado');
    expect(screen.getByLabelText('Historia clínica')).toHaveValue('Historia confirmada');
    expect(screen.getByLabelText('Observaciones generales')).toHaveValue('');
    expect(hasUnsavedChanges()).toBe(false);
    expect(calls.every(item => item.method === 'GET')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar atención' }));
    expect(screen.getByRole('button', { name: 'Confirmar finalización' })).toBeEnabled();
  });

  it.each(['Hipertensión', 'Cambio externo'])('conserva el borrador y su referencia local ante refetch con antecedentes %s', async medicalBackground => {
    let updated = false;
    const { client } = await setup('DENTIST', path => path.endsWith('/clinical') && updated
      ? response({ ...record, allergies: 'Borrador local', medicalBackground }) : undefined);
    panel('Expediente y antecedentes');
    fireEvent.change(await screen.findByLabelText('Alergias'), { target: { value: 'Borrador local' } });
    updated = true;
    await act(async () => { await client.refetchQueries({ queryKey: ['clinical-record', 1] }); });
    expect(screen.getByLabelText('Alergias')).toHaveValue('Borrador local');
    expect(screen.getByLabelText('Antecedentes médicos')).toHaveValue('Hipertensión');
    expect(hasUnsavedChanges()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar atención' }));
    expect(screen.getByRole('button', { name: 'Confirmar finalización' })).toBeDisabled();
  });

  it('adopta la actualización aplazada al revertir el último cambio local sin guardar automáticamente', async () => {
    let updated = false;
    const { client, calls } = await setup('DENTIST', path => path.endsWith('/clinical') && updated
      ? response({ ...record, allergies: 'Látex', medicalBackground: 'Cambio externo' }) : undefined);
    panel('Expediente y antecedentes');
    fireEvent.change(await screen.findByLabelText('Alergias'), { target: { value: 'Borrador local' } });
    updated = true;
    await act(async () => { await client.refetchQueries({ queryKey: ['clinical-record', 1] }); });
    expect(screen.getByLabelText('Alergias')).toHaveValue('Borrador local');
    fireEvent.change(screen.getByLabelText('Alergias'), { target: { value: 'Penicilina' } });
    expect(screen.getByLabelText('Alergias')).toHaveValue('Látex');
    expect(screen.getByLabelText('Antecedentes médicos')).toHaveValue('Cambio externo');
    expect(hasUnsavedChanges()).toBe(false);
    expect(calls.every(item => item.method === 'GET')).toBe(true);
  });

  it('un guardado fallido conserva el expediente, protege la navegación y bloquea el cierre', async () => {
    const { calls, client } = await setup('DENTIST', (path, init) => path.endsWith('/clinical') && init?.method === 'PUT'
      ? response({ message: 'No se pudo guardar el expediente.' }, 500) : undefined);
    panel('Expediente y antecedentes');
    fireEvent.change(await screen.findByLabelText('Alergias'), { target: { value: ' Borrador recuperable ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar expediente' }));
    await screen.findByText('No se pudo guardar el expediente.');
    expect(screen.getByLabelText('Alergias')).toHaveValue(' Borrador recuperable ');
    expect(client.getQueryData(['clinical-record', 1])).toEqual(record);
    expect(hasUnsavedChanges()).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Expediente completo' }));
    await screen.findByRole('dialog', { name: 'Tienes cambios sin guardar' });
    fireEvent.click(screen.getByRole('button', { name: 'Seguir aquí' }));
    expect(screen.getByLabelText('Alergias')).toHaveValue(' Borrador recuperable ');
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar atención' }));
    expect(screen.getByRole('button', { name: 'Confirmar finalización' })).toBeDisabled();
    expect(calls.filter(item => item.method === 'PUT')).toHaveLength(1);
    expect(calls.some(item => item.path.endsWith('/complete'))).toBe(false);
  });

  it('una lectura iniciada antes de una edición no pisa el nuevo borrador al resolverse', async () => {
    let release!: (value: Response) => void;
    const pending = new Promise<Response>(resolve => { release = resolve; });
    let refreshing = false;
    const { client } = await setup('DENTIST', path => path.endsWith('/clinical') && refreshing ? pending : undefined);
    panel('Expediente y antecedentes');
    await screen.findByLabelText('Alergias');
    refreshing = true;
    let refetch!: Promise<void>;
    act(() => { refetch = client.refetchQueries({ queryKey: ['clinical-record', 1] }); });
    fireEvent.change(screen.getByLabelText('Alergias'), { target: { value: 'Edición posterior a la lectura' } });
    await act(async () => { release(response({ ...record, allergies: 'Respuesta anterior' })); await refetch; });
    expect(screen.getByLabelText('Alergias')).toHaveValue('Edición posterior a la lectura');
    expect(hasUnsavedChanges()).toBe(true);
  });

  it.each(['antes', 'durante'] as const)('una lectura antigua iniciada %s del PUT no reemplaza el guardado confirmado ni su caché', async timing => {
    let release!: (value: Response) => void;
    const pending = new Promise<Response>(resolve => { release = resolve; });
    let releaseSave!: (value: Response) => void;
    const saving = new Promise<Response>(resolve => { releaseSave = resolve; });
    let submitted: RequestInit | undefined;
    let refreshing = false;
    const { client } = await setup('DENTIST', (path, init) => {
      if (!path.endsWith('/clinical')) return undefined;
      if (init?.method === 'PUT') { submitted = init; return saving; }
      return refreshing ? pending : undefined;
    });
    panel('Expediente y antecedentes');
    fireEvent.change(await screen.findByLabelText('Alergias'), { target: { value: ' Guardado nuevo ' } });
    refreshing = true;
    if (timing === 'antes') act(() => { void client.refetchQueries({ queryKey: ['clinical-record', 1] }); });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar expediente' }));
    await waitFor(() => expect(submitted).toBeDefined());
    if (timing === 'durante') act(() => { void client.refetchQueries({ queryKey: ['clinical-record', 1] }); });
    await act(async () => { releaseSave(response(normalizedRecord(submitted))); });
    await screen.findByText('Expediente guardado.');
    await act(async () => { release(response(record)); await pending; });
    expect(screen.getByLabelText('Alergias')).toHaveValue('Guardado nuevo');
    expect(client.getQueryData(['clinical-record', 1])).toMatchObject({ allergies: 'Guardado nuevo' });
    expect(hasUnsavedChanges()).toBe(false);
  });

  it.each(['Edición posterior', ' Primer envío '])('una respuesta de guardado tardía no borra la edición posterior: %s', async later => {
    let release!: (value: Response) => void;
    const pending = new Promise<Response>(resolve => { release = resolve; });
    let submitted: RequestInit | undefined;
    const { client } = await setup('DENTIST', (path, init) => {
      if (path.endsWith('/clinical') && init?.method === 'PUT') { submitted = init; return pending; }
      return undefined;
    });
    panel('Expediente y antecedentes');
    fireEvent.change(await screen.findByLabelText('Alergias'), { target: { value: ' Primer envío ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar expediente' }));
    await waitFor(() => expect(submitted).toBeDefined());
    expect(screen.getByLabelText('Alergias')).toBeDisabled();
    // Simula un cambio ya encolado: la guarda no debe depender solo del disabled del DOM.
    fireEvent.change(screen.getByLabelText('Alergias'), { target: { value: 'Edición posterior' } });
    fireEvent.change(screen.getByLabelText('Alergias'), { target: { value: later } });
    await act(async () => { release(response(normalizedRecord(submitted))); });
    await screen.findByText('Expediente guardado.');
    expect(client.getQueryData(['clinical-record', 1])).toMatchObject({ allergies: 'Primer envío' });
    expect(screen.getByLabelText('Alergias')).toHaveValue(later);
    expect(hasUnsavedChanges()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar atención' }));
    expect(screen.getByRole('button', { name: 'Confirmar finalización' })).toBeDisabled();
  });

  it('crea tratamiento con vínculo explícito opcional a la cita actual y registra evolución', async () => {
    let treatments: unknown[] = [];
    let entries: unknown[] = [];
    const { calls } = await setup('DENTIST', (path, init) => {
      if (path.endsWith('/clinical/treatments')) {
        if (init?.method === 'POST') treatments = [{ ...treatment, ...JSON.parse(String(init.body)) }];
        return response(init?.method === 'POST' ? treatments[0] : treatments);
      }
      if (path.endsWith('/evolution')) {
        if (init?.method === 'POST') entries = [{ id: 1, ...JSON.parse(String(init.body)), authorName: 'Olivia', createdAt: '2026-10-13T15:00:00Z' }];
        return response(init?.method === 'POST' ? entries[0] : entries);
      }
      return undefined;
    });
    panel('Tratamientos y evolución');
    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo tratamiento' }));
    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'Tratamiento explícito' } });
    expect(screen.queryByLabelText('Cita vinculada (opcional)')).not.toBeInTheDocument();
    expect(screen.getByText(/Se vinculará a esta cita/)).toBeInTheDocument();
    panel('Esta atención');
    panel('Tratamientos y evolución');
    expect(screen.getByLabelText('Descripción')).toHaveValue('Tratamiento explícito');
    fireEvent.click(screen.getByRole('button', { name: 'Crear tratamiento' }));
    const card = await screen.findByRole('article', { name: 'Tratamiento Tratamiento explícito' });
    fireEvent.click(within(card).getByRole('button', { name: 'Ver detalle y evolución' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Evolución' }));
    fireEvent.change(screen.getByLabelText('Nueva nota de evolución'), { target: { value: 'Progreso registrado' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Evolución' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Evolución' }));
    expect(screen.getByLabelText('Nueva nota de evolución')).toHaveValue('Progreso registrado');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar evolución' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Guardar evolución' }));
    await screen.findByText('Progreso registrado');
    expect(calls.filter((item) => item.method === 'POST')).toEqual([
      { path: '/api/patients/1/clinical/treatments', method: 'POST', body: { description: 'Tratamiento explícito', diagnosis: null, status: 'PLANNED', notes: null, price: null, appointmentId: 7 } },
      { path: '/api/patients/1/clinical/treatments/9/evolution', method: 'POST', body: { content: 'Progreso registrado', appointmentContext: { appointmentId: 7, occurrenceVersion: 1 } } },
    ]);
  });

  it('conserva el borrador de antecedentes tras un error de actualización en segundo plano', async () => {
    let fail = false;
    const { client } = await setup('DENTIST', (path) => path.endsWith('/clinical') && fail ? response({ message: 'Error temporal' }, 500) : undefined);
    await screen.findByText('Penicilina');
    panel('Expediente y antecedentes');
    fireEvent.change(await screen.findByLabelText('Alergias'), { target: { value: 'Borrador protegido' } });
    fail = true;
    await act(async () => { await client.refetchQueries({ queryKey: ['clinical-record', 1] }); });
    expect(await screen.findByText('No se pudo cargar el expediente.')).toBeInTheDocument();
    expect(screen.getByLabelText('Alergias')).toHaveValue('Borrador protegido');
  });

  it('accede al odontograma existente desde la atención', async () => {
    const { calls } = await setup();
    panel('Odontograma');
    expect(await screen.findByRole('region', { name: 'Odontograma' })).toBeInTheDocument();
    await waitFor(() => expect(calls.some((item) => item.path === '/api/patients/1/odontogram')).toBe(true));
  });

  it('un fallo clínico conserva el borrador sin habilitar cierre ni crear recursos', async () => {
    const { calls, client } = await setup('DENTIST', (path) => path.includes('/clinical') ? response({ message: 'Clínica no disponible' }, 500) : undefined);
    client.setQueryData(['appointments', 'agenda'], [appointment]);
    client.setQueryData(['availability', 'agenda'], { slots: [] });
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'No guardar al cerrar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registros de esta atención' }));
    await screen.findByText(/No se pudieron cargar todos los registros de esta atención/);
    expect(screen.queryByRole('button', { name: 'Confirmar y completar cita' })).not.toBeInTheDocument();
    expect(client.getQueryData(['appointment', 7])).toMatchObject({ status: 'SCHEDULED' });
    expect(client.getQueryState(['appointments', 'agenda'])?.isInvalidated).toBe(false);
    expect(client.getQueryState(['availability', 'agenda'])?.isInvalidated).toBe(false);
    expect(calls.filter((item) => item.method === 'POST')).toEqual([]);
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('No guardar al cerrar');
  });

  it('la atención distingue notas longitudinales de registros vinculados sin revisión final', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Registros de esta atención' }));
    expect(await screen.findByText('Notas vinculadas a esta atención: 0.')).toBeInTheDocument();
    expect(screen.getByText(/Solo registros guardados/)).toBeInTheDocument();
    expect(screen.queryByText('Nota previa del paciente')).not.toBeInTheDocument();
  });

  it('navega cita → expediente → misma cita con contexto validado', async () => {
    await setup('DENTIST', (path) => path.endsWith('/clinical/treatments') ? response([]) : undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar expediente' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Expediente completo' }));
    expect(await screen.findByRole('heading', { name: 'Pérez, Ana' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('link', { name: 'Volver a la atención' }));
    expect(await screen.findByRole('heading', { name: 'Ana Pérez' })).toBeInTheDocument();
  });

  it('protege el borrador de nota al abandonar la atención y conserva la página si se sigue aquí', async () => {
    await setup();
    fireEvent.change(await screen.findByLabelText('Contenido de la nota'), { target: { value: 'No perder este borrador' } });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar expediente' }));
    fireEvent.click(screen.getByRole('link', { name: 'Expediente completo' }));
    expect(await screen.findByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir aquí' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('No perder este borrador');
    fireEvent.click(screen.getByRole('link', { name: 'Expediente completo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salir sin guardar' }));
    expect(await screen.findByRole('heading', { name: 'Pérez, Ana' })).toBeInTheDocument();
  });

  it('volver al detalle conserva el borrador sin salir del espacio clínico', async () => {
    await setup('DENTIST', undefined, '/appointments/7', 3, ['/', '/appointments/7']);
    fireEvent.change(await screen.findByLabelText('Contenido de la nota'), { target: { value: 'No perder al volver' } });
    fireEvent.click(screen.getByRole('button', { name: 'Datos de la cita' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Datos de la cita' }));
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('No perder al volver');
  });

  it('no ofrece retorno a una cita de otro paciente', async () => {
    await setup('OWNER', (path) => path === '/api/appointments/7' ? response({ ...appointment, patientId: 2 }) : undefined, '/patients/1?appointmentId=7');
    await screen.findByRole('heading', { name: 'Ana Pérez' });
    expect(screen.queryByRole('link', { name: 'Volver a la atención' })).not.toBeInTheDocument();
  });

  it('separa atención e historial, y guarda generales solo por elección explícita', async () => {
    const { calls } = await setup();
    await screen.findByLabelText('Contenido de la nota');
    expect(screen.queryByText('Nota previa del paciente')).not.toBeInTheDocument();
    panel('Historial del paciente');
    await screen.findByText('Nota previa del paciente');
    expect(screen.getByText('Registro general · Sin cita asociada')).toBeInTheDocument();
    // La sección redundante "Notas generales sin cita" se eliminó: las generales ya viven aquí.
    expect(screen.queryByRole('button', { name: 'Notas generales sin cita' })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Nota previa del paciente/)).toHaveLength(1);
    panel('Esta atención');
    fireEvent.click(within(screen.getByRole('region', { name: 'Nota de la consulta' })).getByLabelText('Guardar como registro general, sin cita'));
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'General explícita' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));
    await waitFor(() => expect(calls.filter((item) => item.method === 'POST')[0]?.body).toEqual({ content: 'General explícita', appointmentContext: null }));
  });

  it('409 conserva el borrador y V1; el refetch V2 no reasigna sin confirmación', async () => {
    let version = 1;
    const { calls } = await setup('DENTIST', (path, init, url) => {
      if (path === '/api/appointments/7') return response({ ...appointment, occurrenceVersion: version });
      if (path.endsWith('/trace')) return response({ context: { appointmentId: 7, occurrenceVersion: Number(url.searchParams.get('occurrenceVersion')), currentOccurrenceVersion: version, currentStatus: 'SCHEDULED', kind: 'CURRENT_UNFROZEN' }, availableSections: ['NOTES', 'EVOLUTIONS'], section: url.searchParams.get('section'), results: { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 } });
      if (path.endsWith('/notes') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (body.appointmentContext?.occurrenceVersion === 1) { version = 2; return response({ message: 'La cita fue reprogramada. Revisa el destino.' }, 409); }
        return response({ ...note, ...body });
      }
      return undefined;
    });
    fireEvent.change(await screen.findByLabelText('Contenido de la nota'), { target: { value: 'Borrador V1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));
    await screen.findByText('La cita fue reprogramada. Revisa el destino.');
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('Borrador V1');
    const noteRegion = within(screen.getByRole('region', { name: 'Nota de la consulta' }));
    await noteRegion.findByRole('button', { name: 'Vincular a la programación actual' });
    expect(noteRegion.getByText(/Se guardará en: esta cita/)).toBeInTheDocument();
    expect(calls.filter((item) => item.method === 'POST')).toHaveLength(1);
    fireEvent.click(noteRegion.getByRole('button', { name: 'Vincular a la programación actual' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar nota' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));
    await screen.findByText(/Nota clínica guardada. Consulta su vínculo/);
    expect(calls.filter((item) => item.method === 'POST')[1]?.body).toEqual({ content: 'Borrador V1', appointmentContext: { appointmentId: 7, occurrenceVersion: 2 } });
  });

  it('respuesta perdida no se reintenta ni permite repetir hasta consultar y confirmar', async () => {
    const { calls } = await setup('DENTIST', (path, init) => {
      if (path.endsWith('/notes') && init?.method === 'POST') return Promise.reject(new TypeError('Respuesta perdida'));
      return undefined;
    });
    fireEvent.change(await screen.findByLabelText('Contenido de la nota'), { target: { value: 'Resultado desconocido' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));
    await screen.findByText(/No sabemos si el envío llegó a guardarse/);
    expect(screen.getByRole('button', { name: 'Guardar nota' })).toBeDisabled();
    expect(calls.filter((item) => item.method === 'POST')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar registros antes de repetir' }));
    await screen.findByText('Nota previa del paciente');
    fireEvent.click(await screen.findByRole('button', { name: 'He revisado los registros; permitir otro envío' }));
    expect(screen.getByRole('button', { name: 'Guardar nota' })).toBeEnabled();
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('Resultado desconocido');
    expect(calls.filter((item) => item.method === 'POST')).toHaveLength(1);
  });

  it('consultar V1 histórica no fabrica contexto ni altera el destino actual del formulario', async () => {
    const { calls } = await setup('DENTIST', (path, _init, url) => {
      if (path === '/api/appointments/7') return response({ ...appointment, occurrenceVersion: 2 });
      if (path.endsWith('/trace')) return traceResponse(url);
      return undefined;
    }, '/appointments/7?occurrenceVersion=1');
    await screen.findByLabelText('Contenido de la nota');
    expect(screen.getAllByText(/Se guardará en esta atención/).length).toBeGreaterThan(0);
    panel('Historial del paciente');
    expect(screen.getByLabelText('Programación de esta cita')).toHaveValue('1');
    expect(calls.some(c => c.path.endsWith('/trace'))).toBe(true);
    expect(calls.filter((item) => item.method === 'POST')).toHaveLength(0);
  });

  it('retorno desde ficha conserva la ocurrencia seleccionada sin contextualizar sus notas generales', async () => {
    await setup('OWNER', (path) => path === '/api/appointments/7' ? response({ ...appointment, occurrenceVersion: 2 }) : undefined,
      '/patients/1?appointmentId=7&occurrenceVersion=1');
    const back = await screen.findByRole('link', { name: 'Volver a la atención' });
    expect(back).toHaveAttribute('href', '/appointments/7?occurrenceVersion=1');
    fireEvent.click(screen.getByRole('tab', { name: 'Notas clínicas' }));
    const notes = screen.getByRole('heading', { name: 'Notas clínicas' }).closest('div')!;
    expect(within(notes).getByText('Destino: registro general del paciente, sin cita.')).toBeInTheDocument();
  });

  it('evolución bloquea doble envío, conserva texto/contexto ante 409 y permite escoger general explícitamente', async () => {
    let release!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    let submitted = 0;
    const { calls } = await setup('DENTIST', (path, init) => {
      if (path.endsWith('/clinical/treatments')) return response([{ ...treatment, appointmentId: 99 }]);
      if (path.endsWith('/evolution') && init?.method === 'POST') {
        submitted++;
        return submitted === 1 ? pending : response({ id: 1, ...JSON.parse(String(init.body)), authorName: 'Olivia', createdAt: note.createdAt });
      }
      return undefined;
    });
    panel('Tratamientos y evolución');
    const card = await screen.findByRole('article', { name: 'Tratamiento Tratamiento explícito' });
    fireEvent.click(within(card).getByRole('button', { name: 'Ver detalle y evolución' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Evolución' }));
    fireEvent.change(screen.getByLabelText('Nueva nota de evolución'), { target: { value: 'Evolución recuperable' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar evolución' })).toBeEnabled());
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Guardar evolución' })); fireEvent.click(screen.getByRole('button', { name: 'Guardar evolución' })); });
    await waitFor(() => expect(submitted).toBe(1));
    await act(async () => { release(response({ message: 'Conflicto de ocurrencia' }, 409)); });
    await screen.findByText('Conflicto de ocurrencia');
    expect(screen.getByLabelText('Nueva nota de evolución')).toHaveValue('Evolución recuperable');
    expect(calls.filter((item) => item.method === 'POST')[0]?.body).toEqual({ content: 'Evolución recuperable', appointmentContext: { appointmentId: 7, occurrenceVersion: 1 } });
    fireEvent.click(within(card).getByLabelText('Guardar como registro general, sin cita'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar evolución' }));
    await waitFor(() => expect(submitted).toBe(2));
    expect(calls.filter((item) => item.method === 'POST')[1]?.body).toEqual({ content: 'Evolución recuperable', appointmentContext: null });
  });
});
