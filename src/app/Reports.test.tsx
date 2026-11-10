import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '../api/auth';
import { cancelSessionRequests, tokenStore } from '../api/http';
import { FinancesPage } from '../components/financial/FinancesPage';
import { ReportsPage } from '../components/financial/ReportsPage';
import { FINANCIAL_REPORT_ROLES, FINANCIAL_ROLES } from '../components/financial/financialUi';
import { AppShell } from '../components/layout/AppShell';
import { useAuthStore } from './authStore';
import { RequireAuth, RequireRole } from './guards';

const NOW = '2026-10-15T12:00:00Z';
const PATIENT = { id: 10, firstName: 'Ada', lastName: 'Prueba', active: true, createdAt: NOW };
const PORTFOLIO = { asOf: NOW, confirmedCharges: 4, billedAmount: 300, appliedAmount: 140, pendingBalance: 160,
  statusCounts: { pendiente: 1, parcial: 1, pagado: 1, anulado: 1 } };
const CASH_FLOW = { from: null, to: null, grossAmount: 5, reversalAmount: 10, netAmount: -5,
  methods: [
    { method: 'CASH', grossAmount: 5, reversalAmount: 10, netAmount: -5 },
    { method: 'CARD', grossAmount: 0, reversalAmount: 0, netAmount: 0 },
    { method: 'TRANSFER', grossAmount: 0, reversalAmount: 0, netAmount: 0 },
    { method: 'OTHER', grossAmount: 0, reversalAmount: 0, netAmount: 0 },
  ] };
const CHARGES = { patientId: null, status: null, from: null, to: null, confirmedCharges: 2, billedAmount: 150,
  appliedAmount: 30, pendingBalance: 120,
  byPatient: [{ patientId: 10, chargeCount: 1, billedAmount: 100, appliedAmount: 30, pendingBalance: 70 }] };

interface Recorded { path: string; method: string }

function setup(role: Role, route = '/finances/reports', options: { fail?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  useAuthStore.setState({ status: 'authenticated', user: { id: 1, email: 'staff@financial.test', role, active: true, createdAt: NOW },
    queryClient: client });
  const requests: Recorded[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    requests.push({ path: url.pathname + url.search, method: init?.method ?? 'GET' });
    if (url.pathname === '/api/auth/refresh') return new Response('{}', { status: 401 });
    if (url.pathname === '/api/notifications/unread-count') return new Response('{"unread":0}');
    if (url.pathname === '/api/patients') return new Response(JSON.stringify({ content: [PATIENT], page: 0, size: 10, totalElements: 1, totalPages: 1 }));
    if (url.pathname === '/api/patients/10') return new Response(JSON.stringify(PATIENT));
    if (options.fail) return new Response(JSON.stringify({ message: 'Reporte financiero rechazado.' }), { status: 503 });
    if (url.pathname === '/api/financial/reports/portfolio') return new Response(JSON.stringify(PORTFOLIO));
    if (url.pathname === '/api/financial/reports/cash-flow') return new Response(JSON.stringify(CASH_FLOW));
    if (url.pathname === '/api/financial/reports/charges') return new Response(JSON.stringify(CHARGES));
    return new Response('{}', { status: 404 });
  }));
  const shell = (node: React.ReactNode) => <AppShell>{node}</AppShell>;
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><Routes>
    <Route path="/finances" element={<RequireAuth><RequireRole role={FINANCIAL_ROLES}>{shell(<FinancesPage />)}</RequireRole></RequireAuth>} />
    <Route path="/finances/reports" element={<RequireAuth><RequireRole role={FINANCIAL_REPORT_ROLES}>{shell(<ReportsPage />)}</RequireRole></RequireAuth>} />
    <Route path="/login" element={<h1>Iniciar sesión</h1>} />
  </Routes></MemoryRouter></QueryClientProvider>);
  return { requests, client };
}

beforeEach(() => { cancelSessionRequests(); tokenStore.set('financial-test'); });
afterEach(() => {
  cleanup(); useAuthStore.getState().queryClient.clear(); cancelSessionRequests(); tokenStore.set(null);
  useAuthStore.setState({ status: 'anonymous', user: null, sessionVersion: useAuthStore.getState().sessionVersion + 1 });
  vi.unstubAllGlobals();
});

describe('Reportes financieros Fase 4C', () => {
  it.each(['OWNER', 'RECEPTIONIST'] as const)('%s ve el resumen de cartera calculado por el servidor', async (role) => {
    setup(role);
    expect(await screen.findByText('$300.00 MXN')).toBeInTheDocument();
    expect(screen.getByText('$140.00 MXN')).toBeInTheDocument();
    expect(screen.getByText('$160.00 MXN')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Anulado' })).toBeInTheDocument();
  });

  it.each(['DENTIST', 'PATIENT'] as const)('%s no abre los reportes ni consulta el backend', async (role) => {
    const { requests } = setup(role);
    expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
    expect(requests.some((request) => request.path.startsWith('/api/financial/reports'))).toBe(false);
  });

  it('el cobro por período envía el rango de días y muestra el neto negativo con signo', async () => {
    const { requests } = setup('OWNER');
    await screen.findByText('$300.00 MXN');
    fireEvent.click(screen.getByRole('tab', { name: 'Cobros por período' }));
    await screen.findAllByText('-$5.00 MXN');
    expect(screen.getAllByText('$10.00 MXN').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Desde (fecha de movimiento)'), { target: { value: '2026-10-14' } });
    fireEvent.change(screen.getByLabelText('Hasta (incluye ese día)'), { target: { value: '2026-10-14' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Filtrar cobros por período' }));
    await waitFor(() => expect(requests.some((request) => request.path.startsWith('/api/financial/reports/cash-flow?'))).toBe(true));
    const params = new URL(requests.filter((request) => request.path.startsWith('/api/financial/reports/cash-flow?'))
      .at(-1)!.path, 'http://localhost').searchParams;
    expect(new Date(params.get('to')!).getTime() - new Date(params.get('from')!).getTime()).toBe(86400000);
  });

  it('el reporte de cargos y saldos filtra por paciente y estado reflejados en la consulta', async () => {
    const { requests } = setup('OWNER');
    await screen.findByText('$300.00 MXN');
    fireEvent.click(screen.getByRole('tab', { name: 'Cargos y saldos' }));
    await screen.findByText('Paciente #10');
    fireEvent.focus(screen.getByRole('combobox', { name: 'Paciente (filtro opcional)' }));
    fireEvent.click(await screen.findByRole('option', { name: /Ada Prueba.*Paciente #10/ }));
    fireEvent.change(screen.getByLabelText('Estado del cargo'), { target: { value: 'PARCIAL' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Filtrar cargos y saldos' }));
    await waitFor(() => expect(requests.some((request) => request.path.includes('patientId=10') && request.path.includes('status=PARCIAL'))).toBe(true));
    expect((await screen.findAllByText('$120.00 MXN')).length).toBeGreaterThan(0);
  });

  it('un error del servidor no inventa importes y permite reintentar', async () => {
    setup('OWNER', '/finances/reports', { fail: true });
    expect(await screen.findByText('Reporte financiero rechazado.')).toBeInTheDocument();
    expect(screen.queryByText('$300.00 MXN')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar reporte' })).toBeInTheDocument();
  });

  it.each([['OWNER', true], ['RECEPTIONIST', true], ['DENTIST', false]] as const)(
    'la navegación de %s %s enlaza los reportes financieros', async (role, visible) => {
      setup(role, '/finances');
      await screen.findByRole('heading', { name: 'Finanzas' });
      const nav = screen.getByRole('navigation', { name: 'Navegación de escritorio' });
      if (visible) expect(nav).toHaveTextContent('Reportes financieros');
      else expect(nav).not.toHaveTextContent('Reportes financieros');
    });
});
