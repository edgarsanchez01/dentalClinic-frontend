import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { financialIntentsApi, type FinancialIntentView } from '../../api/financialIntents';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import { FinancialRecovery } from './FinancialRecovery';

const NOW = '2026-10-27T00:00:00Z';
const KEY = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const registered: FinancialIntentView = { operation: 'FIN_REGISTER_PAYMENT', intentId: KEY, state: 'REGISTERED', registeredAt: NOW };
const confirmed: FinancialIntentView = { ...registered, state: 'CONFIRMED', effect: { chargeId: 7, movementId: 9 } };
let client: QueryClient;
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ queryClient: client, status: 'authenticated', user: { id: 1, role: 'OWNER', email: 'owner@test', active: true, createdAt: NOW } });
  vi.spyOn(financialIntentsApi, 'list').mockResolvedValue({ items: [registered] });
  vi.spyOn(financialIntentsApi, 'get').mockResolvedValue(registered);
  vi.spyOn(financialIntentsApi, 'register').mockResolvedValue(registered);
  vi.spyOn(financialIntentsApi, 'execute').mockResolvedValue(confirmed);
  vi.spyOn(financialIntentsApi, 'abandon').mockResolvedValue({ ...registered, state: 'ABANDONED', closedAt: NOW });
});
afterEach(() => { cleanup(); client.clear(); useAuthStore.getState().queryClient.clear(); useAuthStore.setState({ user: null, status: 'anonymous' }); vi.restoreAllMocks(); });
function mount() {
  return render(<QueryClientProvider client={client}><MemoryRouter><FinancialRecovery /></MemoryRouter></QueryClientProvider>);
}
async function open() {
  fireEvent.click(screen.getByText(/Revisar pendientes y recientes/));
  await screen.findByRole('button', { name: 'Revisar operación' });
  fireEvent.click(screen.getByRole('button', { name: 'Revisar operación' }));
  return screen.getByRole('region', { name: 'Operación recuperada' });
}

it.each(['OWNER', 'RECEPTIONIST'] as const)('%s descubre pendientes solo por GET; revisar no hace POST', async role => {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, role } });
  mount(); await open();
  expect(financialIntentsApi.list).toHaveBeenCalledWith('pending', undefined, expect.any(AbortSignal));
  expect(financialIntentsApi.register).not.toHaveBeenCalled(); expect(financialIntentsApi.execute).not.toHaveBeenCalled();
  expect(financialIntentsApi.abandon).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Consultar operación' }));
  await waitFor(() => expect(financialIntentsApi.get).toHaveBeenCalledWith('FIN_REGISTER_PAYMENT', KEY));
  expect(financialIntentsApi.execute).not.toHaveBeenCalled();
});

it.each(['DENTIST', 'PATIENT'] as const)('%s no descubre ni presenta intenciones financieras', role => {
  useAuthStore.setState({ user: { ...useAuthStore.getState().user!, role } });
  mount();
  expect(screen.queryByRole('region', { name: 'Recuperación de operaciones financieras' })).not.toBeInTheDocument();
  expect(financialIntentsApi.list).not.toHaveBeenCalled();
});

it('reanudar requiere confirmacion explicita y usa la misma identidad sin reconstruir comando', async () => {
  mount(); const region = await open();
  fireEvent.click(within(region).getByRole('button', { name: 'Reanudar operación' }));
  expect(financialIntentsApi.execute).not.toHaveBeenCalled();
  fireEvent.click(within(region).getByRole('button', { name: 'Confirmar reanudación' }));
  await waitFor(() => expect(within(region).getByText('Confirmada', { exact: true })).toBeInTheDocument());
  expect(financialIntentsApi.execute).toHaveBeenCalledExactlyOnceWith('FIN_REGISTER_PAYMENT', KEY);
  expect(financialIntentsApi.register).not.toHaveBeenCalled();
  expect(within(region).getByRole('link')).toHaveAttribute('href', '/finances/7');
  expect(within(region).queryByRole('button', { name: 'Reanudar operación' })).not.toBeInTheDocument();
  expect(within(region).queryByRole('button', { name: 'Preparar una nueva solicitud' })).not.toBeInTheDocument();
});

it('abandono se confirma sin producir otro efecto y no ofrece reanudar al terminar', async () => {
  mount(); const region = await open();
  fireEvent.click(within(region).getByRole('button', { name: 'Abandonar operación' }));
  expect(financialIntentsApi.abandon).not.toHaveBeenCalled();
  fireEvent.click(within(region).getByRole('button', { name: 'Confirmar abandono' }));
  await waitFor(() => expect(within(region).getByText('Abandonada sin efecto', { exact: true })).toBeInTheDocument());
  expect(financialIntentsApi.abandon).toHaveBeenCalledExactlyOnceWith('FIN_REGISTER_PAYMENT', KEY);
  expect(financialIntentsApi.execute).not.toHaveBeenCalled();
  expect(within(region).queryByRole('button', { name: 'Reanudar operación' })).not.toBeInTheDocument();
});

it.each([403, 404, 409, 503])('consulta HTTP %s no inventa rechazo ni confirmacion', async status => {
  vi.mocked(financialIntentsApi.get).mockRejectedValue(new ApiError(status, null, 'fallo'));
  mount(); const region = await open();
  fireEvent.click(within(region).getByRole('button', { name: 'Consultar operación' }));
  await waitFor(() => expect(within(region).getByText('Resultado incierto')).toBeInTheDocument());
  expect(within(region).queryByRole('button', { name: 'Reanudar operación' })).not.toBeInTheDocument();
  expect(within(region).queryByText('Rechazada sin efecto')).not.toBeInTheDocument();
  expect(financialIntentsApi.execute).not.toHaveBeenCalled();
});

it('recupera tras remonte con cache vacia sin conservar comandos ni UUID en storage/history', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  const push = vi.spyOn(history, 'pushState');
  const replace = vi.spyOn(history, 'replaceState');
  const first = mount(); await open(); first.unmount(); client.clear();
  mount(); await open();
  expect(financialIntentsApi.list).toHaveBeenCalledTimes(2);
  expect(financialIntentsApi.register).not.toHaveBeenCalled(); expect(financialIntentsApi.execute).not.toHaveBeenCalled();
  expect(storage).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  expect(location.href).not.toContain(KEY);
  expect(screen.getByRole('region', { name: 'Operación recuperada' }).textContent).not.toContain(KEY);
});

it('cursor y filtro quedan solo en memoria, con consultas explicitas y sin POST', async () => {
  vi.mocked(financialIntentsApi.list).mockImplementation(async (filter, cursor) => ({ items: [registered], ...(!cursor && filter === 'pending' ? { nextCursor: 'opaque-cursor' } : {}) }));
  mount(); await open();
  fireEvent.click(screen.getByRole('button', { name: 'Más operaciones' }));
  await waitFor(() => expect(financialIntentsApi.list).toHaveBeenCalledWith('pending', 'opaque-cursor', expect.any(AbortSignal)));
  fireEvent.change(screen.getByLabelText('Mostrar operaciones'), { target: { value: 'recent' } });
  await waitFor(() => expect(financialIntentsApi.list).toHaveBeenCalledWith('recent', undefined, expect.any(AbortSignal)));
  expect(location.search).toBe(''); expect(financialIntentsApi.execute).not.toHaveBeenCalled();
});

it('logout oculta la presentacion aunque una consulta tardia ignore abort', async () => {
  let resolve!: (value: { items: FinancialIntentView[] }) => void;
  vi.mocked(financialIntentsApi.list).mockImplementation(() => new Promise(done => { resolve = done; }));
  mount();
  await waitFor(() => expect(financialIntentsApi.list).toHaveBeenCalledTimes(1));
  act(() => useAuthStore.setState({ user: null, status: 'anonymous', sessionVersion: useAuthStore.getState().sessionVersion + 1, queryClient: new QueryClient() }));
  await act(async () => { resolve({ items: [registered] }); });
  expect(screen.queryByText('Tus operaciones financieras')).not.toBeInTheDocument();
  expect(useAuthStore.getState().queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(financialIntentsApi.execute).not.toHaveBeenCalled();
});
