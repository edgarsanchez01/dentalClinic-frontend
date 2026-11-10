import { focusManager, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserDto } from '../../api/auth';
import { ApiError, cancelSessionRequests, tokenStore } from '../../api/http';
import { notificationsApi, type NotificationDto, type NotificationListParams } from '../../api/notifications';
import type { PageDto } from '../../api/patients';
import { useAuthStore } from '../../app/authStore';
import {
  notificationKeys, useInvalidateNotifications, useMarkNotificationRead, useNotifications, useUnreadNotificationCount,
} from './notificationQueries';

const A: UserDto = { id: 1, email: 'a@example.com', role: 'PATIENT', active: true, createdAt: '2026-01-01' };
const B: UserDto = { ...A, id: 2, email: 'b@example.com' };
const notification: NotificationDto = {
  id: 12, title: 'Cita', body: 'Consulta el horario.', priority: 'NORMAL',
  read: false, createdAt: '2026-10-12T09:00:00Z',
};
const marked: NotificationDto = { ...notification, read: true, readAt: '2026-10-12T10:00:00Z' };

function page(content: NotificationDto[], number = 0): PageDto<NotificationDto> {
  return { content, page: number, size: 20, totalElements: 40, totalPages: 2 };
}

function response(body?: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Replica la frontera de sesion de App sin montar componentes visuales. */
function SessionProvider({ children }: PropsWithChildren) {
  const queryClient = useAuthStore((state) => state.queryClient);
  const sessionVersion = useAuthStore((state) => state.sessionVersion);
  return <QueryClientProvider key={sessionVersion} client={queryClient}>{children}</QueryClientProvider>;
}

function useInbox(params: NotificationListParams = {}) {
  return { list: useNotifications(params), unread: useUnreadNotificationCount(), mark: useMarkNotificationRead() };
}

function mockSessionChange(user = B) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === '/api/auth/logout') return response(undefined, 204);
    if (path === '/api/auth/login') return response({ accessToken: 'token-next', user });
    if (path === '/api/auth/me') return response(user);
    throw new Error(`Sin stub para ${path}`);
  }));
}

beforeEach(() => {
  focusManager.setFocused(false);
  cancelSessionRequests();
  tokenStore.set('token-A');
  useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'authenticated', user: A });
});

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  cancelSessionRequests();
  useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'anonymous', user: null });
  tokenStore.set(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Notificaciones — TanStack Query T3.3', () => {
  it('diferencia usuario, pagina y tamaño y normaliza parametros omitidos en las claves', () => {
    expect(notificationKeys.list(A.id)).toEqual(['notifications', A.id, 'list', { page: 0, size: 20 }]);
    expect(notificationKeys.list(A.id, {})).toEqual(notificationKeys.list(A.id, { page: 0, size: 20 }));
    expect(notificationKeys.list(B.id)).not.toEqual(notificationKeys.list(A.id));
    expect(notificationKeys.list(A.id, { page: 1 })).not.toEqual(notificationKeys.list(A.id));
    expect(notificationKeys.list(A.id, { size: 10 })).not.toEqual(notificationKeys.list(A.id));
    expect(notificationKeys.unreadCount(A.id)).toEqual(['notifications', A.id, 'unread-count']);
    expect(notificationKeys.unreadCount(B.id)).not.toEqual(notificationKeys.unreadCount(A.id));
  });

  it.each(['anonymous', 'restoring'] as const)('no consulta ni permite marcado o refetch manual en estado %s', async (status) => {
    useAuthStore.setState({ status, user: null });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useInbox(), { wrapper: SessionProvider });
    expect(result.current.list.fetchStatus).toBe('idle');
    expect(result.current.unread.fetchStatus).toBe('idle');
    await act(async () => {
      await expect(result.current.list.refetch({ throwOnError: true })).rejects.toMatchObject({ name: 'AbortError' });
      await expect(result.current.unread.refetch({ throwOnError: true })).rejects.toMatchObject({ name: 'AbortError' });
      await expect(result.current.mark.mutateAsync(12)).rejects.toMatchObject({ name: 'AbortError' });
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('consulta listado y contador y mantiene paginas independientes sin datos de la anterior', async () => {
    const pending = deferred<Response>();
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/notifications/unread-count') return response({ unread: 5 });
      if (path === '/api/notifications?page=0&size=20') return response(page([notification]));
      if (path === '/api/notifications?page=1&size=10') return pending.promise;
      throw new Error(`Sin stub para ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const { result, rerender } = renderHook((params: NotificationListParams) => useInbox(params), {
      initialProps: { page: 0, size: 20 }, wrapper: SessionProvider,
    });
    await waitFor(() => expect(result.current.list.isSuccess && result.current.unread.isSuccess).toBe(true));
    expect(result.current.list.data).toEqual(page([notification]));
    expect(result.current.unread.data).toEqual({ unread: 5 });
    rerender({ page: 1, size: 10 });
    expect(result.current.list.data).toBeUndefined();
    const secondPage = { ...page([], 1), size: 10 };
    await act(async () => { pending.resolve(response(secondPage)); });
    await waitFor(() => expect(result.current.list.data).toEqual(secondPage));
    const client = useAuthStore.getState().queryClient;
    expect(client.getQueryData(notificationKeys.list(A.id))).toEqual(page([notification]));
    expect(client.getQueryData(notificationKeys.list(A.id, { page: 1, size: 10 }))).toEqual(secondPage);
  });

  it('reemplaza por el DTO recibido en todas las paginas propias e invalida listado y contador', async () => {
    const client = useAuthStore.getState().queryClient;
    const firstKey = notificationKeys.list(A.id);
    const secondKey = notificationKeys.list(A.id, { page: 1 });
    const otherKey = notificationKeys.list(B.id);
    const otherNotification = { ...notification, id: 11 };
    const old = { ...notification, relatedType: 'OLD' };
    client.setQueryData(firstKey, page([old, otherNotification]));
    client.setQueryData(secondKey, page([otherNotification, old], 1));
    client.setQueryData(otherKey, page([notification]));
    client.setQueryData(notificationKeys.unreadCount(A.id), { unread: 9 });
    client.setQueryData(notificationKeys.unreadCount(B.id), { unread: 8 });
    client.setQueryData(['appointments'], 'independiente');
    vi.stubGlobal('fetch', vi.fn(async () => response(marked)));
    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper: SessionProvider });
    await act(async () => { expect(await result.current.mutateAsync(12)).toEqual(marked); });
    expect(client.getQueryData(firstKey)).toEqual(page([marked, otherNotification]));
    expect(client.getQueryData(secondKey)).toEqual(page([otherNotification, marked], 1));
    expect(client.getQueryState(firstKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(secondKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(notificationKeys.unreadCount(A.id))?.isInvalidated).toBe(true);
    expect(client.getQueryData(notificationKeys.unreadCount(A.id))).toEqual({ unread: 9 });
    expect(client.getQueryData(otherKey)).toEqual(page([notification]));
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
    expect(client.getQueryData(notificationKeys.unreadCount(B.id))).toEqual({ unread: 8 });
    expect(client.getQueryState(notificationKeys.unreadCount(B.id))?.isInvalidated).toBe(false);
    expect(client.getQueryState(['appointments'])?.isInvalidated).toBe(false);
  });

  it('reconsulta los datos activos y sincroniza unread real incluso al repetir el marcado', async () => {
    let read = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/notifications/12/read') { read = true; return response(marked); }
      if (path === '/api/notifications/unread-count') return response({ unread: read ? 2 : 5 });
      if (path === '/api/notifications?page=0&size=20') return response(page([read ? marked : notification]));
      throw new Error(`Sin stub para ${path}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useInbox(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.unread.data?.unread).toBe(5));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await act(async () => { expect(await result.current.mark.mutateAsync(12)).toEqual(marked); });
      await waitFor(() => {
        expect(result.current.unread.data).toEqual({ unread: 2 });
        expect(result.current.list.data).toEqual(page([marked]));
      });
    }
    const paths = fetcher.mock.calls.map(([input]) => String(input));
    expect(paths.filter((path) => path === '/api/notifications/unread-count')).toHaveLength(3);
    expect(paths.filter((path) => path === '/api/notifications?page=0&size=20')).toHaveLength(3);
    expect(paths.filter((path) => path === '/api/notifications/12/read')).toHaveLength(2);
  });

  it('una consulta en vuelo anterior al POST no sobrescribe el marcado al llegar tarde', async () => {
    const pending = deferred<Response>();
    let lists = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === '/api/notifications/12/read') return response(marked);
      lists += 1;
      return lists === 1 ? pending.promise : response(page([marked]));
    }));
    const { result } = renderHook(() => ({ list: useNotifications(), mark: useMarkNotificationRead() }), { wrapper: SessionProvider });
    await waitFor(() => expect(lists).toBe(1));
    await act(async () => { await result.current.mark.mutateAsync(12); });
    await waitFor(() => expect(result.current.list.data).toEqual(page([marked])));
    await act(async () => { pending.resolve(response(page([notification]))); });
    expect(result.current.list.data).toEqual(page([marked]));
    expect(lists).toBe(2);
  });

  it('propaga errores del marcado sin modificar ni invalidar los datos cacheados', async () => {
    const client = useAuthStore.getState().queryClient;
    client.setQueryData(notificationKeys.list(A.id), page([notification]));
    client.setQueryData(notificationKeys.unreadCount(A.id), { unread: 5 });
    vi.stubGlobal('fetch', vi.fn(async () => response({ message: 'No encontrada.' }, 404)));
    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper: SessionProvider });
    await act(async () => {
      await expect(result.current.mutateAsync(12)).rejects.toBeInstanceOf(ApiError);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(notificationKeys.list(A.id))).toEqual(page([notification]));
    expect(client.getQueryData(notificationKeys.unreadCount(A.id))).toEqual({ unread: 5 });
    expect(client.getQueryState(notificationKeys.list(A.id))?.isInvalidated).toBe(false);
    expect(client.getQueryState(notificationKeys.unreadCount(A.id))?.isInvalidated).toBe(false);
  });

  it.each(['listado', 'contador', 'marcado'] as const)('descarta %s tardio de A tras login B aunque fetch ignore abort', async (endpoint) => {
    const pending = deferred<Response>();
    const calls: { path: string; signal: AbortSignal | null | undefined }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/auth/login') return response({ accessToken: 'token-B', user: B });
      if (path === '/api/auth/me') return response(B);
      if (path === '/api/auth/logout') return response(undefined, 204);
      const isA = (init?.headers as Record<string, string>).Authorization === 'Bearer token-A';
      calls.push({ path, signal: init?.signal });
      if (isA && ((endpoint === 'listado' && path.includes('?'))
        || (endpoint === 'contador' && path.endsWith('unread-count'))
        || (endpoint === 'marcado' && path.endsWith('/read')))) return pending.promise;
      if (path.endsWith('unread-count')) return response({ unread: isA ? 5 : 8 });
      return response(page([{ ...notification, title: isA ? 'A' : 'B' }]));
    }));
    const { result } = renderHook(() => useInbox(), { wrapper: SessionProvider });
    let assertion: Promise<unknown> | undefined;
    if (endpoint === 'marcado') {
      act(() => { assertion = expect(result.current.mark.mutateAsync(12)).rejects.toMatchObject({ name: 'AbortError' }); });
    }
    const expectedPath = endpoint === 'listado' ? '/api/notifications?page=0&size=20'
      : endpoint === 'contador' ? '/api/notifications/unread-count' : '/api/notifications/12/read';
    await waitFor(() => expect(calls.some(({ path }) => path === expectedPath)).toBe(true));
    const oldClient = useAuthStore.getState().queryClient;
    const oldSignal = calls.find(({ path }) => path === expectedPath)?.signal;
    await act(() => useAuthStore.getState().login(B.email, 'password'));
    await waitFor(() => {
      expect(result.current.list.data?.content[0]?.title).toBe('B');
      expect(result.current.unread.data?.unread).toBe(8);
    });
    const currentClient = useAuthStore.getState().queryClient;
    const invalidate = vi.spyOn(currentClient, 'invalidateQueries');
    await act(async () => {
      pending.resolve(response(endpoint === 'listado' ? page([notification]) : endpoint === 'contador' ? { unread: 5 } : marked));
      await assertion;
    });
    expect(oldSignal?.aborted).toBe(true);
    expect(oldClient.getQueryCache().getAll()).toHaveLength(0);
    expect(currentClient).not.toBe(oldClient);
    expect(result.current.list.data?.content[0]?.title).toBe('B');
    expect(result.current.unread.data?.unread).toBe(8);
    expect(invalidate).not.toHaveBeenCalled();
    expect(currentClient.getQueryData(notificationKeys.list(A.id))).toBeUndefined();
  });

  it('rechaza un marcado tardio incluso tras volver a entrar con el mismo usuario', async () => {
    const pending = deferred<NotificationDto>();
    // Sustituye solo el API para verificar la frontera de sesion adicional a apiFetch.
    vi.spyOn(notificationsApi, 'markRead').mockReturnValue(pending.promise);
    mockSessionChange(A);
    const { result } = renderHook(() => useMarkNotificationRead(), { wrapper: SessionProvider });
    const oldMutate = result.current.mutateAsync;
    let assertion!: Promise<unknown>;
    act(() => { assertion = expect(oldMutate(12)).rejects.toMatchObject({ name: 'AbortError' }); });
    await waitFor(() => expect(notificationsApi.markRead).toHaveBeenCalledTimes(1));
    const oldClient = useAuthStore.getState().queryClient;
    const oldVersion = useAuthStore.getState().sessionVersion;
    await act(() => useAuthStore.getState().logout());
    await act(() => useAuthStore.getState().login(A.email, 'password'));
    const client = useAuthStore.getState().queryClient;
    client.setQueryData(notificationKeys.list(A.id), page([notification]));
    client.setQueryData(notificationKeys.unreadCount(A.id), { unread: 4 });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await act(async () => { pending.resolve(marked); await assertion; });
    expect(useAuthStore.getState().sessionVersion).toBeGreaterThan(oldVersion);
    expect(client.getQueryData(notificationKeys.list(A.id))).toEqual(page([notification]));
    expect(client.getQueryData(notificationKeys.unreadCount(A.id))).toEqual({ unread: 4 });
    expect(oldClient.getQueryCache().getAll()).toHaveLength(0);
    expect(invalidate).not.toHaveBeenCalled();
    await act(async () => {
      await expect(oldMutate(12)).rejects.toMatchObject({ name: 'AbortError' });
    });
    expect(notificationsApi.markRead).toHaveBeenCalledTimes(1);
  });
});

describe('Notificaciones — actualizacion local y al regresar T3.7/T3.9', () => {
  it('refresca listado y contador activos al regresar sin duplicar observadores ni cambiar defaults globales', async () => {
    focusManager.setFocused(undefined);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    let version = 1;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('unread-count')
      ? response({ unread: version }) : response(page([{ ...notification, title: `Aviso ${version}` }])));
    const unrelated = vi.fn(async () => 'citas');
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => ({
      inbox: useInbox(), secondCounter: useUnreadNotificationCount(),
      appointments: useQuery({ queryKey: ['appointments'], queryFn: unrelated }),
    }), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.inbox.list.isSuccess && result.current.inbox.unread.isSuccess).toBe(true));
    expect(fetcher).toHaveBeenCalledTimes(2);
    version = 2;
    await act(async () => { window.dispatchEvent(new Event('visibilitychange')); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => {
      visibility.mockReturnValue('visible');
      window.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => {
      expect(result.current.inbox.list.data?.content[0]?.title).toBe('Aviso 2');
      expect(result.current.inbox.unread.data?.unread).toBe(2);
      expect(result.current.secondCounter.data?.unread).toBe(2);
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(unrelated).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });

  it.each(['anonymous', 'restoring'] as const)('regresar en estado %s no dispara peticiones', async (status) => {
    useAuthStore.setState({ status, user: null });
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    renderHook(() => useInbox(), { wrapper: SessionProvider });
    await act(async () => { focusManager.setFocused(true); });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('logout limpia el buzon y respuestas del refetch anterior no contaminan a B', async () => {
    const pendingList = deferred<Response>();
    const pendingCount = deferred<Response>();
    let refreshing = false;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/auth/logout') return response(undefined, 204);
      if (path === '/api/auth/login') return response({ accessToken: 'token-B', user: B });
      if (path === '/api/auth/me') return response(B);
      const isA = (init?.headers as Record<string, string>).Authorization === 'Bearer token-A';
      if (isA && refreshing) return path.endsWith('unread-count') ? pendingCount.promise : pendingList.promise;
      return path.endsWith('unread-count') ? response({ unread: isA ? 5 : 8 })
        : response(page([{ ...notification, title: isA ? 'Aviso A' : 'Aviso B' }]));
    });
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() => useInbox(), { wrapper: SessionProvider });
    await waitFor(() => expect(result.current.list.isSuccess && result.current.unread.isSuccess).toBe(true));
    const oldClient = useAuthStore.getState().queryClient;
    refreshing = true;
    await act(async () => { focusManager.setFocused(true); });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    await act(() => useAuthStore.getState().logout());
    expect(oldClient.getQueryCache().getAll()).toHaveLength(0);
    expect(result.current.list.data).toBeUndefined();
    expect(result.current.unread.data).toBeUndefined();
    const requestsAtLogout = fetcher.mock.calls.length;
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    expect(fetcher).toHaveBeenCalledTimes(requestsAtLogout);
    await act(() => useAuthStore.getState().login(B.email, 'password'));
    await waitFor(() => {
      expect(result.current.list.data?.content[0]?.title).toBe('Aviso B');
      expect(result.current.unread.data?.unread).toBe(8);
    });
    await act(async () => {
      pendingList.resolve(response(page([notification])));
      pendingCount.resolve(response({ unread: 0 }));
    });
    expect(result.current.list.data?.content[0]?.title).toBe('Aviso B');
    expect(result.current.unread.data?.unread).toBe(8);
    expect(oldClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it.each([A, B])('la invalidacion capturada no afecta a una nueva sesion del usuario $id', async (user) => {
    mockSessionChange(user);
    const { result } = renderHook(() => useInvalidateNotifications(), { wrapper: SessionProvider });
    const invalidateOldSession = result.current;
    const oldClient = useAuthStore.getState().queryClient;
    const oldInvalidate = vi.spyOn(oldClient, 'invalidateQueries');
    await act(() => useAuthStore.getState().logout());
    await act(() => useAuthStore.getState().login(user.email, 'password'));
    const currentClient = useAuthStore.getState().queryClient;
    const currentInvalidate = vi.spyOn(currentClient, 'invalidateQueries');
    await act(() => invalidateOldSession());
    expect(oldInvalidate).not.toHaveBeenCalled();
    expect(currentInvalidate).not.toHaveBeenCalled();
    await act(() => result.current());
    expect(currentInvalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: notificationKeys.all(user.id) });
  });
});
