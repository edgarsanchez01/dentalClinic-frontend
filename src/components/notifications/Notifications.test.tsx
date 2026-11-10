import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelSessionRequests, tokenStore } from '../../api/http';
import type { NotificationDto } from '../../api/notifications';
import type { PageDto } from '../../api/patients';
import { useAuthStore } from '../../app/authStore';
import { NotificationBell } from './NotificationBell';
import { NotificationsPage } from './NotificationsPage';
import { notificationKeys } from './notificationQueries';

const FIRST: NotificationDto = {
  id: 22, title: 'Cita reprogramada', body: '<strong>Consulta el nuevo horario.</strong>\nSegunda línea.',
  priority: 'HIGH', read: false, createdAt: '2026-10-12T09:00:00Z',
};
const SECOND: NotificationDto = { ...FIRST, id: 21, title: 'Aviso anterior', body: 'Ya revisado.', priority: 'NORMAL', read: true };
const MARKED: NotificationDto = { ...FIRST, read: true, readAt: '2026-10-12T10:00:00Z' };

function page(content = [FIRST, SECOND], number = 0, totalPages = 1): PageDto<NotificationDto> {
  return { content, page: number, size: 20, totalElements: content.length, totalPages };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mockInbox(handler?: (path: string, init?: RequestInit) => Response | Promise<Response> | undefined) {
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path === '/api/availability/policy') return response({ timezone: 'America/Mexico_City' });
    const custom = handler?.(path, init);
    if (custom) return custom;
    if (path === '/api/notifications/unread-count') return response({ unread: 5 });
    if (path.startsWith('/api/notifications?')) return response(page());
    throw new Error(`Sin stub para ${path}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

function renderInbox(initialPath = '/notifications') {
  return render(
    <QueryClientProvider client={useAuthStore.getState().queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <NotificationBell />
        <Routes>
          <Route path="/" element={<p>Inicio</p>} />
          <Route path="/notifications" element={<NotificationsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cancelSessionRequests();
  tokenStore.set('notification-ui');
  useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'authenticated', user: {
    id: 1, email: 'test@clinic.com', role: 'PATIENT', active: true, createdAt: '2026-01-01',
  } });
});

afterEach(() => {
  cleanup();
  cancelSessionRequests();
  useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'anonymous', user: null });
  tokenStore.set(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Campanita de notificaciones', () => {
  it('no muestra cero durante la carga y tiene enlace accesible y tamaño táctil', async () => {
    const pending = deferred<Response>();
    mockInbox(() => pending.promise);
    renderInbox('/');
    const bell = screen.getByRole('link', { name: 'Notificaciones: cargando contador' });
    expect(bell).toHaveAttribute('href', '/notifications');
    expect(bell).toHaveClass('min-h-11', 'min-w-11', 'focus-visible:ring-2');
    expect(within(bell).queryByText('0')).not.toBeInTheDocument();
    bell.focus();
    expect(bell).toHaveFocus();
    await act(async () => { pending.resolve(response({ unread: 3 })); });
    expect(await screen.findByRole('link', { name: 'Notificaciones: 3 sin leer' })).toBeInTheDocument();
  });

  it.each([0, 1, 1234])('muestra el contador real %s sin limitarlo ni inventar datos', async (unread) => {
    mockInbox(() => response({ unread }));
    renderInbox('/');
    const bell = await screen.findByRole('link', { name: `Notificaciones: ${unread} sin leer` });
    expect(within(bell).getByText(String(unread))).toBeInTheDocument();
  });

  it('indica contador desconocido tras un error, aunque antes tuviera cero cacheado', async () => {
    let fail = false;
    mockInbox(() => fail ? response({ message: 'No disponible.' }, 503) : response({ unread: 0 }));
    renderInbox('/');
    await screen.findByRole('link', { name: 'Notificaciones: 0 sin leer' });
    fail = true;
    await act(() => useAuthStore.getState().queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount(1) }));
    const bell = await screen.findByRole('link', { name: 'Notificaciones: contador no disponible' });
    expect(within(bell).getByText('?')).toBeInTheDocument();
    expect(within(bell).queryByText('0')).not.toBeInTheDocument();
  });

  it('navega al buzón sin duplicar la consulta del contador', async () => {
    const fetcher = mockInbox();
    renderInbox('/');
    fireEvent.click(await screen.findByRole('link', { name: 'Notificaciones: 5 sin leer' }));
    expect(await screen.findByRole('heading', { name: 'Notificaciones' })).toBeInTheDocument();
    await screen.findByRole('heading', { name: FIRST.title });
    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('unread-count'))).toHaveLength(1);
  });
});

describe('Buzón de notificaciones', () => {
  it('muestra orden, texto literal, fechas locales, prioridad alta y estado; abrirlo no marca nada', async () => {
    const fetcher = mockInbox();
    renderInbox();
    const list = await screen.findByRole('list', { name: 'Listado de notificaciones' });
    const items = within(list).getAllByRole('article');
    expect(items.map((item) => within(item).getByRole('heading').textContent)).toEqual([FIRST.title, SECOND.title]);
    expect(items[0]?.textContent).toContain(FIRST.body);
    expect(items[0]?.querySelector('strong')).toBeNull();
    expect(within(items[0]!).getByText('Prioridad alta')).toBeInTheDocument();
    expect(within(items[0]!).getByText('No leída')).toBeInTheDocument();
    expect(within(items[1]!).queryByText('Prioridad alta')).not.toBeInTheDocument();
    expect(within(items[1]!).getByText('Leída')).toBeInTheDocument();
    expect(within(items[1]!).queryByRole('button', { name: 'Marcar como leída' })).not.toBeInTheDocument();
    const time = items[0]?.querySelector('time');
    expect(time).toHaveAttribute('datetime', FIRST.createdAt);
    expect(time).toHaveTextContent('03:00');
    expect(time).not.toHaveTextContent('UTC');
    expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('muestra carga inicial sin confundirla con un buzón vacío', async () => {
    const pending = deferred<Response>();
    mockInbox((path) => path.includes('?') ? pending.promise : undefined);
    renderInbox();
    expect(screen.getByRole('status', { name: 'Cargando notificaciones' })).toHaveTextContent('Cargando notificaciones…');
    expect(screen.queryByText('Tu buzón está vacío.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    await act(async () => { pending.resolve(response(page())); });
    await screen.findByRole('heading', { name: FIRST.title });
  });

  it('explica el buzón vacío y deshabilita la paginación sin páginas', async () => {
    mockInbox((path) => path.includes('?') ? response(page([], 0, 0)) : undefined);
    renderInbox();
    expect(await screen.findByText('Tu buzón está vacío.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    expect(screen.getByText('Página 1 · Sin resultados')).toBeInTheDocument();
  });

  it('pagina desde cero con tamaño 20 y permite volver desde una página sin resultados', async () => {
    let empty = false;
    const fetcher = mockInbox((path) => {
      if (!path.includes('?')) return undefined;
      const number = Number(new URL(path, 'http://localhost').searchParams.get('page'));
      return response(number === 0 ? page([FIRST], 0, 2) : page(empty ? [] : [SECOND], 1, empty ? 1 : 2));
    });
    renderInbox();
    await screen.findByText('Página 1 de 2');
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByText('Página 2 de 2');
    expect(screen.queryByRole('heading', { name: FIRST.title })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    empty = true;
    await act(() => useAuthStore.getState().queryClient.invalidateQueries({ queryKey: notificationKeys.lists(1) }));
    expect(await screen.findByText('Esta página no tiene notificaciones.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    await screen.findByRole('heading', { name: FIRST.title });
    expect(fetcher.mock.calls.map(([path]) => String(path))).toContain('/api/notifications?page=1&size=20');
    expect(fetcher.mock.calls.map(([path]) => String(path))).toContain('/api/notifications?page=0&size=20');
  });

  it('usa page y totalPages devueltos por el servidor para los controles', async () => {
    const fetcher = mockInbox((path) => path.includes('?') ? response(page([FIRST], 1, 3)) : undefined);
    renderInbox();
    await screen.findByText('Página 2 de 3');
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(fetcher.mock.calls.map(([path]) => String(path))).toContain('/api/notifications?page=2&size=20'));
  });

  it('muestra el error de consulta y permite reintentar', async () => {
    let fail = true;
    mockInbox((path) => path.includes('?') ? fail ? response({}, 503) : response(page()) : undefined);
    renderInbox();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar notificaciones.');
    expect(screen.queryByText('Tu buzón está vacío.')).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar notificaciones' }));
    await screen.findByRole('heading', { name: FIRST.title });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('conserva el listado durante un refetch y también si la actualización falla', async () => {
    const pending = deferred<Response>();
    let refresh = false;
    mockInbox((path) => path.includes('?') && refresh ? pending.promise : undefined);
    renderInbox();
    await screen.findByRole('heading', { name: FIRST.title });
    refresh = true;
    let updating!: Promise<void>;
    act(() => { updating = useAuthStore.getState().queryClient.invalidateQueries({ queryKey: notificationKeys.lists(1) }); });
    await screen.findByText('Actualizando notificaciones…');
    expect(screen.getByRole('heading', { name: FIRST.title })).toBeInTheDocument();
    await act(async () => { pending.resolve(response({}, 503)); await updating; });
    expect(await screen.findByRole('alert')).toHaveTextContent('Se muestran los últimos datos disponibles.');
    expect(screen.getByRole('heading', { name: FIRST.title })).toBeInTheDocument();
  });

  it('bloquea clics duplicados, conserva la notificación y sincroniza el contador real', async () => {
    const pending = deferred<Response>();
    let read = false;
    const fetcher = mockInbox((path) => {
      if (path.endsWith('/22/read')) return pending.promise;
      if (path.endsWith('unread-count')) return response({ unread: read ? 2 : 5 });
      if (path.includes('?')) return response(page([read ? MARKED : FIRST, SECOND]));
      return undefined;
    });
    renderInbox();
    await screen.findByRole('link', { name: 'Notificaciones: 5 sin leer' });
    const row = await screen.findByRole('article', { name: FIRST.title });
    const button = within(row).getByRole('button', { name: 'Marcar como leída' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(await within(row).findByRole('button', { name: 'Marcando como leída…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    await waitFor(() => expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('/read'))).toHaveLength(1));
    read = true;
    await act(async () => { pending.resolve(response(MARKED)); });
    await within(row).findByText('Leída');
    expect(await screen.findByRole('link', { name: 'Notificaciones: 2 sin leer' })).toBeInTheDocument();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(await screen.findByText('Notificación marcada como leída.')).toHaveAttribute('role', 'status');
  });

  it('muestra el error de marcado y permite reintentar sin alterar el contador ni el estado', async () => {
    let fail = true;
    let read = false;
    const fetcher = mockInbox((path) => {
      if (path.endsWith('/22/read')) {
        if (fail) return response({ message: 'No se pudo guardar la lectura.' }, 503);
        read = true;
        return response(MARKED);
      }
      if (path.includes('?')) return response(page([read ? MARKED : FIRST]));
      if (path.endsWith('unread-count')) return response({ unread: read ? 0 : 5 });
      return undefined;
    });
    renderInbox();
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar como leída' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar la lectura.');
    expect(screen.getByText('No leída')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Notificaciones: 5 sin leer' })).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como leída' }));
    await screen.findByText('Leída');
    await screen.findByRole('link', { name: 'Notificaciones: 0 sin leer' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('/read'))).toHaveLength(2);
  });
});
