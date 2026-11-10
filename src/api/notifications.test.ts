import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, cancelSessionRequests, tokenStore } from './http';
import { notificationsApi, type NotificationDto } from './notifications';
import type { PageDto } from './patients';

const notification: NotificationDto = {
  id: 12,
  title: 'Cita reprogramada',
  body: 'Consulta el nuevo horario.',
  priority: 'NORMAL',
  read: false,
  createdAt: '2026-10-12T09:00:00Z',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  cancelSessionRequests();
  tokenStore.set('notifications-token');
});

afterEach(() => {
  cancelSessionRequests();
  tokenStore.set(null);
  vi.unstubAllGlobals();
});

describe('Notificaciones — cliente HTTP T3.2', () => {
  it('consulta desde cero con los valores predeterminados y codifica page y size', async () => {
    const fetcher = vi.fn(async () => response({ content: [] }));
    vi.stubGlobal('fetch', fetcher);
    await notificationsApi.list();
    await notificationsApi.list({ page: 3, size: 10 });
    await notificationsApi.list({ page: 0, size: 1 });
    await notificationsApi.list({ size: 50 });
    await notificationsApi.list({ page: 2 });
    const requests = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(requests.map(([url, init]) => [url, init.method])).toEqual([
      ['/api/notifications?page=0&size=20', 'GET'],
      ['/api/notifications?page=3&size=10', 'GET'],
      ['/api/notifications?page=0&size=1', 'GET'],
      ['/api/notifications?page=0&size=50', 'GET'],
      ['/api/notifications?page=2&size=20', 'GET'],
    ]);
    expect(requests[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer notifications-token' }, credentials: 'include',
    });
  });

  it('conserva metadatos, orden del backend y campos opcionales ausentes o presentes', async () => {
    const linked: NotificationDto = {
      ...notification,
      id: 13,
      priority: 'HIGH',
      appointmentId: 42,
      relatedType: 'APPOINTMENT',
      relatedId: 42,
      read: true,
      readAt: '2026-10-12T10:00:00Z',
    };
    const page: PageDto<NotificationDto> = {
      content: [linked, notification], page: 2, size: 2, totalElements: 7, totalPages: 4,
    };
    vi.stubGlobal('fetch', vi.fn(async () => response(page)));
    const result = await notificationsApi.list({ page: 2, size: 2 });
    expect(result).toEqual(page);
    for (const field of ['appointmentId', 'relatedType', 'relatedId', 'readAt']) {
      expect(result.content[1]).not.toHaveProperty(field);
    }
  });

  it.each([0, 7])('consulta el contador GET y usa unread=%s', async (unread) => {
    const fetcher = vi.fn(async () => response({ unread }));
    vi.stubGlobal('fetch', fetcher);
    const result = await notificationsApi.unreadCount();
    expect(result).toEqual({ unread });
    expect(result).not.toHaveProperty('count');
    expect(fetcher).toHaveBeenCalledWith('/api/notifications/unread-count', expect.objectContaining({ method: 'GET' }));
  });

  it('marca mediante POST sin cuerpo y conserva el DTO idempotente del servidor', async () => {
    const marked: NotificationDto = { ...notification, read: true, readAt: '2026-10-12T10:00:00Z' };
    const fetcher = vi.fn(async () => response(marked));
    vi.stubGlobal('fetch', fetcher);
    expect(await notificationsApi.markRead(12)).toEqual(marked);
    expect(await notificationsApi.markRead(12)).toEqual(marked);
    const requests = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(requests).toHaveLength(2);
    for (const [url, init] of requests) {
      expect(url).toBe('/api/notifications/12/read');
      expect(init.method).toBe('POST');
      expect(init).not.toHaveProperty('body');
      expect(init.headers).not.toHaveProperty('Content-Type');
    }
  });

  it.each([
    ['listado', () => notificationsApi.list()],
    ['contador', () => notificationsApi.unreadCount()],
    ['marcado', () => notificationsApi.markRead(12)],
  ] as const)('propaga ApiError del cliente central en %s', async (_name, request) => {
    const body = {
      status: 404, error: 'Not Found', message: 'No disponible.',
      path: '/api/notifications', timestamp: '2026-10-12T10:00:00Z',
      fieldErrors: { id: 'Notificación no encontrada.' },
    };
    vi.stubGlobal('fetch', vi.fn(async () => response(body, 404)));
    const result = request();
    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({ status: 404, message: body.message, body, fieldErrors: body.fieldErrors });
  });

  it('propaga el mismo error de red sin envolverlo', async () => {
    const error = new TypeError('Sin conexión');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    await expect(notificationsApi.list()).rejects.toBe(error);
  });
});
