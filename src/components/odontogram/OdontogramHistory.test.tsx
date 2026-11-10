import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import type { ClinicalDestination } from '../../api/clinicalTrace';
import { dentalAttention, dentalCurrent, dentalEvent, dentalHistorical, dentalInstant } from '../../test/odontogramFixtures';
import type { ToothRecordDto, ToothSurfaceDto } from '../../api/odontogram';
import { OdontogramSection } from './OdontogramSection';
import { ReadOnlyOdontogram } from './ReadOnlyOdontogram';
import { ToothHistoryTimeline } from './ToothHistoryTimeline';

const offered: ClinicalDestination = { appointmentId: 7, occurrenceVersion: 1, startAt: '2026-10-13T10:00:00Z', timeZone: 'UTC' };
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;
type Handler = (url: URL, init?: RequestInit) => Response | undefined;

function setup(handler?: Handler, appointment?: ClinicalDestination, patientId = 42) {
  const calls: Array<{ url: URL; method: string; body: Record<string, unknown> | null }> = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://test');
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null });
    const custom = handler?.(url, init);
    if (custom) return custom;
    if (url.pathname.endsWith('/odontogram/at')) {
      if (url.searchParams.has('at')) return response(dentalInstant(url.searchParams.get('at')!));
      const data = dentalAttention();
      data.reference.occurrence.occurrenceVersion = Number(url.searchParams.get('occurrenceVersion'));
      data.reference.occurrence.currentOccurrenceVersion = data.reference.occurrence.occurrenceVersion;
      return response(data);
    }
    if (url.pathname.endsWith('/odontogram/history')) return response({ content: [dentalEvent()], page: 0, size: 20, totalElements: 1, totalPages: 1 });
    if (url.pathname.endsWith('/odontogram/reception-summary')) return response([{ toothFdi: 21, condition: 'CARIES', dentition: 'PERMANENT', surfaces: [] }]);
    if (url.pathname.endsWith('/odontogram')) return response([dentalCurrent({ patientId })]);
    if (url.pathname.endsWith('/clinical/treatments')) return response([]);
    if (url.pathname.endsWith('/surfaces')) return response([]);
    return response({ message: 'Contrato de prueba no previsto' }, 404);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = (nextAppointment = appointment, nextPatient = patientId) => <QueryClientProvider client={client}><MemoryRouter>
    <OdontogramSection patientId={nextPatient} editable appointment={nextAppointment} initialHistorySelection={nextAppointment} />
  </MemoryRouter></QueryClientProvider>;
  const result = render(tree());
  return { ...result, calls, client, update: (nextAppointment?: ClinicalDestination, nextPatient = patientId) => result.rerender(tree(nextAppointment, nextPatient)) };
}
beforeEach(() => {
  tokenStore.set(null);
  useAuthStore.setState({ status: 'authenticated', user: { id: 10, role: 'DENTIST', dentistId: 3, email: 'synthetic@dc.test', active: true, createdAt: '2026-01-01T00:00:00Z' } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useAuthStore.setState({ status: 'anonymous', user: null }); });

describe('Odontograma histórico E3', () => {
  it('renderiza los tres tipos de eventos, contexto válido y ausencia de asociación sin inventar una cita', () => {
    render(<MemoryRouter><ToothHistoryTimeline entries={[
      dentalEvent({ source: 'CONDITION_TOOTH', kind: 'CONDITION', previousCondition: null, newCondition: 'CARIES' }),
      dentalEvent({ id: 302, occurrence: null, newNotes: null }),
      dentalEvent({ id: 303, kind: 'TREATMENT_LINK', source: 'TREATMENT_LINK', treatmentId: 9, changeKind: 'REMOVE' }),
    ]} /></MemoryRouter>);
    expect(screen.getByText('Sin registro previo')).toBeInTheDocument();
    expect(screen.getByText('Sin asociación registrada')).toBeInTheDocument();
    expect(screen.getByText('Observaciones eliminadas (valor vacío conocido).')).toBeInTheDocument();
    expect(screen.getByText('Tratamiento desvinculado')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Cita #7 · ocurrencia 1' })[0]).toHaveAttribute('href', '/appointments/7?occurrenceVersion=1');
    expect(screen.getAllByText(/\.123456/).length).toBeGreaterThan(0);
  });

  it('no usa datos actuales para completar UNKNOWN/PARTIAL y ofrece lista accesible', async () => {
    const data = dentalAttention();
    render(<MemoryRouter><ReadOnlyOdontogram patientId={42} snapshot={data.stateAtCapture!} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Pieza 21.*condición Caries/ }));
    expect(screen.getByText('Parcial: el conjunto completo no es reconstruible.')).toBeInTheDocument();
    expect(screen.getByText('Vínculos conocidos: #9.')).toBeInTheDocument();
    expect(screen.getByText('Desvinculaciones conocidas: #10.')).toBeInTheDocument();
    expect(screen.queryByText('Estado actual de prueba')).not.toBeInTheDocument();
    expect(screen.queryByText(/Sin vínculos \(conjunto vacío conocido\)/)).not.toBeInTheDocument();
    expect(screen.queryByText('Sin registro previo')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lista' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByText('No reconstruible').length).toBeGreaterThan(0);
  });

  it('distingue valor vacío conocido y ausencia demostrada del registro', () => {
    const tooth = dentalHistorical({ registration: 'NOT_REGISTERED', condition: { knowledge: 'UNKNOWN', value: null, knownFrom: null },
      notes: { knowledge: 'KNOWN', value: null, knownFrom: '2026-10-13T10:00:00Z' },
      treatments: { knowledge: 'KNOWN', treatmentIds: [], knownLinkedIds: [], knownUnlinkedIds: [] } });
    render(<MemoryRouter><ReadOnlyOdontogram patientId={42} snapshot={{ at: '2026-10-13T11:05:00Z', teeth: [tooth], completeness: { status: 'PARTIAL', reasons: [] } }} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Pieza 21.*Sin registro previo/ }));
    expect(screen.getByText(/Sin registro previo: no constaba/)).toBeInTheDocument();
    expect(screen.getByText('Sin observaciones registradas (valor vacío conocido).')).toBeInTheDocument();
    expect(screen.getByText('Sin vínculos (conjunto vacío conocido).')).toBeInTheDocument();
  });

  it('consulta un instante UTC explícito usando el contrato real y conserva la referencia devuelta', async () => {
    const { calls } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Consulta histórica' }));
    fireEvent.change(screen.getByLabelText('Fecha y hora (UTC)'), { target: { value: '2026-10-13T11:05:00.123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar estado histórico' }));
    await screen.findByRole('region', { name: 'Estado histórico por instante' });
    expect(calls.find((call) => call.url.searchParams.has('at'))?.url.searchParams.get('at')).toBe('2026-10-13T11:05:00.123Z');
    fireEvent.change(screen.getByLabelText('Fecha y hora (UTC)'), { target: { value: '2026-10-14T12:00' } });
    expect(screen.getByRole('heading', { name: /Estado reconstruido.*\.123/ })).toBeInTheDocument();
    expect(calls.filter((call) => call.url.searchParams.has('at'))).toHaveLength(1);
  });

  it('separa captura, eventos asociados y estado actual sin rotular la captura como cierre', async () => {
    setup(undefined, offered);
    const capture = await screen.findByRole('region', { name: 'Estado en la captura' });
    const events = screen.getByRole('region', { name: 'Cambios atribuidos a la atención' });
    const current = screen.getByRole('region', { name: 'Estado actual del paciente' });
    expect(within(capture).getByRole('button', { name: /Pieza 21.*Caries/ })).toBeInTheDocument();
    expect(within(current).getByRole('button', { name: /Pieza 21.*Restauración/ })).toBeInTheDocument();
    expect(within(events).getByText('Observación asociada de prueba')).toBeInTheDocument();
    expect(within(capture).getByText(/No representa el final de la cita/)).toBeInTheDocument();
  });

  it('consulta cita/ocurrencia seleccionadas y pagina solo los eventos atribuidos', async () => {
    const view = setup((url) => {
      if (!url.pathname.endsWith('/at') || !url.searchParams.has('appointmentId')) return undefined;
      const data = dentalAttention();
      data.reference.occurrence.occurrenceVersion = Number(url.searchParams.get('occurrenceVersion'));
      data.reference.occurrence.currentOccurrenceVersion = 2;
      const page = Number(url.searchParams.get('page'));
      data.attributedEvents = { ...data.attributedEvents, page, totalElements: 21, totalPages: 2,
        content: [dentalEvent({ id: page === 0 ? 301 : 302, newNotes: page === 0 ? 'Página reciente' : 'Página anterior' })] };
      return response(data);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Consulta histórica' }));
    fireEvent.change(screen.getByLabelText('Consultar por'), { target: { value: 'attention' } });
    fireEvent.change(screen.getByLabelText('Número de cita'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Ocurrencia dental a consultar'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar estado histórico' }));
    await screen.findByText('Página reciente');
    fireEvent.click(screen.getByRole('button', { name: 'Eventos anteriores' }));
    await screen.findByText('Página anterior');
    const request = view.calls.find((call) => call.url.searchParams.get('page') === '1');
    expect(Object.fromEntries(request!.url.searchParams)).toEqual({ appointmentId: '7', occurrenceVersion: '2', page: '1', size: '20' });
    expect(screen.getByRole('region', { name: 'Estado en la captura' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Estado actual del paciente' })).toBeInTheDocument();
  });

  it('las cuatro operaciones de pieza y superficie envían el contexto elegido', async () => {
    let current: ToothRecordDto | null = null;
    let surface: ToothSurfaceDto | null = null;
    const view = setup((url, init) => {
      const method = init?.method ?? 'GET';
      if (url.pathname.endsWith('/at')) return undefined;
      if (method === 'POST' || method === 'PUT') {
        const input = JSON.parse(String(init?.body)) as { condition: ToothRecordDto['condition']; notes: string };
        if (url.pathname.includes('/surfaces')) {
          surface = { id: 602, toothRecordId: 501, surface: 'MESIAL', condition: input.condition, notes: input.notes,
            history: [], createdAt: '2026-10-13T11:05:00Z' };
          return response(surface, method === 'POST' ? 201 : 200);
        }
        current = dentalCurrent({ condition: input.condition, notes: input.notes, treatmentIds: [], surfaces: surface ? [surface] : [] });
        return response(current, method === 'POST' ? 201 : 200);
      }
      if (url.pathname.endsWith('/odontogram')) return response(current ? [current] : []);
      return undefined;
    }, offered);
    fireEvent.click(screen.getByRole('button', { name: 'Estado actual' }));
    fireEvent.click(await screen.findByRole('button', { name: /Pieza 21.*sin registro/ }));
    fireEvent.change(screen.getByLabelText('Condición de la pieza'), { target: { value: 'CARIES' } });
    fireEvent.change(screen.getByLabelText('Observaciones (opcional)'), { target: { value: 'Pieza inicial' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar pieza' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Guardar pieza' }));
    await screen.findByRole('button', { name: 'Guardar pieza' });
    fireEvent.change(screen.getByLabelText('Observaciones (opcional)'), { target: { value: 'Pieza actualizada' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar pieza' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Guardar pieza' }));
    await waitFor(() => expect(view.calls.filter((call) => call.method === 'PUT')).toHaveLength(1));
    fireEvent.click(screen.getByText('Superficies de la pieza'));
    fireEvent.change(screen.getByLabelText('Superficie a editar'), { target: { value: 'MESIAL' } });
    fireEvent.change(screen.getByLabelText('Condición de la superficie Mesial'), { target: { value: 'CARIES' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar superficie mesial' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Guardar superficie mesial' }));
    await waitFor(() => expect(view.calls.filter(call => call.method === 'POST')).toHaveLength(2));
    fireEvent.change(screen.getByLabelText('Observaciones de Mesial'), { target: { value: 'Superficie actualizada' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar superficie mesial' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Guardar superficie mesial' }));
    await waitFor(() => expect(view.calls.filter((call) => call.method !== 'GET')).toHaveLength(4));
    expect(view.calls.filter((call) => call.method !== 'GET').map((call) => call.body?.appointmentContext))
      .toEqual(Array.from({ length: 4 }, () => ({ appointmentId: 7, occurrenceVersion: 1 })));
  });

  it('visita el historial y vuelve al editor sin perder su borrador local', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /Pieza 21.*Restauración/ }));
    fireEvent.change(screen.getByLabelText('Observaciones (opcional)'), { target: { value: 'Borrador no almacenado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Consulta histórica' }));
    fireEvent.click(screen.getByRole('button', { name: 'Estado actual' }));
    expect(screen.getByLabelText('Observaciones (opcional)')).toHaveValue('Borrador no almacenado');
  });

  it.each(['CURRENT_UNFROZEN', 'HISTORICAL_UNKNOWN'] as const)('%s no recibe una foto inventada ni sustituye captura por estado actual', async (kind) => {
    setup((url) => {
      if (!url.pathname.endsWith('/at')) return undefined;
      const data = dentalAttention(); data.reference.occurrence.kind = kind; data.stateAtCapture = null; data.reconstructionAvailable = false;
      return response(data);
    }, offered);
    const capture = await screen.findByRole('region', { name: 'Estado en la captura' });
    expect(within(capture).getByText(/No reconstruible:/)).toBeInTheDocument();
    expect(within(capture).queryByRole('button', { name: /Pieza 21/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Estado actual del paciente' })).getByRole('button', { name: /Pieza 21/ })).toBeInTheDocument();
  });

  it('409 mantiene borrador y destino antiguo hasta una elección explícita de la ocurrencia actual', async () => {
    let currentVersion = 1;
    const writes: Record<string, unknown>[] = [];
    const view = setup((url, init) => {
      if (url.pathname.endsWith('/at')) {
        const data = dentalAttention(); data.reference.occurrence.currentOccurrenceVersion = currentVersion;
        data.reference.occurrence.occurrenceVersion = Number(url.searchParams.get('occurrenceVersion'));
        return response(data);
      }
      if (init?.method === 'PUT') {
        const input = JSON.parse(String(init.body)) as Record<string, unknown>; writes.push(input);
        if (writes.length === 1) { currentVersion = 2; return response({ message: 'La cita fue reprogramada.' }, 409); }
        return response(dentalCurrent({ notes: String(input.notes) }));
      }
      return undefined;
    }, offered);
    fireEvent.click(screen.getByRole('button', { name: 'Estado actual' }));
    fireEvent.click(await screen.findByRole('button', { name: /Pieza 21.*Restauración/ }));
    fireEvent.change(screen.getByLabelText('Observaciones (opcional)'), { target: { value: 'Borrador retenido' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar pieza' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Guardar pieza' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(screen.getByLabelText('Observaciones (opcional)')).toHaveValue('Borrador retenido');
    await act(async () => view.update({ ...offered, occurrenceVersion: 2 }));
    expect(await screen.findByRole('button', { name: 'Usar la ocurrencia actual #2' })).toBeInTheDocument();
    expect(screen.getByLabelText('Observaciones (opcional)')).toHaveValue('Borrador retenido');
    expect(writes[0].appointmentContext).toEqual({ appointmentId: 7, occurrenceVersion: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Usar la ocurrencia actual #2' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar pieza' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Guardar pieza' }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toMatchObject({ notes: 'Borrador retenido', appointmentContext: { appointmentId: 7, occurrenceVersion: 2 } });
  });

  it('puede guardar explícitamente sin cita incluso si el backend no ofrece history/at', async () => {
    const view = setup((url, init) => {
      if (url.pathname.endsWith('/at')) return response({ message: 'E2 no desplegada' }, 404);
      if (init?.method === 'PUT') return response(dentalCurrent({ notes: 'General explícita' }));
      return undefined;
    }, offered);
    fireEvent.click(screen.getByRole('button', { name: 'Estado actual' }));
    fireEvent.click(await screen.findByRole('button', { name: /Pieza 21/ }));
    fireEvent.change(screen.getByLabelText('Observaciones (opcional)'), { target: { value: 'General explícita' } });
    await screen.findByText(/No se pudo comprobar el contexto dental E2/);
    expect(screen.getByRole('button', { name: 'Guardar pieza' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Guardar como registro general, sin cita'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar pieza' }));
    await waitFor(() => expect(view.calls.some((call) => call.method === 'PUT')).toBe(true));
    expect(view.calls.find((call) => call.method === 'PUT')?.body).toMatchObject({ notes: 'General explícita', appointmentContext: null });
  });

  it('un alta en conflicto no borra el borrador cuando el refetch encuentra una pieza existente', async () => {
    let conflict = false;
    setup((url, init) => {
      if (init?.method === 'POST') { conflict = true; return response({ message: 'La pieza ya existe.' }, 409); }
      if (url.pathname.endsWith('/odontogram')) return response(conflict ? [dentalCurrent()] : []);
      return undefined;
    });
    fireEvent.click(await screen.findByRole('button', { name: /Pieza 21.*sin registro/ }));
    fireEvent.change(screen.getByLabelText('Condición de la pieza'), { target: { value: 'CARIES' } });
    fireEvent.change(screen.getByLabelText('Observaciones (opcional)'), { target: { value: 'Borrador de alta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar pieza' }));
    await screen.findByRole('button', { name: 'Guardar pieza' });
    expect(screen.getByLabelText('Observaciones (opcional)')).toHaveValue('Borrador de alta');
    expect(screen.getByLabelText('Condición de la pieza')).toHaveValue('CARIES');
  });

  it('PATIENT conserva su resumen propio y RECEPTIONIST solo pide la ruta reducida', async () => {
    const user = useAuthStore.getState().user!;
    useAuthStore.setState({ user: { ...user, role: 'PATIENT', patientId: 42 } });
    const view = setup();
    await screen.findByRole('button', { name: /Pieza 21/ });
    expect(screen.queryByRole('button', { name: 'Consulta histórica' })).not.toBeInTheDocument();
    expect(view.calls.some((call) => /\/history|\/at|\/clinical/.test(call.url.pathname))).toBe(false);
    cleanup();
    useAuthStore.setState({ user: { ...user, role: 'RECEPTIONIST' } });
    const reception = setup();
    await screen.findByRole('button', { name: /Pieza 21/ });
    expect(reception.calls.map(call => call.url.pathname)).toEqual(['/api/patients/42/odontogram/reception-summary']);
    expect(screen.getByRole('region', { name: 'Odontograma' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Condición de la pieza')).not.toBeInTheDocument();
  });

  it('la vista histórica respeta la orientación FDI (cuadrante 4 a la izquierda del espectador)', async () => {
    render(<MemoryRouter><ReadOnlyOdontogram patientId={42} snapshot={{
      at: '2026-10-13T11:05:00Z',
      teeth: [dentalHistorical({ toothFdi: 48 }), dentalHistorical({ toothFdi: 31 })],
      completeness: { status: 'PARTIAL', reasons: [] },
    }} /></MemoryRouter>);

    const right = screen.getByRole('button', { name: /Pieza 48 Inferior derecho/ });
    const left = screen.getByRole('button', { name: /Pieza 31 Inferior izquierdo/ });
    expect(parseFloat(right.style.left)).toBeLessThan(parseFloat(left.style.left));
    fireEvent.click(right);
    expect(await screen.findByRole('heading', { name: /Pieza 48 · consulta histórica/ })).toBeInTheDocument();
  });
});
