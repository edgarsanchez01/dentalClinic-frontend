import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { notificationsApi, type NotificationDto, type NotificationListParams } from '../../api/notifications';
import type { PageDto } from '../../api/patients';
import { useAuthStore } from '../../app/authStore';

export const notificationKeys = {
  all: (userId: number | null) => ['notifications', userId] as const,
  lists: (userId: number | null) => [...notificationKeys.all(userId), 'list'] as const,
  list: (userId: number | null, { page = 0, size = 20 }: NotificationListParams = {}) =>
    [...notificationKeys.lists(userId), { page, size }] as const,
  unreadCount: (userId: number | null) => [...notificationKeys.all(userId), 'unread-count'] as const,
};

interface NotificationSession {
  userId: number | null;
  sessionVersion: number;
  queryClient: QueryClient;
}

function useNotificationSession(): NotificationSession {
  const userId = useAuthStore((state) => state.status === 'authenticated' ? state.user?.id ?? null : null);
  const sessionVersion = useAuthStore((state) => state.sessionVersion);
  const queryClient = useQueryClient();
  return { userId, sessionVersion, queryClient };
}

function isCurrentSession(session: NotificationSession): boolean {
  const current = useAuthStore.getState();
  return session.userId !== null
    && current.status === 'authenticated'
    && current.user?.id === session.userId
    && current.sessionVersion === session.sessionVersion
    && current.queryClient === session.queryClient;
}

function requireCurrentSession(session: NotificationSession): void {
  if (!isCurrentSession(session)) throw new DOMException('Sesion de notificaciones no vigente', 'AbortError');
}

async function requestForSession<T>(session: NotificationSession, request: () => Promise<T>): Promise<T> {
  requireCurrentSession(session);
  const result = await request();
  requireCurrentSession(session);
  return result;
}

export function useNotifications({ page = 0, size = 20 }: NotificationListParams = {}) {
  const session = useNotificationSession();
  return useQuery({
    queryKey: notificationKeys.list(session.userId, { page, size }),
    queryFn: () => requestForSession(session, () => notificationsApi.list({ page, size })),
    enabled: isCurrentSession(session),
    refetchOnWindowFocus: true,
  });
}

export function useUnreadNotificationCount() {
  const session = useNotificationSession();
  return useQuery({
    queryKey: notificationKeys.unreadCount(session.userId),
    queryFn: () => requestForSession(session, notificationsApi.unreadCount),
    enabled: isCurrentSession(session),
    refetchOnWindowFocus: true,
  });
}

/** Revalida el buzon propio tras eventos locales; una sesion reemplazada no invalida ninguna cache. */
export function useInvalidateNotifications() {
  const session = useNotificationSession();
  return () => {
    if (!isCurrentSession(session)) return Promise.resolve();
    return session.queryClient.invalidateQueries({ queryKey: notificationKeys.all(session.userId) });
  };
}

export function useMarkNotificationRead() {
  const session = useNotificationSession();
  return useMutation({
    onMutate: () => {
      requireCurrentSession(session);
      return session;
    },
    mutationFn: (id: number) => requestForSession(session, () => notificationsApi.markRead(id)),
    onSuccess: async (notification, _id, sessionAtStart) => {
      // El contexto pertenece al inicio de la mutacion, incluso si el hook se vuelve a renderizar.
      if (!sessionAtStart || !isCurrentSession(sessionAtStart)) return;
      const { queryClient, userId } = sessionAtStart;
      const queryKey = notificationKeys.all(userId);
      // Una consulta anterior al POST no debe sobrescribir el DTO recien recibido.
      await queryClient.cancelQueries({ queryKey });
      if (!isCurrentSession(sessionAtStart)) return;
      queryClient.setQueriesData<PageDto<NotificationDto>>(
        { queryKey: notificationKeys.lists(userId) },
        (page) => page ? {
          ...page,
          content: page.content.map((item) => item.id === notification.id ? notification : item),
        } : page,
      );
      // El contador siempre se revalida en el servidor; no se calcula ni se decrementa localmente.
      await queryClient.invalidateQueries({ queryKey });
    },
  });
}
