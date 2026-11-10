import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ApiError } from '../../api/http';
import { financialIntentsApi, type FinancialIntentView } from '../../api/financialIntents';
import { useAuthStore } from '../../app/authStore';
import { useFinancialOperation } from './useFinancialOperation';

let client: QueryClient;
const OP = 'FIN_REGISTER_PAYMENT';
const payload = { amount: '10.00', method: 'CASH' as const, reason: null };
const command = (input: typeof payload) => ({ ...input, chargeId: 7 });
const view = (key: string, state: FinancialIntentView['state'] = 'REGISTERED'): FinancialIntentView => ({
  operation: OP, intentId: key, state, registeredAt: '2026-10-27T00:00:00Z', ...(state === 'CONFIRMED' ? { effect: { chargeId: 7, movementId: 9 } } : {}),
  ...(['REJECTED', 'ABANDONED'].includes(state) ? { closedAt: '2026-10-27T00:00:01Z' } : {}),
  ...(state === 'REJECTED' ? { rejectedAttemptAt: '2026-10-27T00:00:01Z', rejection: { code: 'PAYMENT_EXCEEDS_BALANCE', httpStatus: 409 } } : {}),
});
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ queryClient: client, status: 'authenticated', user: { id: 1, role: 'OWNER', email: 'owner@dc.test', active: true, createdAt: '2026-01-01' } });
  vi.spyOn(financialIntentsApi, 'register').mockImplementation(async (_op, key) => view(key));
  vi.spyOn(financialIntentsApi, 'execute').mockImplementation(async (_op, key) => view(key, 'CONFIRMED'));
  vi.spyOn(financialIntentsApi, 'get').mockImplementation(async (_op, key) => view(key));
  vi.spyOn(financialIntentsApi, 'abandon').mockImplementation(async (_op, key) => view(key, 'ABANDONED'));
});
afterEach(() => { cleanup(); client.clear(); useAuthStore.setState({ user: null, status: 'anonymous' }); vi.restoreAllMocks(); });
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

it('registra antes de ejecutar con la misma identidad y solo tras un submit explicito', async () => {
  const saved = vi.fn(async () => undefined);
  const { result } = renderHook(() => useFinancialOperation('pay', OP, command, saved), { wrapper });
  expect(financialIntentsApi.register).not.toHaveBeenCalled(); expect(financialIntentsApi.execute).not.toHaveBeenCalled();
  await act(async () => { await result.current.submit(payload); });
  const key = vi.mocked(financialIntentsApi.register).mock.calls[0]![1];
  expect(financialIntentsApi.register).toHaveBeenCalledWith(OP, key, command(payload));
  expect(financialIntentsApi.execute).toHaveBeenCalledWith(OP, key);
  expect(vi.mocked(financialIntentsApi.register).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(financialIntentsApi.execute).mock.invocationCallOrder[0]!);
  expect(result.current.intent?.phase).toBe('confirmed'); expect(result.current.intent?.payload).toBeUndefined();
  expect(saved).toHaveBeenCalledTimes(1);
});

it('invalida reportes solo tras confirmar y reintenta lectura sin otro POST', async () => {
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const saved = vi.fn().mockRejectedValueOnce(new Error('Lectura no disponible')).mockResolvedValue(undefined);
  const { result } = renderHook(() => useFinancialOperation('pay', OP, command, saved), { wrapper });
  await act(async () => { await result.current.submit(payload); });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financial-report'] });
  expect(result.current.intent?.phase).toBe('confirmed');
  await act(async () => { await result.current.retryRead(); });
  expect(financialIntentsApi.execute).toHaveBeenCalledTimes(1); expect(saved).toHaveBeenCalledTimes(2);
});

it.each([400, 401, 403, 404, 409, 408, 429, 500, 503, 504])('HTTP %s no inventa REJECTED ni permite otra identidad', async status => {
  vi.mocked(financialIntentsApi.execute).mockRejectedValue(new ApiError(status, null, 'fallo'));
  vi.mocked(financialIntentsApi.get).mockRejectedValue(new Error('consulta fallida'));
  const { result } = renderHook(() => useFinancialOperation('pay', OP, command, vi.fn()), { wrapper });
  await act(async () => { await result.current.submit(payload); });
  expect(result.current.intent?.phase).toBe('uncertain');
  await act(async () => { result.current.startNew(); await result.current.submit({ ...payload, amount: '20.00' }); });
  expect(financialIntentsApi.register).toHaveBeenCalledTimes(1); expect(financialIntentsApi.execute).toHaveBeenCalledTimes(1);
});

it('consulta tras respuesta perdida puede acreditar CONFIRMED sin reejecutar', async () => {
  vi.mocked(financialIntentsApi.execute).mockRejectedValue(new Error('red'));
  vi.mocked(financialIntentsApi.get).mockImplementation(async (_op, key) => view(key, 'CONFIRMED'));
  const saved = vi.fn();
  const { result } = renderHook(() => useFinancialOperation('pay', OP, command, saved), { wrapper });
  await act(async () => { await result.current.submit(payload); });
  expect(result.current.intent?.phase).toBe('confirmed'); expect(saved).toHaveBeenCalledTimes(1);
  expect(financialIntentsApi.execute).toHaveBeenCalledTimes(1);
});

it.each(['REJECTED', 'ABANDONED'] as const)('solo DTO autoritativo acredita %s y habilita una solicitud nueva explicita', async state => {
  vi.mocked(financialIntentsApi.execute).mockRejectedValue(new ApiError(409, null, 'conflicto'));
  vi.mocked(financialIntentsApi.get).mockImplementation(async (_op, key) => view(key, state));
  const { result } = renderHook(() => useFinancialOperation('pay', OP, command, vi.fn()), { wrapper });
  await act(async () => { await result.current.submit(payload); });
  const key = result.current.intent!.key;
  expect(result.current.intent?.phase).toBe(state.toLowerCase());
  await act(async () => { result.current.startNew(); });
  await waitFor(() => expect(result.current.intent).toBeNull());
  await act(async () => { await result.current.submit(payload); });
  expect(result.current.intent?.key).not.toBe(key);
});

it('registro perdido se reintenta con el mismo comando/UUID y nunca ejecuta al recuperarlo', async () => {
  vi.mocked(financialIntentsApi.register).mockRejectedValueOnce(new Error('red'));
  vi.mocked(financialIntentsApi.get).mockRejectedValueOnce(new ApiError(404, null, 'ausente'));
  const { result } = renderHook(() => useFinancialOperation('pay', OP, command, vi.fn()), { wrapper });
  await act(async () => { await result.current.submit(payload); });
  expect(result.current.intent?.registrationMissing).toBe(true);
  await act(async () => { await result.current.retryRegistration(); });
  expect(vi.mocked(financialIntentsApi.register).mock.calls[1]).toEqual(vi.mocked(financialIntentsApi.register).mock.calls[0]);
  expect(financialIntentsApi.execute).not.toHaveBeenCalled();
  expect(result.current.intent?.phase).toBe('registered');
  await act(async () => { await result.current.resume(); });
  expect(financialIntentsApi.execute).toHaveBeenCalledTimes(1);
});

it('montar una intención recuperada solo prepara presentación; consultar no la ejecuta', async () => {
  const recovered = view('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
  const { result, unmount } = renderHook(() => useFinancialOperation('recovery', OP, command, vi.fn(), 'write', recovered), { wrapper });
  await act(async () => { await result.current.consult(); });
  expect(financialIntentsApi.register).not.toHaveBeenCalled(); expect(financialIntentsApi.execute).not.toHaveBeenCalled();
  expect(result.current.intent?.phase).toBe('registered');
  unmount();
  renderHook(() => useFinancialOperation('recovery', OP, command, vi.fn(), 'write', recovered), { wrapper });
  expect(financialIntentsApi.execute).not.toHaveBeenCalled();
});

it.each(['usuario', 'rol', 'version', 'cache', 'logout'])('ignora respuesta tardía y no encadena execute tras cambiar %s', async boundary => {
  let resolve!: (value: FinancialIntentView) => void;
  vi.mocked(financialIntentsApi.register).mockImplementation(() => new Promise(done => { resolve = done; }));
  const saved = vi.fn();
  const { result } = renderHook(() => useFinancialOperation('late', OP, command, saved), { wrapper });
  let pending!: Promise<void>;
  act(() => { pending = result.current.submit(payload); });
  await waitFor(() => expect(financialIntentsApi.register).toHaveBeenCalledTimes(1));
  const key = vi.mocked(financialIntentsApi.register).mock.calls[0]![1];
  const before = useAuthStore.getState();
  act(() => useAuthStore.setState(boundary === 'usuario' ? { user: { ...before.user!, id: 2 } }
    : boundary === 'rol' ? { user: { ...before.user!, role: 'RECEPTIONIST' } }
      : boundary === 'version' ? { sessionVersion: before.sessionVersion + 1 }
        : boundary === 'cache' ? { queryClient: new QueryClient() } : { status: 'anonymous', user: null }));
  await act(async () => { resolve(view(key)); await pending; });
  expect(financialIntentsApi.execute).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
  expect(result.current.intent).toBeNull();
});

it('un callback anterior no sustituye una solicitud incierta y un doble submit no duplica', async () => {
  vi.mocked(financialIntentsApi.execute).mockRejectedValue(new Error('red'));
  vi.mocked(financialIntentsApi.get).mockRejectedValue(new Error('red'));
  const { result } = renderHook(() => useFinancialOperation('pay', OP, command, vi.fn()), { wrapper });
  const oldSubmit = result.current.submit;
  await act(async () => { await Promise.all([oldSubmit(payload), oldSubmit(payload)]); });
  await act(async () => { await oldSubmit({ ...payload, amount: '20.00' }); });
  expect(financialIntentsApi.register).toHaveBeenCalledTimes(1);
});

it.each(['usuario', 'version', 'logout'])('una respuesta execute tardia no consulta ni aplica resultados tras cambiar %s', async boundary => {
  let resolve!: (value: FinancialIntentView) => void;
  vi.mocked(financialIntentsApi.execute).mockImplementation(() => new Promise(done => { resolve = done; }));
  const saved = vi.fn();
  const { result } = renderHook(() => useFinancialOperation('late-execute', OP, command, saved), { wrapper });
  let pending!: Promise<void>;
  act(() => { pending = result.current.submit(payload); });
  await waitFor(() => expect(financialIntentsApi.execute).toHaveBeenCalledTimes(1));
  const key = vi.mocked(financialIntentsApi.execute).mock.calls[0]![1];
  const before = useAuthStore.getState();
  act(() => useAuthStore.setState(boundary === 'usuario' ? { user: { ...before.user!, id: 2 } }
    : boundary === 'version' ? { sessionVersion: before.sessionVersion + 1 } : { status: 'anonymous', user: null }));
  await act(async () => { resolve(view(key, 'CONFIRMED')); await pending; });
  expect(saved).not.toHaveBeenCalled(); expect(financialIntentsApi.get).not.toHaveBeenCalled();
  expect(result.current.intent).toBeNull();
});

it('una consulta antigua REGISTERED no degrada un resultado terminal ya acreditado', async () => {
  const saved = vi.fn();
  const { result } = renderHook(() => useFinancialOperation('pay', OP, command, saved), { wrapper });
  await act(async () => { await result.current.submit(payload); });
  await act(async () => { await result.current.consult(); });
  expect(result.current.intent?.phase).toBe('confirmed'); expect(saved).toHaveBeenCalledTimes(1);
  expect(financialIntentsApi.execute).toHaveBeenCalledTimes(1);
});

it('un startNew de un render anterior no borra ni sustituye otra solicitud incierta', async () => {
  const { result } = renderHook(() => useFinancialOperation('pay', OP, command, vi.fn()), { wrapper });
  await act(async () => { await result.current.submit(payload); });
  const staleReset = result.current.startNew;
  await act(async () => { result.current.startNew(); });
  await waitFor(() => expect(result.current.intent).toBeNull());
  vi.mocked(financialIntentsApi.execute).mockRejectedValue(new Error('red'));
  vi.mocked(financialIntentsApi.get).mockRejectedValue(new Error('red'));
  await act(async () => { await result.current.submit(payload); });
  const key = result.current.intent!.key;
  act(() => staleReset());
  expect(result.current.intent?.phase).toBe('uncertain'); expect(result.current.intent?.key).toBe(key);
});
