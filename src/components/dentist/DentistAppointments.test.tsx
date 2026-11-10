import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../app/authStore';
import { UnsavedChangesProvider } from '../../app/UnsavedChangesProvider';
import { cancelSessionRequests } from '../../api/http';
import { AppointmentDetailPage } from '../appointments/AppointmentDetailPage';
import { DentistCalendar } from './DentistAgenda';
import { appointmentsApi } from '../../api/appointments';
import { notificationKeys } from '../notifications/notificationQueries';
import type { AppointmentResponse } from '../../api/appointments';
import { dentalAttention, dentalCurrent } from '../../test/odontogramFixtures';

const a: AppointmentResponse = { id: 7, patientId: 1, patientFirstName: 'Ana', patientLastName: 'Demo', dentistId: 3, dentistFirstName: 'Olivia', dentistLastName: 'Demo', startAt: '2026-10-21T16:00:00Z', endAt: '2026-10-21T17:00:00Z', durationMinutes: 60, occurrenceVersion: 1, status: 'SCHEDULED', createdByUserId: 2, createdAt: '2026-10-20T12:00:00Z' };
const page = { content: [], page: 0, size: 20, totalPages: 0, totalElements: 0 };
const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
type Handler = (path: string, init: RequestInit | undefined) => Response | Promise<Response> | undefined;
function mount(handler?: Handler, assigned = true, role: 'DENTIST' | 'OWNER' = 'DENTIST', initialEntry = '/appointments/7') {
  useAuthStore.setState({ status: 'authenticated', user: { id: 2, email: 'demo@demo.test', role, dentistId: assigned ? 3 : 4, active: true, createdAt: a.createdAt } });
  const calls: { path: string; method: string }[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  useAuthStore.setState({ queryClient: client });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost'); const path = url.pathname; const method = init?.method ?? 'GET'; calls.push({ path, method });
    const custom = handler?.(path, init); if (custom) return custom;
    if (path === '/api/public/schedule') return res({ timezone: 'America/Mexico_City', dentists: [], days: [], exceptions: [] });
    if (path === '/api/appointments/7') return res(a);
    if (path.endsWith('/complete')) return res({ ...a, status: 'COMPLETED' });
    if (path.endsWith('/clinical')) return res({ patientId: 1, allergies: 'Información sintética' });
    if (path.endsWith('/odontogram')) return res([]);
    if (path.endsWith('/odontogram/at')) return res(dentalAttention());
    if (path.endsWith('/odontogram/history')) return res(page);
    if (path.endsWith('/trace')) return res({ context: { appointmentId: 7, occurrenceVersion: 1, currentOccurrenceVersion: 1, kind: 'CURRENT_UNFROZEN', currentStatus: 'SCHEDULED' }, availableSections: ['NOTES', 'EVOLUTIONS'], section: url.searchParams.get('section'), results: page });
    if (path === '/api/charges') return res(page);
    if (path.endsWith('/treatments') || path.endsWith('/notes') || path.endsWith('/events')) return res([]);
    return res(page);
  });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[initialEntry]}><UnsavedChangesProvider><Routes><Route path="/appointments/:id" element={<AppointmentDetailPage />} /><Route path="/appointments" element={<p>Agenda recuperada</p>} /></Routes></UnsavedChangesProvider></MemoryRouter></QueryClientProvider>);
  return { calls, client };
}
afterEach(() => { cleanup(); cancelSessionRequests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useAuthStore.getState().queryClient.clear(); useAuthStore.setState({ status: 'anonymous', user: null }); });

async function wizardReview() {
  await screen.findByRole('heading', { name: 'Ana Demo' });
  const open = screen.queryByRole('button', { name: 'Abrir consulta' });
  if (open) fireEvent.click(open);
  fireEvent.click(screen.getByRole('button', { name: 'Finalizar atención' }));
  await screen.findByRole('button', { name: 'Confirmar finalización' });
}

describe('UX-05C BUILD 2 · finalización separada', () => {
  it('abre la dentición registrada y edita una pieza directamente, conservando el borrador entre herramientas', async () => {
    const { calls } = mount(path => {
      if (path.endsWith('/odontogram')) return res([dentalCurrent({ patientId: 1, toothFdi: 55, dentition: 'TEMPORARY', treatmentIds: [] })]);
      if (path.endsWith('/odontogram/at')) return res(dentalAttention());
      return undefined;
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Explorar odontograma' }));
    const chart = await screen.findByRole('region', { name: 'Odontograma' });
    await waitFor(() => expect(within(chart).getByRole('button', { name: 'Temporal' })).toHaveAttribute('aria-pressed', 'true'));
    expect(within(chart).getByText('Estado actual · Temporal')).toBeInTheDocument();
    fireEvent.click(within(chart).getAllByRole('button', { name: /Pieza 55 Superior derecho Temporal/ })[0]);
    expect(within(chart).getByText('Superficies de la pieza').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(within(chart).getByText('Superficies de la pieza'));
    expect(within(chart).getByLabelText('Condición de la superficie Oclusal')).toBeVisible();
    fireEvent.click(within(chart).getByText('Superficies de la pieza'));
    fireEvent.change(within(chart).getByLabelText('Observaciones (opcional)'), { target: { value: 'Borrador dental' } });
    fireEvent.click(screen.getByRole('button', { name: 'Volver a consulta' }));
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'Borrador de nota' } });
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar atención' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmar finalización' })).toBeDisabled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Explorar odontograma' }));
    expect(within(chart).getByLabelText('Observaciones (opcional)')).toHaveValue('Borrador dental');
    fireEvent.click(within(chart).getAllByRole('button', { name: /Pieza 54 Superior derecho Temporal/ })[0]);
    expect(await screen.findByRole('dialog', { name: 'Cambios sin guardar en la pieza 55' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir editando' }));
    expect(within(chart).getByLabelText('Observaciones (opcional)')).toHaveValue('Borrador dental');
    expect(calls.some(c => c.method !== 'GET')).toBe(false);
  });
  it('un resumen fallido no afirma que no hay registros ni impone registros obligatorios', async () => {
    mount(path => path.endsWith('/trace') || path.endsWith('/treatments') ? res({ message: 'No disponible' }, 503) : undefined);
    await wizardReview();
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getAllByText('Sin verificar').length).toBeGreaterThan(0));
    expect(within(dialog).getByRole('button', { name: 'Confirmar finalización' })).toBeEnabled();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  });
  it.each(['DENTIST', 'OWNER'] as const)('%s finaliza sin registros opcionales con versión y clave, invalida agenda y solo su buzón', async role => {
    const { client, calls } = mount(undefined, true, role, '/appointments/7?clinical=1&returnTo=%2Fappointments%3Fview%3Dweek%26date%3D2026-10-21%26status%3DSCHEDULED');
    client.setQueryData(notificationKeys.list(2), { content: [] }); client.setQueryData(notificationKeys.list(99), { content: [] });
    const complete = vi.spyOn(appointmentsApi, 'complete').mockResolvedValue({ ...a, status: 'COMPLETED', completedAt: a.endAt });
    await screen.findByRole('heading', { name: 'Ana Demo' });
    if (role === 'DENTIST') {
      expect(screen.getByRole('heading', { name: 'Detalle de cita' })).toBeInTheDocument();
      expect(screen.queryByLabelText('Contenido de la nota')).not.toBeInTheDocument();
    }
    await wizardReview();
    expect(screen.getByRole('heading', { name: 'Finalizar atención' })).toHaveFocus();
    expect(within(screen.getByRole('dialog')).queryByRole('textbox')).not.toBeInTheDocument();
    expect(complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar finalización' }));
    await screen.findByText('Agenda recuperada');
    expect(complete).toHaveBeenCalledWith(7, { expectedOccurrenceVersion: 1 }, expect.any(String));
    expect(client.getQueryState(notificationKeys.list(2))?.isInvalidated).toBe(true);
    expect(client.getQueryState(notificationKeys.list(99))?.isInvalidated).toBe(false);
    expect(calls.some(c => /financial-context|collection|checkout|charges/.test(c.path))).toBe(false);
  });
  it('conserva borradores entre herramientas y diálogo; exige guardado o descarte explícito', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'Borrador que no se guarda al completar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Borradores pendientes · 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar atención' }));
    expect(screen.getByRole('button', { name: 'Confirmar finalización' })).toBeDisabled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ir al borrador de nota' }));
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('Borrador que no se guarda al completar');
    fireEvent.click(screen.getByRole('button', { name: 'Descartar borrador de nota' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar atención' }));
    expect(screen.getByRole('button', { name: 'Confirmar finalización' })).toBeEnabled();
  });
  it('espera un guardado en curso incluso si el usuario avanza a revisión', async () => {
    let resolve!: (r: Response) => void;
    mount((path, init) => path.endsWith('/notes') && init?.method === 'POST' ? new Promise(done => { resolve = done; }) : undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'Guardar explícitamente' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar nota' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));
    await waitFor(() => expect(typeof resolve).toBe('function'));
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar atención' }));
    expect(screen.getByRole('button', { name: 'Confirmar finalización' })).toBeDisabled();
    await act(async () => resolve(res({ id: 1, content: 'Guardar explícitamente' })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar finalización' })).toBeEnabled());
  });
  it('doble clic y resultado incierto recuperan la misma solicitud sin éxito anticipado', async () => {
    mount(); const complete = vi.spyOn(appointmentsApi, 'complete').mockRejectedValueOnce(new TypeError('network')).mockResolvedValue({ ...a, status: 'COMPLETED', completedAt: a.endAt });
    await wizardReview(); const button = screen.getByRole('button', { name: 'Confirmar finalización' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    await screen.findByText(/Resultado incierto/); expect(complete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Agenda recuperada')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar con la misma solicitud' })); await screen.findByText('Agenda recuperada');
    expect(complete.mock.calls[1]).toEqual(complete.mock.calls[0]);
  });
  it('respuesta incompleta no cambia el estado clínico ni navega', async () => {
    const { client } = mount(); vi.spyOn(appointmentsApi, 'complete').mockResolvedValue({ ...a, status: 'COMPLETED' });
    await wizardReview(); fireEvent.click(screen.getByRole('button', { name: 'Confirmar finalización' }));
    await screen.findByText(/Resultado incierto/); expect(client.getQueryData(['appointment', 7])).toMatchObject({ status: 'SCHEDULED' });
  });
});

describe('DC-CLIN-02B · accesos contextuales al inicio', () => {
  it.each(['DENTIST', 'OWNER'] as const)('%s tiene accesos y paneles antes de los editores, con foco de ida y vuelta', async role => {
    const { calls } = mount(undefined, true, role, '/appointments/7?clinical=1');
    if (role === 'DENTIST') fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    const navigation = await screen.findByRole('navigation', { name: 'Consulta contextual' });
    const dental = screen.getByRole('region', { name: 'Área dental' });
    expect(navigation.compareDocumentPosition(dental) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const [access, name] of [
      ['Consultar expediente', 'Expediente del paciente'],
      ['Registros de esta atención', 'Registros guardados de esta atención'],
      ['Borradores pendientes', 'Borradores pendientes'],
      ['Historial del paciente', 'Historial del paciente'],
    ]) {
      const trigger = screen.getByRole('button', { name: access });
      trigger.focus();
      fireEvent.click(trigger);
      const region = await screen.findByRole('region', { name });
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(trigger).toHaveAttribute('aria-controls', region.id);
      expect(navigation.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(region.compareDocumentPosition(dental) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      await waitFor(() => expect(within(region).getByRole('heading', { name })).toHaveFocus());
      fireEvent.click(within(region).getByRole('button', { name: 'Volver a consulta' }));
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(region).not.toBeVisible();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    }
    expect(calls.every(call => call.method === 'GET')).toBe(true);
  });

  it('cambiar de panel conserva las mismas instancias de nota y expediente y sus pendientes', async () => {
    const { calls } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    const note = screen.getByLabelText('Contenido de la nota');
    fireEvent.change(note, { target: { value: 'Nota conservada entre paneles' } });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar expediente' }));
    const allergies = await screen.findByLabelText('Alergias');
    fireEvent.change(allergies, { target: { value: 'Expediente pendiente' } });
    fireEvent.click(screen.getByRole('button', { name: 'Historial del paciente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Registros de esta atención' }));
    fireEvent.click(screen.getByRole('button', { name: 'Borradores pendientes · 2' }));
    expect(note.isConnected).toBe(true);
    expect(allergies.isConnected).toBe(true);
    expect(note).toHaveValue('Nota conservada entre paneles');
    expect(allergies).toHaveValue('Expediente pendiente');
    fireEvent.click(screen.getByRole('button', { name: 'Ir al borrador de expediente' }));
    expect(screen.getByLabelText('Alergias')).toBe(allergies);
    await waitFor(() => expect(screen.getByLabelText('Antecedentes médicos')).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Borradores pendientes · 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ir al borrador de nota' }));
    expect(screen.getByLabelText('Contenido de la nota')).toBe(note);
    await waitFor(() => expect(note).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar atención' }));
    expect(screen.getByRole('button', { name: 'Confirmar finalización' })).toBeDisabled();
    expect(calls.every(call => call.method === 'GET')).toBe(true);
  });
});

describe('UX-05B.1 Etapa 4 · espacio clínico sin checkout', () => {
  it('muestra cabecera operativa y navegación, no despliega formularios ni escribe al abrir', async () => {
    const { calls } = mount();
    expect(await screen.findByRole('heading', { name: 'Ana Demo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Detalle de cita' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Contenido de la nota')).not.toBeInTheDocument();
    expect(calls.some(c => c.method !== 'GET')).toBe(false);
    expect(calls.some(c => c.path.endsWith('/trace'))).toBe(false);
  });
  it.each(['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const)('no ofrece completar una cita %s', async status => {
    mount(path => path === '/api/appointments/7' ? res({ ...a, status }) : undefined);
    await screen.findByRole('heading', { name: 'Ana Demo' });
    expect(screen.queryByRole('button', { name: 'Completar cita' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reprogramar' })).not.toBeInTheDocument();
  });
  it('profesional no asignado no accede al espacio ni solicita datos clínicos', async () => {
    const { calls } = mount(undefined, false); await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Completar cita' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ana Demo' })).not.toBeInTheDocument();
    expect(calls.some(c => c.path.includes('/clinical'))).toBe(false);
    expect(calls.some(c => c.path === '/api/charges')).toBe(false);
  });
  it('nota, odontograma y tratamientos coexisten sin navegación excluyente', async () => {
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    expect(screen.getByRole('heading', { name: 'Nota de la consulta' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'Borrador explícito' } });
    expect(screen.getByRole('region', { name: 'Área dental' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Tratamientos del paciente' })).toBeVisible();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('Borrador explícito');
  });
  it('un doble envío de nota produce un solo POST clínico y anuncia el guardado', async () => {
    let release!: (r: Response) => void;
    const { calls } = mount((path, init) => path.endsWith('/notes') && init?.method === 'POST' ? new Promise(resolve => { release = resolve; }) : undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'Registro explícito' } });
    const confirm = screen.getByRole('button', { name: 'Guardar nota' });
    await waitFor(() => expect(confirm).toBeEnabled());
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    await waitFor(() => expect(calls.filter(c => c.method === 'POST')).toHaveLength(1));
    expect(confirm).toBeDisabled();
    await act(async () => { release(res({ id: 1, content: 'Registro explícito' })); });
    await screen.findByText(/Nota clínica guardada/);
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('');
    expect(calls.filter(c => c.method !== 'GET')).toEqual([{ path: '/api/patients/1/clinical/notes', method: 'POST' }]);
  });
  it('un error de guardado conserva la nota y no completa ni cobra', async () => {
    const { calls } = mount((path, init) => {
      if (path.endsWith('/notes') && init?.method === 'POST') return res({ message: 'No se pudo guardar esta nota.' }, 500);
      return undefined;
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'No perder' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar nota' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nota' }));
    await screen.findByText('No se pudo guardar esta nota.');
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('No perder');
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
    expect(calls.some(c => /checkout|complete|charges/.test(c.path))).toBe(false);
  });
  it('ofrece terminar atención sin efectos financieros al abrir la clínica', async () => {
    const { calls } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    expect(screen.getByRole('heading', { name: 'Nota de la consulta' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Finalizar atención' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Completar|Confirmar y completar|Registrar pago/ })).not.toBeInTheDocument();
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
    expect(calls.some(c => /checkout|complete|charges|financial-context/.test(c.path))).toBe(false);
  });
  it('un fallo de recarga de la cita no desmonta un borrador existente', async () => {
    let fail = false; const { client } = mount(path => path === '/api/appointments/7' && fail ? res({ message: 'Sin conexión' }, 500) : undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'No perder' } }); fail = true;
    await act(async () => { await client.refetchQueries({ queryKey: ['appointment', 7] }); });
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('No perder');
  });
  it.each(['CANCELLED', 'NO_SHOW'] as const)('conserva nota y guard al recibir %s, sin guardar ni cambiar el destino', async status => {
    const { client, calls } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'Borrador clínico recuperable' } });
    act(() => { client.setQueryData(['appointment', 7], { ...a, status }); });
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('Borrador clínico recuperable');
    expect(screen.getByRole('button', { name: 'Guardar nota' })).toBeDisabled();
    expect(within(screen.getByRole('region', { name: 'Nota de la consulta' })).getByLabelText('Guardar como registro general, sin cita')).not.toBeChecked();
    fireEvent.click(screen.getByRole('link', { name: 'Volver a Agenda' }));
    expect(await screen.findByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir aquí' }));
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('Borrador clínico recuperable');
    fireEvent.click(within(screen.getByRole('region', { name: 'Nota de la consulta' })).getByLabelText('Guardar como registro general, sin cita'));
    expect(screen.getByRole('button', { name: 'Guardar nota' })).toBeEnabled();
    expect(calls.some(c => c.method !== 'GET')).toBe(false);
  });
  it('cancelar desde Resumen preserva la nota pendiente de otra pestaña y bloquea solo el destino de cita', async () => {
    let cancelled = false;
    const { calls } = mount((path, init) => {
      if (path.endsWith('/cancel') && init?.method === 'POST') { cancelled = true; return res({ ...a, status: 'CANCELLED' }); }
      if (path === '/api/appointments/7' && cancelled) return res({ ...a, status: 'CANCELLED' });
      return undefined;
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'No perder al cancelar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Datos de la cita' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar cita' }));
    expect(screen.getByText(/Hay cambios clínicos sin guardar. No se guardarán al cancelar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));
    await screen.findByText('Cita cancelada.');
    fireEvent.click(screen.getByRole('button', { name: 'Datos de la cita' }));
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('No perder al cancelar');
    expect(screen.getByRole('button', { name: 'Guardar nota' })).toBeDisabled();
    expect(calls.filter(c => c.method !== 'GET')).toEqual([{ path: '/api/appointments/7/cancel', method: 'POST' }]);
  });
  it('OWNER no asignado reutiliza el espacio con escritura longitudinal sin cierre', async () => {
    mount(undefined, false, 'OWNER', '/appointments/7?clinical=1');
    expect(await screen.findByLabelText('Contenido de la nota')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver al detalle administrativo' })).toHaveAttribute('href', '/appointments/7');
    expect(screen.queryByRole('button', { name: /Completar|Cancelar cita|Reprogramar/ })).not.toBeInTheDocument();
  });
  it.each([403, 404])('respuesta %s no revela datos ni solicita clínica', async status => {
    const { calls } = mount(path => path === '/api/appointments/7' ? res({ message: 'No disponible' }, status) : undefined);
    await screen.findByRole('alert');
    expect(screen.queryByRole('heading', { name: 'Ana Demo' })).not.toBeInTheDocument();
    expect(calls.some(c => c.path.includes('/clinical'))).toBe(false);
  });
  it('403 al actualizar retira la atención aunque exista una respuesta anterior en caché', async () => {
    let denied = false;
    const { client } = mount(path => path === '/api/appointments/7' && denied ? res({ message: 'Acceso revocado' }, 403) : undefined);
    await screen.findByRole('heading', { name: 'Ana Demo' });
    denied = true;
    await act(async () => { await client.refetchQueries({ queryKey: ['appointment', 7] }); });
    expect(await screen.findByText('No tienes acceso a esta atención clínica.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ana Demo' })).not.toBeInTheDocument();
  });
  it('reintenta un error de carga sin escribir ni confundirlo con un vacío', async () => {
    let fail = true;
    const { calls } = mount(path => path === '/api/appointments/7' && fail ? res({ message: 'Fallo temporal' }, 503) : undefined);
    await screen.findByText('Fallo temporal'); fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar cita' }));
    await screen.findByRole('heading', { name: 'Ana Demo' });
    expect(calls.some(c => c.method !== 'GET')).toBe(false);
  });
  it('fallo inicial de zona no bloquea clínica; recuperación conserva el borrador', async () => {
    let failed = true;
    const { client } = mount(path => path === '/api/public/schedule' && failed ? res({ message: 'Sin zona' }, 503) : undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'Conservar sin zona' } });
    expect(screen.getByText(/Los instantes se muestran explícitamente en UTC/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Datos de la cita' }));
    expect(screen.getByRole('button', { name: 'Reprogramar' })).toBeDisabled();
    failed = false;
    await act(async () => { await client.refetchQueries({ queryKey: ['public-schedule'] }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reprogramar' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Datos de la cita' }));
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('Conservar sin zona');
  });
  it('la reprogramación conserva V1 hasta elegir expresamente V2', async () => {
    const { client, calls } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'Borrador V1' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar nota' })).toBeEnabled());
    act(() => { client.setQueryData(['appointment', 7], { ...a, occurrenceVersion: 2 }); });
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('Borrador V1');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar nota' })).toBeDisabled());
    expect(within(screen.getByRole('region', { name: 'Nota de la consulta' })).getByRole('button', { name: 'Vincular a la programación actual' })).toBeInTheDocument();
    expect(calls.some(c => c.method !== 'GET')).toBe(false);
  });
  it('mantiene filtros de agenda en el enlace de retorno y protege el borrador', async () => {
    mount(undefined, true, 'DENTIST', '/appointments/7?returnTo=%2Fappointments%3Fview%3Dweek%26date%3D2026-10-21%26status%3DSCHEDULED');
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    const back = screen.getByRole('link', { name: 'Volver a Agenda' });
    expect(back).toHaveAttribute('href', '/appointments?view=week&date=2026-10-21&status=SCHEDULED');
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'Proteger' } });
    fireEvent.click(back);
    fireEvent.click(await screen.findByRole('button', { name: 'Seguir aquí' }));
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('Proteger');
    fireEvent.click(back);
    fireEvent.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
    await screen.findByText('Agenda recuperada');
  });
  it.each(['https://externo.test', '//externo.test', '/finances/new'])('no acepta retorno fuera de la agenda: %s', async destination => {
    mount(undefined, true, 'DENTIST', `/appointments/7?returnTo=${encodeURIComponent(destination)}`);
    await screen.findByRole('heading', { name: 'Ana Demo' });
    expect(screen.getByRole('link', { name: 'Volver a Agenda' })).toHaveAttribute('href', '/appointments');
  });
  it('expediente compartido bloquea doble guardado y comunica el resultado', async () => {
    let release!: (r: Response) => void;
    const { calls } = mount((path, init) => path.endsWith('/clinical') && init?.method === 'PUT' ? new Promise(resolve => { release = resolve; }) : undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir consulta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Consultar expediente' }));
    fireEvent.change(await screen.findByLabelText('Alergias'), { target: { value: 'Dato confirmado' } });
    const save = screen.getByRole('button', { name: 'Guardar expediente' });
    act(() => { fireEvent.click(save); fireEvent.click(save); });
    await waitFor(() => expect(calls.filter(c => c.method === 'PUT')).toHaveLength(1));
    expect(save).toBeDisabled();
    await act(async () => { release(res({ patientId: 1, allergies: 'Dato confirmado' })); });
    await screen.findByText('Expediente guardado.');
    expect(screen.getByText(/Dato confirmado/, { selector: 'p' })).toBeInTheDocument();
  });
  it('el mes usa las celdas compactas de Recepción y mantiene acceso al día completo', () => {
    const onDay = vi.fn(); const date = new Date('2026-10-21T00:00:00Z');
    const appointments = Array.from({ length: 8 }, (_, i) => ({ ...a, id: i + 1 }));
    render(<DentistCalendar mode="month" days={[date]} appointments={appointments} zone="America/Mexico_City" today="2026-10-21" exceptions={[]} onOpen={vi.fn()} onDay={onDay} />);
    expect(screen.getAllByRole('button', { name: /Cita con Ana Demo/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: /Ver 5 citas más/ })); expect(onDay).toHaveBeenCalledWith(date);
  });
});
