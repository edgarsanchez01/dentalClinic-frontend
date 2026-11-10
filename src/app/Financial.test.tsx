import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '../api/auth';
import type { Charge, FinancialMovement } from '../api/financial';
import type { FinancialIntentView, FinancialIntentOperation } from '../api/financialIntents';
import { cancelSessionRequests, tokenStore } from '../api/http';
import { ChargeDetailPage } from '../components/financial/ChargeDetailPage';
import { CreateChargePage } from '../components/financial/CreateChargePage';
import { FinancialAccessLink } from '../components/financial/FinancialAccessLink';
import { FinancesPage } from '../components/financial/FinancesPage';
import { FINANCIAL_ROLES, FINANCIAL_WRITE_ROLES } from '../components/financial/financialUi';
import { AppShell } from '../components/layout/AppShell';
import { useAuthStore } from './authStore';
import { RequireAuth, RequireRole } from './guards';

const NOW = '2026-10-14T00:00:00Z';
const PATIENT = { id: 10, firstName: 'Ada', lastName: 'Prueba', active: true, createdAt: NOW };
const APPOINTMENT = { id: 21, patientId: 10, dentistId: 7, patientFirstName: 'Ada', patientLastName: 'Prueba',
  dentistFirstName: 'Dentista', dentistLastName: 'Prueba', startAt: NOW, endAt: '2026-10-14T01:00:00Z',
  durationMinutes: 60, status: 'COMPLETED', occurrenceVersion: 1, createdByUserId: 1, createdAt: NOW };
const ORIGINAL_PAYMENT: FinancialMovement = { id: 7, chargeId: 99, patientId: 10, type: 'PAYMENT', amount: '40.0000',
  paymentMethod: 'CASH', performedByUserId: 1, performedAt: NOW, createdAt: NOW };
const BASE_CHARGE: Charge = { id: 99, patientId: 10, currency: 'MXN', totalAmount: '100.0000', appliedAmount: '0.0000',
  pendingBalance: '100.0000', status: 'PENDIENTE', confirmedAt: NOW, confirmedByUserId: 1, createdAt: NOW, version: 1,
  items: [{ id: 1, chargeId: 99, description: 'Consulta histórica', quantity: 1, unitPrice: '100.0000', lineTotal: '100.0000', createdAt: NOW }], movements: [] };
interface Recorded { path: string; method: string; body: string; key: string | undefined }
interface Options { withPayment?: boolean; readStatus?: number; writeStatus?: number; networkOnce?: boolean;
  pendingWrite?: boolean; pendingRead?: boolean; getFailsAfterWrite?: boolean; totalPages?: number }

function HistoryControls() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate(-1)}>Atrás del navegador</button><button onClick={() => navigate(1)}>Adelante del navegador</button></>;
}

function setup(role: Role = 'OWNER', route = '/finances/99', options: Options = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  useAuthStore.setState({ status: 'authenticated', user: { id: 1, email: 'staff@financial.test', role, active: true,
    createdAt: NOW, ...(role === 'DENTIST' || role === 'OWNER' ? { dentistId: 7 } : {}) }, queryClient: client });
  let current: Charge = structuredClone(BASE_CHARGE);
  if (options.withPayment) current = { ...current, appliedAmount: '40.0000', pendingBalance: '60.0000', status: 'PARCIAL', movements: [ORIGINAL_PAYMENT] };
  const requests: Recorded[] = [];
  const results = new Map<string, unknown>();
  const intents = new Map<string, { view: FinancialIntentView; command: Record<string, unknown> }>();
  let lostIntentRead = false;
  let writeCount = 0;
  let readFailed = false;
  let releaseWrite: (() => void) | undefined;
  let releaseRead: (() => void) | undefined;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    let request: Recorded = { path: url.pathname + url.search, method, body: String(init?.body ?? ''), key: (init?.headers as Record<string, string> | undefined)?.['Idempotency-Key'] };
    requests.push(request);
    if (url.pathname === '/api/auth/refresh') return new Response('{}', { status: 401 });
    if (url.pathname === '/api/notifications/unread-count') return new Response('{"unread":0}');
    if (url.pathname === '/api/auth/logout') return new Response(null, { status: 204 });
    if (url.pathname === '/api/patients') return new Response(JSON.stringify({ content: [PATIENT], page: 0, size: 10, totalElements: 1, totalPages: 1 }));
    if (url.pathname === '/api/patients/10') return new Response(JSON.stringify(PATIENT));
    if (url.pathname === '/api/appointments') return new Response(JSON.stringify({ content: [APPOINTMENT], page: 0, size: 10, totalElements: 1, totalPages: 1 }));
    if (url.pathname.startsWith('/api/appointments/')) return new Response(JSON.stringify({ ...APPOINTMENT,
      ...(url.pathname.endsWith('/22') ? { id: 22, dentistId: 8 } : {}) }));
    let activeIntent: { view: FinancialIntentView; command: Record<string, unknown> } | undefined;
    if (url.pathname === '/api/financial-intents' && method === 'GET') {
      return new Response(JSON.stringify({ items: [...intents.values()].map(row => row.view)
        .filter(row => url.searchParams.get('view') === 'recent' || row.state === 'REGISTERED') }));
    }
    if (url.pathname === '/api/financial-intents' && method === 'POST') {
      const body = JSON.parse(request.body) as { operation: FinancialIntentOperation; intentId: string; command: Record<string, unknown> };
      request.key = body.intentId;
      const identity = `${body.operation}/${body.intentId}`;
      const existing = intents.get(identity);
      if (existing) return new Response(JSON.stringify(existing.view));
      const view: FinancialIntentView = { operation: body.operation, intentId: body.intentId, state: 'REGISTERED', registeredAt: NOW };
      intents.set(identity, { view, command: body.command });
      return new Response(JSON.stringify(view), { status: 201 });
    }
    if (url.pathname.startsWith('/api/financial-intents/')) {
      const [, , , operation, key, action] = url.pathname.split('/');
      request.key = key;
      activeIntent = intents.get(`${operation}/${key}`);
      if (!activeIntent) return new Response('{}', { status: 404 });
      if (method === 'GET') {
        if (lostIntentRead) { lostIntentRead = false; return new Response('{}', { status: 503 }); }
        return new Response(JSON.stringify(activeIntent.view));
      }
      if (action === 'abandon') {
        activeIntent.view = { ...activeIntent.view, state: 'ABANDONED', closedAt: NOW };
        return new Response(JSON.stringify(activeIntent.view));
      }
      if (activeIntent.view.state === 'CONFIRMED') return new Response(JSON.stringify(activeIntent.view));
      const command = activeIntent.command;
      const legacy = operation === 'FIN_CONFIRM_CHARGE' ? '/api/charges'
        : operation === 'FIN_REGISTER_PAYMENT' ? `/api/charges/${command.chargeId}/payments`
          : operation === 'FIN_REVERSE_PAYMENT' ? `/api/charges/${command.chargeId}/movements/${command.movementId}/reverse` : `/api/charges/${command.chargeId}/cancel`;
      // El simulador reutiliza sus efectos historicos; las peticiones registradas siguen siendo B4 reales.
      request = { ...request, path: legacy, body: JSON.stringify(command) };
      url = new URL(legacy, 'http://localhost');
    }
    if (method === 'GET') {
      if (options.readStatus || (options.getFailsAfterWrite && writeCount > 0 && !readFailed)) {
        readFailed = true; return new Response(JSON.stringify({ message: 'Lectura financiera rechazada.' }), { status: options.readStatus ?? 503 });
      }
      const response = new Response(JSON.stringify(url.pathname === '/api/charges' ? {
        content: [{ ...current, id: 99 + Number(url.searchParams.get('page') ?? 0) }],
        page: Number(url.searchParams.get('page') ?? 0), size: 20, totalPages: options.totalPages ?? 1, totalElements: options.totalPages ? 40 : 1,
      } : current));
      if (options.pendingRead) return new Promise<Response>((resolve) => { releaseRead = () => resolve(response); });
      return response;
    }
    writeCount++;
    if (options.writeStatus) return new Response(JSON.stringify({ message: 'Error financiero del servidor.', fieldErrors: { amount: 'Importe rechazado.' } }), { status: options.writeStatus });
    const body = JSON.parse(request.body) as { amount?: number; method?: string; reason?: string; patientId?: number };
    const identity = url.pathname + request.key;
    let result = results.get(identity);
    if (!result) {
      if (url.pathname === '/api/charges') {
        result = { id: current.id, patientId: 10, currency: 'MXN', totalAmount: '100.0000', confirmedAt: NOW, confirmedByUserId: 1, createdAt: NOW, version: 1 };
      } else if (url.pathname.endsWith('/payments')) {
        const amount = body.amount ?? 0;
        result = { ...ORIGINAL_PAYMENT, id: 7 + writeCount, amount: String(amount), paymentMethod: body.method };
        current = { ...current, appliedAmount: String(amount), pendingBalance: String(100 - amount),
          status: amount === 100 ? 'PAGADO' : 'PARCIAL', movements: [...(current.movements ?? []), result as FinancialMovement] };
      } else if (url.pathname.endsWith('/reverse')) {
        result = { id: 9, chargeId: 99, patientId: 10, type: 'REVERSAL', amount: '40.0000', reversesMovementId: 7,
          reason: body.reason, performedAt: NOW, performedByUserId: 1, createdAt: NOW };
        current = { ...current, appliedAmount: '0', pendingBalance: '100', status: 'PENDIENTE', movements: [...(current.movements ?? []), result as FinancialMovement] };
      } else {
        result = { ...current, cancelledAt: NOW, cancelledByUserId: 1, cancellationReason: body.reason };
        current = { ...current, cancelledAt: NOW, cancelledByUserId: 1, cancellationReason: body.reason ?? '', status: 'ANULADO', pendingBalance: '0' };
      }
      results.set(identity, result);
    }
    if (activeIntent) activeIntent.view = { ...activeIntent.view, state: 'CONFIRMED', effect: {
      chargeId: 99, ...(['FIN_REGISTER_PAYMENT', 'FIN_REVERSE_PAYMENT'].includes(activeIntent.view.operation) ? { movementId: (result as FinancialMovement).id } : {}),
    } };
    if (options.networkOnce && writeCount === 1) { lostIntentRead = true; throw new TypeError('Network response lost after commit'); }
    const response = new Response(JSON.stringify(activeIntent?.view ?? result), { status: activeIntent ? 200 : url.pathname.endsWith('/cancel') ? 200 : 201 });
    if (options.pendingWrite) return new Promise<Response>((resolve) => { releaseWrite = () => resolve(response); });
    return response;
  }));
  const guard = (roles: Role[], children: React.ReactNode) => <RequireAuth><RequireRole role={roles}>{children}</RequireRole></RequireAuth>;
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><Routes>
    <Route path="/finances" element={guard(FINANCIAL_ROLES, <AppShell><FinancesPage /></AppShell>)} />
    <Route path="/finances/new" element={guard(FINANCIAL_WRITE_ROLES, <CreateChargePage />)} />
    <Route path="/finances/:id" element={guard(FINANCIAL_ROLES, <ChargeDetailPage />)} />
    <Route path="/login" element={<h1>Iniciar sesión</h1>} />
  </Routes><HistoryControls /></MemoryRouter></QueryClientProvider>);
  return { requests, client, results, releaseWrite: () => releaseWrite?.(), releaseRead: () => releaseRead?.() };
}

async function detailLoaded() { await screen.findByRole('heading', { name: 'Cargo #99' }); }

const HOMONYMS = [
  { id: 11, firstName: 'Luis', lastName: 'Gómez', email: 'luis@test', phone: '555-0102', active: true, createdAt: NOW },
  { id: 21, firstName: 'Luis', lastName: 'Gómez', email: 'luis2@test', phone: '555-0201', active: true, createdAt: NOW },
];
/** Aísla el combobox con dos homónimos distinguibles por teléfono y por Paciente #id. */
function homonymsSetup(client: QueryClient, options: typeof HOMONYMS) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/notifications/unread-count') return new Response('{"unread":0}');
    if (url.pathname === '/api/auth/refresh') return new Response('{}', { status: 401 });
    if (url.pathname === '/api/financial-intents') return new Response('{"items":[]}');
    if (url.pathname === '/api/patients') return new Response(JSON.stringify({ content: options, page: 0, size: 10, totalElements: 2, totalPages: 1 }));
    if (url.pathname === '/api/patients/11') return new Response(JSON.stringify(options[0]));
    if (url.pathname === '/api/patients/21') return new Response(JSON.stringify(options[1]));
    if (url.pathname === '/api/charges') return new Response(JSON.stringify({ content: [BASE_CHARGE], page: 0, size: 20, totalElements: 1, totalPages: 1 }));
    return new Response(JSON.stringify(BASE_CHARGE));
  }));
  return client;
}
async function selectPatient() {
  fireEvent.focus(await screen.findByRole('combobox', { name: 'Paciente (obligatorio)' }));
  fireEvent.click(await screen.findByRole('option', { name: /Ada Prueba.*Paciente #10/ }));
  await waitFor(() => expect(screen.queryByText('Verificando paciente seleccionado…')).not.toBeInTheDocument());
}
/** RECEPTIONIST selecciona desde el combobox: escribe, aparece el desplegable y elige una opción. */
async function selectReceptionPatient() {
  const input = await screen.findByRole('combobox', { name: /^Paciente/ });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'Ada' } });
  const option = await screen.findByRole('option', { name: /Ada Prueba/ });
  fireEvent.click(option);
  await waitFor(() => expect(screen.getByText('Paciente seleccionado')).toBeInTheDocument());
  await waitFor(() => expect(screen.queryByText('Verificando paciente seleccionado…')).not.toBeInTheDocument());
}
function fillConcept(price = '100', description = 'Consulta manual', quantity = '1') {
  fireEvent.change(screen.getByLabelText('Descripción del concepto 1'), { target: { value: description } });
  fireEvent.change(screen.getByLabelText('Cantidad del concepto 1'), { target: { value: quantity } });
  fireEvent.change(screen.getByLabelText('Precio unitario del concepto 1 (MXN)'), { target: { value: price } });
}
/** RECEPTIONIST navega el asistente real; OWNER ve todo el formulario en una etapa. */
function continueFromPatient() {
  const button = screen.queryByRole('button', { name: 'Continuar a conceptos' });
  if (button) fireEvent.click(button);
}
function reviewCharge() {
  const button = screen.queryByRole('button', { name: 'Revisar cargo' });
  if (button) fireEvent.click(button);
}
function fillPayment(amount = '25') {
  fireEvent.change(screen.getByLabelText('Importe del pago (MXN)'), { target: { value: amount } });
}
const posts = (requests: Recorded[]) => requests.filter((request) => request.method === 'POST' && request.path.endsWith('/execute'));
const registrations = (requests: Recorded[]) => requests.filter(request => request.method === 'POST' && request.path === '/api/financial-intents');

beforeEach(() => { cancelSessionRequests(); tokenStore.set('financial-test'); });
afterEach(() => {
  cleanup(); useAuthStore.getState().queryClient.clear(); cancelSessionRequests(); tokenStore.set(null);
  useAuthStore.setState({ status: 'anonymous', user: null, sessionVersion: useAuthStore.getState().sessionVersion + 1 });
  vi.unstubAllGlobals();
});

describe('Finanzas funcionales Fase 4A', () => {
  it.each(['OWNER', 'RECEPTIONIST', 'DENTIST'] as const)('%s accede al listado, navegación y datos autorizados', async (role) => {
    setup(role, '/finances');
    await screen.findByRole('link', { name: 'Cargo #99' });
    expect(screen.getByRole('navigation', { name: 'Navegación de escritorio' })).toHaveTextContent('Finanzas');
    expect(screen.getByText('Pendiente', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText(/cargos autorizados con estos filtros/)).toHaveTextContent('1 cargos');
    expect(screen.queryByText(/Ingresos globales:/)).not.toBeInTheDocument();
  });
  it.each(['/finances', '/finances/new', '/finances/99'])('PATIENT no abre %s ni consulta datos financieros', async (route) => {
    const { requests } = setup('PATIENT', route);
    expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
    expect(requests.some((request) => request.path.startsWith('/api/charges'))).toBe(false);
  });
  it('paginar usa página y conteo del servidor, no una suma local', async () => {
    const { requests } = setup('OWNER', '/finances', { totalPages: 2 });
    await screen.findByRole('link', { name: 'Cargo #99' });
    fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
    await screen.findByRole('link', { name: 'Cargo #100' });
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument();
    expect(screen.getByText(/40 cargos autorizados/)).toBeInTheDocument();
    expect(requests.some((request) => request.path.includes('page=1') && request.path.includes('size=20'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Página siguiente' })).toBeDisabled();
  });
  it('filtra por paciente, estado y fechas sin enviar dentistId ni paginación antigua', async () => {
    const { requests } = setup('DENTIST', '/finances?page=1');
    await selectReceptionPatient();
    fireEvent.change(screen.getByLabelText('Estado del cargo'), { target: { value: 'PARCIAL' } });
    fireEvent.change(screen.getByLabelText('Desde (fecha de confirmación)'), { target: { value: '2026-10-14' } });
    fireEvent.change(screen.getByLabelText('Hasta (incluye ese día)'), { target: { value: '2026-10-14' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Filtrar cargos' }));
    await waitFor(() => expect(requests.some((request) => request.path.includes('patientId=10') && request.path.includes('status=PARCIAL'))).toBe(true));
    const request = requests.filter((entry) => entry.path.startsWith('/api/charges?')).at(-1)!;
    const params = new URL(request.path, 'http://localhost').searchParams;
    expect(params.get('page')).toBe('0'); expect(params.has('dentistId')).toBe(false);
    expect(new Date(params.get('to')!).getTime() - new Date(params.get('from')!).getTime()).toBe(86400000);
  });
  it('Atrás y Adelante restauran los filtros visibles que realmente consulta la tabla', async () => {
    setup('OWNER', '/finances'); await screen.findByRole('link', { name: 'Cargo #99' });
    fireEvent.change(screen.getByLabelText('Estado del cargo'), { target: { value: 'PENDIENTE' } });
    fireEvent.change(screen.getByLabelText('Desde (fecha de confirmación)'), { target: { value: '2026-10-14' } });
    fireEvent.change(screen.getByLabelText('Hasta (incluye ese día)'), { target: { value: '2026-10-15' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Filtrar cargos' }));
    fireEvent.change(screen.getByLabelText('Estado del cargo'), { target: { value: 'PARCIAL' } });
    fireEvent.change(screen.getByLabelText('Desde (fecha de confirmación)'), { target: { value: '2026-10-16' } });
    fireEvent.change(screen.getByLabelText('Hasta (incluye ese día)'), { target: { value: '2026-10-17' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Filtrar cargos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Atrás del navegador' }));
    await waitFor(() => expect(screen.getByLabelText('Estado del cargo')).toHaveValue('PENDIENTE'));
    expect(screen.getByLabelText('Desde (fecha de confirmación)')).toHaveValue('2026-10-14');
    expect(screen.getByLabelText('Hasta (incluye ese día)')).toHaveValue('2026-10-15');
    fireEvent.click(screen.getByRole('button', { name: 'Adelante del navegador' }));
    await waitFor(() => expect(screen.getByLabelText('Estado del cargo')).toHaveValue('PARCIAL'));
    expect(screen.getByLabelText('Desde (fecha de confirmación)')).toHaveValue('2026-10-16');
    expect(screen.getByLabelText('Hasta (incluye ese día)')).toHaveValue('2026-10-17');
  });
  it.each(['OWNER', 'RECEPTIONIST'] as const)('%s confirma cargo manual y luego consulta su detalle con GET', async (role) => {
    const { requests } = setup(role, '/finances/new');
    if (role === 'RECEPTIONIST') await selectReceptionPatient(); else await selectPatient();
    continueFromPatient();
    fillConcept('12,50', 'Concepto congelado', '2');
    reviewCharge();
    expect(screen.getByText('Total de vista previa: $25.00 MXN')).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('form', { name: 'Crear cargo manual' }));
    await detailLoaded();
    const request = posts(requests)[0]!;
    expect(request.key).toBeTruthy();
    expect(JSON.parse(registrations(requests)[0]!.body).command).toEqual({ patientId: 10, appointmentId: null, items: [{ description: 'Concepto congelado', quantity: 2, unitPrice: 12.5 }], notes: null });
    expect(JSON.parse(request.body)).toEqual({});
    expect(request.body).not.toContain('dentistId'); expect(request.body).not.toContain('totalAmount');
    expect(requests.some((entry) => entry.path === '/api/charges/99' && entry.method === 'GET')).toBe(true);
    expect(screen.getByRole('heading', { name: 'Estado vigente: Pendiente' })).toBeInTheDocument();
  });
  it('RECEPTIONIST recorre tres etapas reales: conceptos ocultos, revisión obligatoria y confirmación solo al final', async () => {
    const { requests } = setup('RECEPTIONIST', '/finances/new');
    // Etapa 1: solo el paciente. Los conceptos y la confirmación todavía no existen.
    expect(screen.getByRole('heading', { name: 'Seleccionar paciente', level: 2 })).toBeInTheDocument();
    expect(screen.queryByLabelText('Descripción del concepto 1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar cargo manual' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revisar cargo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar a conceptos' })).toBeInTheDocument();
    // No se avanza sin un paciente verificado por la API.
    fireEvent.click(screen.getByRole('button', { name: 'Continuar a conceptos' }));
    expect(screen.queryByLabelText('Descripción del concepto 1')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Seleccionar paciente', level: 2 })).toBeInTheDocument();
    // Etapa 2 tras verificar; el paciente sigue identificado como contexto.
    await selectReceptionPatient();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar a conceptos' }));
    expect(screen.getByRole('region', { name: 'Contexto del paciente' })).toHaveTextContent('Prueba, Ada');
    expect(screen.getByRole('heading', { name: 'Conceptos del cargo', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar cargo manual' })).not.toBeInTheDocument();
    fillConcept('100', 'Consulta manual', '1');
    // «Revisar cargo» no avanza con datos inválidos y no envía nada.
    fireEvent.change(screen.getByLabelText('Precio unitario del concepto 1 (MXN)'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar cargo' }));
    expect(screen.queryByRole('region', { name: 'Revisión antes de confirmar' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Precio unitario del concepto 1 (MXN)')).toHaveValue('0');
    expect(posts(requests)).toHaveLength(0);
    fillConcept('100', 'Consulta manual', '1');
    fireEvent.click(screen.getByRole('button', { name: 'Revisar cargo' }));
    // Etapa 3: resumen con el paciente verificado, los conceptos y la confirmación.
    const review = screen.getByRole('region', { name: 'Revisión antes de confirmar' });
    expect(review).toHaveTextContent('Prueba, Ada');
    expect(review).toHaveTextContent('Consulta manual');
    expect(screen.getByRole('button', { name: 'Confirmar cargo manual' })).toBeInTheDocument();
    // Atrás conserva lo introducido y vuelve a ocultar la confirmación.
    fireEvent.click(screen.getByRole('button', { name: 'Volver a conceptos' }));
    expect(screen.getByLabelText('Descripción del concepto 1')).toHaveValue('Consulta manual');
    expect(screen.queryByRole('button', { name: 'Confirmar cargo manual' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar cargo' }));
    expect(screen.getByRole('region', { name: 'Revisión antes de confirmar' })).toHaveTextContent('Consulta manual');
    // Volver al paciente también conserva conceptos.
    fireEvent.click(screen.getByRole('button', { name: 'Volver a conceptos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Volver al paciente' }));
    expect(screen.getByLabelText('Paciente seleccionado')).toHaveTextContent('Prueba, Ada · Paciente #10');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar a conceptos' }));
    expect(screen.getByLabelText('Descripción del concepto 1')).toHaveValue('Consulta manual');
    expect(posts(requests)).toHaveLength(0);
  });
  it('OWNER conserva el formulario completo y sin asistente', async () => {
    setup('OWNER', '/finances/new');
    expect(screen.queryByRole('button', { name: 'Continuar a conceptos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revisar cargo' })).not.toBeInTheDocument();
    await selectPatient();
    expect(screen.getByLabelText('Descripción del concepto 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar cargo manual' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Revisión antes de confirmar' })).not.toBeInTheDocument();
  });
  it('OWNER: seleccionar, abrir y editar son borrador; solo Aplicar modifica la consulta de cargos', async () => {
    const { requests } = setup('OWNER', '/finances?appointmentId=20');
    await screen.findByRole('link', { name: 'Cargo #99' });
    const listReads = () => requests.filter(request => request.path.startsWith('/api/charges?'));
    const count = listReads().length;
    const input = screen.getByRole('combobox', { name: 'Paciente (filtro opcional)' });
    fireEvent.focus(input);
    fireEvent.click(await screen.findByRole('option', { name: /Paciente #10/ }));
    await screen.findByDisplayValue('Ada Prueba');
    expect(listReads()).toHaveLength(count);
    fireEvent.focus(input); fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('Ada Prueba');
    fireEvent.submit(screen.getByRole('form', { name: 'Filtrar cargos' }));
    await waitFor(() => expect(listReads().at(-1)!.path).toMatch(/patientId=10/));
    expect(listReads().at(-1)!.path).toContain('appointmentId=20');
    const appliedCount = listReads().length;
    fireEvent.change(screen.getByRole('combobox', { name: 'Paciente (filtro opcional)' }), { target: { value: 'texto libre' } });
    expect(screen.queryByRole('button', { name: 'Quitar selección' })).not.toBeInTheDocument();
    expect(listReads()).toHaveLength(appliedCount);
    fireEvent.submit(screen.getByRole('form', { name: 'Filtrar cargos' }));
    await waitFor(() => expect(listReads().at(-1)!.path).not.toContain('patientId='));
    expect(listReads().at(-1)!.path).toContain('appointmentId=20');
    expect(posts(requests)).toHaveLength(0);
  });
  it('RECEPTIONIST bloquea doble confirmación antes del siguiente render', async () => {
    const { requests, releaseWrite } = setup('RECEPTIONIST', '/finances/new', { pendingWrite: true });
    await selectReceptionPatient(); continueFromPatient(); fillConcept(); reviewCharge();
    expect(posts(requests)).toHaveLength(0);
    const form = screen.getByRole('form', { name: 'Crear cargo manual' });
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(posts(requests)).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Confirmando cargo…' })).toBeDisabled();
    await act(async () => releaseWrite());
    await detailLoaded();
  });
  it.each(['RECEPTIONIST', 'DENTIST'] as const)('%s: el detalle identifica al paciente por su nombre autorizado', async (role) => {
    setup(role, '/finances/99');
    await detailLoaded();
    await waitFor(() => expect(screen.getByRole('banner')).toHaveTextContent('Prueba, Ada · Paciente #10'));
  });
  it.each(['RECEPTIONIST', 'DENTIST'] as const)('%s: la selección de paciente del listado se anuncia y se puede quitar', async (role) => {
    setup(role, '/finances?patientId=10');
    const selected = await screen.findByLabelText('Paciente seleccionado');
    await waitFor(() => expect(selected).toHaveTextContent('Prueba, Ada · Paciente #10'));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar selección' }));
    await waitFor(() => expect(screen.queryByLabelText('Paciente seleccionado')).not.toBeInTheDocument());
  });
  it('el combobox distingue homónimos por ID y selecciona sin usar el texto visible', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    useAuthStore.setState({ status: 'authenticated', user: { id: 1, email: 'staff@financial.test', role: 'RECEPTIONIST', active: true, createdAt: NOW }, queryClient: client });
    homonymsSetup(client, HOMONYMS);
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/finances']}><Routes>
      <Route path="/finances" element={<FinancesPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    await screen.findByRole('link', { name: 'Cargo #99' });
    const input = screen.getByRole('combobox', { name: 'Paciente' });
    fireEvent.focus(input); fireEvent.change(input, { target: { value: 'Gómez' } });
    const results = await screen.findAllByRole('option', { name: /Luis Gómez/ });
    // Los homónimos se distinguen por un dato autorizado (teléfono) y por Paciente #id.
    expect(results[0]).toHaveTextContent('Paciente #11');
    expect(results[0]).toHaveTextContent('555-0102');
    expect(results[1]).toHaveTextContent('Paciente #21');
    fireEvent.click(results[1]!);
    await waitFor(() => expect(screen.getByLabelText('Paciente seleccionado')).toHaveTextContent('Paciente #21'));
  });
  it.each(['RECEPTIONIST', 'DENTIST'] as const)('%s: el combobox se opera con el teclado: flechas, Enter y Escape', async (role) => {
    setup(role, '/finances');
    await screen.findByRole('link', { name: 'Cargo #99' });
    const input = screen.getByRole('combobox', { name: 'Paciente' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Ada' } });
    await screen.findByRole('option', { name: /Ada Prueba/ });
    expect(input).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', expect.stringContaining('option-0'));
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByLabelText('Paciente seleccionado')).toHaveTextContent('Prueba, Ada · Paciente #10'));
    // Escape cierra el desplegable sin cambiar la selección.
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'false'));
  });
  it.each(['RECEPTIONIST', 'DENTIST'] as const)('%s: la tabla avisa cuando hay filtros sin aplicar sin cambiar de semántica', async (role) => {
    const { requests } = setup(role, '/finances');
    await screen.findByRole('link', { name: 'Cargo #99' });
    expect(screen.queryByText(/Filtros sin aplicar/)).not.toBeInTheDocument();
    await selectReceptionPatient();
    expect(await screen.findByText(/Filtros sin aplicar/)).toBeInTheDocument();
    expect(requests.filter((request) => request.path.startsWith('/api/charges?'))).toHaveLength(1);
    expect(posts(requests)).toHaveLength(0);
  });

  it('DENTIST comparte resumen, conceptos y movimientos con recepción sin montar sus operaciones', async () => {
    setup('RECEPTIONIST', '/finances/99', { withPayment: true });
    await detailLoaded();
    const labels = ['Estado financiero vigente', 'Conceptos históricos', 'Historial financiero'];
    const reference = labels.map((name) => screen.getByRole('region', { name }).innerHTML);
    cleanup();
    useAuthStore.getState().queryClient.clear();
    const { requests } = setup('DENTIST', '/finances/99', { withPayment: true });
    await detailLoaded();
    expect(labels.map((name) => screen.getByRole('region', { name }).innerHTML)).toEqual(reference);
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar pago|Reversar pago|Anular cargo/ })).not.toBeInTheDocument();
    expect(requests.every(({ method }) => method === 'GET')).toBe(true);
  });
  it('añade y quita conceptos, conservando al menos uno', async () => {
    setup('OWNER', '/finances/new');
    await selectPatient();
    expect(screen.getByRole('button', { name: 'Quitar concepto 1' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Añadir concepto' }));
    expect(screen.getByLabelText('Descripción del concepto 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar concepto 2' }));
    expect(screen.queryByLabelText('Descripción del concepto 2')).not.toBeInTheDocument();
  });
  it.each([['1.001', 'Consulta', '1'], ['-1', 'Consulta', '1'], ['0', 'Consulta', '1'], ['10', ' ', '1'], ['10', 'Consulta', '0'], ['10', 'Consulta', '1.5']])('valida concepto %s/%s/%s antes del POST', async (price, description, quantity) => {
    const { requests } = setup('OWNER', '/finances/new'); await selectPatient(); fillConcept(price, description, quantity);
    fireEvent.submit(screen.getByRole('form', { name: 'Crear cargo manual' }));
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('Revisa los campos'))).toBe(true);
    expect(posts(requests)).toHaveLength(0);
  });
  it('DENTIST no abre el alta de cargos ni envía ningún POST', async () => {
    const { requests } = setup('DENTIST', '/finances/new');
    expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
    expect(posts(requests)).toHaveLength(0);
  });
  it('DENTIST no abre el alta aunque la URL preseleccione una cita', async () => {
    const { requests } = setup('DENTIST', '/finances/new?patientId=10&appointmentId=21');
    expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
    expect(posts(requests)).toHaveLength(0);
  });
  it('pago parcial refresca saldo con GET; no interpreta el recibo como saldo actual', async () => {
    const { requests } = setup(); await detailLoaded(); fillPayment('25');
    fireEvent.submit(screen.getByRole('form', { name: 'Registrar pago manual' }));
    expect(await screen.findByText(/Pago registrado. El saldo mostrado/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Estado vigente: Parcial' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Estado financiero vigente' })).getByText('$75.00 MXN')).toBeInTheDocument();
    expect(posts(requests)[0]!.key).toBeTruthy();
    expect(requests.filter((entry) => entry.path === '/api/charges/99' && entry.method === 'GET').length).toBeGreaterThan(1);
  });
  it('evita sobrepagos desde la UI sin enviar y conserva el error del servidor', async () => {
    const { requests } = setup(); await detailLoaded(); fillPayment('100.01');
    fireEvent.submit(screen.getByRole('form', { name: 'Registrar pago manual' }));
    expect(screen.getByText(/El importe supera el saldo vigente/)).toBeInTheDocument();
    expect(posts(requests)).toHaveLength(0);
  });
  it.each([400, 403, 404, 409])('escritura HTTP %s no muestra confirmación falsa', async (writeStatus) => {
    setup('OWNER', '/finances/99', { writeStatus }); await detailLoaded(); fillPayment();
    fireEvent.submit(screen.getByRole('form', { name: 'Registrar pago manual' }));
    expect(await screen.findByText('Error financiero del servidor.')).toBeInTheDocument();
    expect(screen.queryByText(/Pago registrado. El saldo mostrado/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Estado vigente: Pendiente' })).toBeInTheDocument();
  });
  it('resultado ambiguo conserva solicitud y clave al navegar y reintentar', async () => {
    const { requests, results } = setup('OWNER', '/finances/new', { networkOnce: true }); await selectPatient(); fillConcept('100.00');
    fireEvent.submit(screen.getByRole('form', { name: 'Crear cargo manual' }));
    await screen.findByRole('button', { name: 'Consultar operación' });
    await screen.findByText('Resultado incierto');
    expect(screen.getByLabelText('Precio unitario del concepto 1 (MXN)')).toBeDisabled();
    fireEvent.click(screen.getByRole('link', { name: 'Volver a finanzas' }));
    await screen.findByRole('link', { name: 'Crear cargo manual' });
    fireEvent.click(screen.getByRole('link', { name: 'Crear cargo manual' }));
    await screen.findByDisplayValue('Ada Prueba');
    expect(await screen.findByRole('button', { name: 'Consultar operación' })).toBeEnabled();
    expect(screen.getByLabelText('Precio unitario del concepto 1 (MXN)')).toHaveValue('100.00');
    fireEvent.click(screen.getByRole('button', { name: 'Consultar operación' })); await detailLoaded();
    expect(posts(requests)).toHaveLength(1);
    expect(registrations(requests)).toHaveLength(1);
    expect(results.size).toBe(1);
  });
  it.each([408, 429, 500, 503, 504])('HTTP %s conserva clave y payload porque no confirma un rollback', async (writeStatus) => {
    const { requests } = setup('OWNER', '/finances/99', { writeStatus }); await detailLoaded(); fillPayment('25.00');
    fireEvent.submit(screen.getByRole('form', { name: 'Registrar pago manual' }));
    await screen.findByRole('button', { name: 'Reanudar operación' });
    expect(screen.getByLabelText('Importe del pago (MXN)')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reanudar operación' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reanudación' }));
    await waitFor(() => expect(posts(requests)).toHaveLength(2));
    expect(posts(requests)[1]!.key).toBe(posts(requests)[0]!.key);
    expect(posts(requests)[1]!.body).toBe(posts(requests)[0]!.body);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reanudar operación' })).toBeEnabled());
  });
  it('un envío aceptado con lectura fallida solo reintenta GET', async () => {
    const { requests } = setup('OWNER', '/finances/99', { getFailsAfterWrite: true }); await detailLoaded(); fillPayment();
    fireEvent.submit(screen.getByRole('form', { name: 'Registrar pago manual' }));
    expect(await screen.findByText(/La última operación fue registrada/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar detalle' }));
    await detailLoaded();
    expect(posts(requests)).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: 'Estado financiero vigente' })).getByText('$75.00 MXN')).toBeInTheDocument();
  });
  it('bloquea doble envío sin depender del render pendiente', async () => {
    const { requests, releaseWrite } = setup('OWNER', '/finances/99', { pendingWrite: true }); await detailLoaded(); fillPayment();
    const form = screen.getByRole('form', { name: 'Registrar pago manual' });
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(posts(requests)).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Registrando pago…' })).toBeDisabled();
    await act(async () => releaseWrite());
  });
  it('una operación nueva genera clave nueva después de confirmar y actualizar', async () => {
    const { requests } = setup(); await detailLoaded(); fillPayment('10');
    fireEvent.submit(screen.getByRole('form', { name: 'Registrar pago manual' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar otro pago' }));
    fillPayment('20'); fireEvent.submit(screen.getByRole('form', { name: 'Registrar pago manual' }));
    await waitFor(() => expect(posts(requests)).toHaveLength(2));
    expect(posts(requests)[0]!.key).not.toBe(posts(requests)[1]!.key);
  });
  it('RECEPTIONIST registra pagos pero no ve reversa/anulación', async () => {
    setup('RECEPTIONIST', '/finances/99', { withPayment: true }); await detailLoaded();
    expect(screen.getByRole('button', { name: 'Registrar pago' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reversar pago|Anular cargo/ })).not.toBeInTheDocument();
  });
  it('DENTIST solo consulta el cargo: sin pago ni correcciones', async () => {
    const { requests } = setup('DENTIST', '/finances/99', { withPayment: true }); await detailLoaded();
    expect(screen.queryByRole('region', { name: 'Registro manual de pago' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar pago|Reversar pago|Anular cargo/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Estado financiero vigente' })).toBeInTheDocument();
    expect(posts(requests)).toHaveLength(0);
  });
  it('OWNER reversa todo el pago, con motivo y confirmación explícita, y refresca GET', async () => {
    const { requests } = setup('OWNER', '/finances/99', { withPayment: true }); await detailLoaded();
    expect(screen.getByRole('button', { name: 'Anular cargo' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reversar pago #7' }));
    expect(screen.getByLabelText('Motivo obligatorio')).toHaveFocus();
    fireEvent.submit(screen.getByRole('form', { name: 'Confirmar corrección financiera' }));
    expect(screen.getByText(/Escribe el motivo y confirma/)).toBeInTheDocument();
    expect(posts(requests)).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Motivo obligatorio'), { target: { value: 'Duplicado' } });
    fireEvent.click(screen.getByLabelText('Confirmo esta operación y sus consecuencias'));
    fireEvent.submit(screen.getByRole('form', { name: 'Confirmar corrección financiera' }));
    await screen.findByText(/Pago reversado completamente. Saldo vigente consultado/);
    const request = posts(requests)[0]!;
    expect(request.path).toContain('/FIN_REVERSE_PAYMENT/');
    expect(JSON.parse(registrations(requests)[0]!.body).command).toEqual({ chargeId: 99, movementId: 7, reason: 'Duplicado' });
    expect(screen.getByRole('heading', { name: 'Estado vigente: Pendiente' })).toBeInTheDocument();
  });
  it('OWNER anula sin pagos válidos y no elimina conceptos ni movimientos', async () => {
    const { requests } = setup(); await detailLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Anular cargo' }));
    fireEvent.change(screen.getByLabelText('Motivo obligatorio'), { target: { value: 'Error de captura' } });
    fireEvent.click(screen.getByLabelText('Confirmo esta operación y sus consecuencias'));
    fireEvent.submit(screen.getByRole('form', { name: 'Confirmar corrección financiera' }));
    await screen.findByText('Cargo anulado. Estado vigente consultado.');
    expect(posts(requests)[0]!.path).toContain('/FIN_CANCEL_CHARGE/');
    expect(screen.getByText('Consulta histórica')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Estado vigente: Anulado' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Registrar pago' })).not.toBeInTheDocument();
  });
  it.each([403, 404, 409])('no deja datos financieros visibles al fallar el GET con %s', async (readStatus) => {
    setup('DENTIST', '/finances/99', { readStatus });
    expect(await screen.findByText('Lectura financiera rechazada.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Estado financiero vigente' })).not.toBeInTheDocument();
  });
  it('401 invalidado por el cliente devuelve a login sin saldo ni cache de otra sesión', async () => {
    setup('OWNER', '/finances/99', { readStatus: 401 });
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Estado financiero vigente' })).not.toBeInTheDocument();
    expect(useAuthStore.getState().queryClient.getQueriesData({ queryKey: ['financial-charges'] })).toEqual([]);
  });
  it('muestra carga de GET y no habilita operaciones antes de recibir datos', async () => {
    const { releaseRead } = setup('OWNER', '/finances/99', { pendingRead: true });
    expect(screen.getByRole('status')).toHaveTextContent('Cargando cargo');
    expect(screen.queryByRole('button', { name: 'Registrar pago' })).not.toBeInTheDocument();
    await act(async () => releaseRead()); await detailLoaded();
  });
  it.each(['OWNER', 'RECEPTIONIST', 'DENTIST', 'PATIENT'] as const)('los accesos administrativos reflejan el rol %s sin GET financiero automático', (role) => {
    useAuthStore.setState({ status: 'authenticated', user: { id: 1, role, dentistId: 7, email: 'x@test', active: true, createdAt: NOW } });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(<MemoryRouter><FinancialAccessLink patientId={10} appointmentId={21} dentistId={7} /></MemoryRouter>);
    if (role === 'PATIENT') {
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    } else {
      expect(screen.getByRole('link', { name: 'Ver cargos de esta cita' })).toHaveAttribute('href', '/finances?patientId=10&appointmentId=21');
    }
    if (role === 'OWNER' || role === 'RECEPTIONIST') {
      expect(screen.getByRole('link', { name: 'Crear cargo de esta cita' })).toHaveAttribute('href', '/finances/new?patientId=10&appointmentId=21');
    } else {
      expect(screen.queryByRole('link', { name: 'Crear cargo de esta cita' })).not.toBeInTheDocument();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
