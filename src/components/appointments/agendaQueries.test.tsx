import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { appointmentsApi } from '../../api/appointments';
import { checkoutAppointment as a } from '../../test/checkoutFixtures';
import { useAgendaAppointments } from './agendaQueries';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('recorre páginas, deduplica por identidad y ordena sin inventar citas', async () => {
  const list = vi.spyOn(appointmentsApi, 'list').mockImplementation(async ({ page } = {}) => ({
    content: page === 0 ? [{ ...a, id: 8, startAt: '2026-10-22T19:00:00Z' }, a] : [a, { ...a, id: 9 }],
    page: page ?? 0, totalPages: 2, totalElements: 3, size: 2,
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const hook = renderHook(() => useAgendaAppointments({ size: 100 }), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data?.content.map(item => item.id)).toEqual([7, 9, 8]);
  expect(list).toHaveBeenCalledTimes(2);
  expect(list.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
  client.clear();
});
it('cancelar el rango aborta la lectura activa antes de actualizar la caché', async () => {
  let signal: AbortSignal | undefined;
  vi.spyOn(appointmentsApi, 'list').mockImplementation((_params, received) => {
    signal = received;
    return new Promise((_resolve, reject) => received?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderHook(() => useAgendaAppointments({ size: 100 }), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  await waitFor(() => expect(signal).toBeDefined());
  await client.cancelQueries({ queryKey: ['appointments'] });
  expect(signal?.aborted).toBe(true);
  expect(client.getQueryData(['appointments', { size: 100 }])).toBeUndefined();
  client.clear();
});
