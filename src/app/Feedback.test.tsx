import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FeedbackPage } from '../components/feedback/FeedbackPage';
import { ReviewsPage } from '../components/feedback/ReviewsPage';
import { AppShell } from '../components/layout/AppShell';
import { RequireAuth, RequireRole } from './guards';
import { useAuthStore } from './authStore';
import { cancelSessionRequests, tokenStore } from '../api/http';
import type { Role } from '../api/auth';
import type { Reviews } from '../api/feedback';

const TOKEN = 'a'.repeat(43);
const clients: QueryClient[] = [];
function setup({ role, state = 'AVAILABLE', fail = false, sendStatus = 200, sendState = 'RESPONDED', empty = false, reviewData, reviewRead }:
  { role?: Role; state?: string; fail?: boolean; sendStatus?: number; sendState?: string; empty?: boolean;
    reviewData?: Reviews; reviewRead?: (page: number) => Promise<Response> } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client);
  useAuthStore.setState({ queryClient: client, status: role ? 'authenticated' : 'anonymous',
    user: role ? { id: 1, email: 'synthetic@reviews.test', role, active: true, createdAt: '2026-10-15T12:00:00Z' } : null });
  const requests: { path: string; search: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname;
    requests.push({ path, search: url.search, method: init?.method ?? 'GET', body: init?.body, headers: init?.headers as Record<string, string> });
    if (path === '/api/notifications/unread-count') return new Response('{"unread":0}');
    if (fail) return new Response('{}', { status: 503 });
    if (path.startsWith('/api/feedback/invitations/')) return new Response(JSON.stringify({ state: init?.method === 'POST' ? sendState : state }), { status: init?.method === 'POST' ? sendStatus : 200 });
    if (path === '/api/feedback' && reviewRead) return reviewRead(Number(url.searchParams.get('page')));
    if (path === '/api/feedback') return new Response(JSON.stringify(reviewData ?? { content: empty ? [] : [{ id: 9, rating: 5,
      comment: '<script>no ejecutar</script>', respondedAt: '2026-10-15T12:00:00Z' }], page: 0, size: 20,
      totalElements: empty ? 0 : 1, totalPages: empty ? 0 : 1, count: empty ? 0 : 1, average: empty ? null : 5 }));
    return new Response('{}', { status: 404 });
  }));
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[role ? '/reviews' : `/feedback/${TOKEN}`]}><Routes>
    <Route path="/feedback/:token" element={<FeedbackPage />} />
    <Route path="/reviews" element={<RequireAuth><RequireRole role={['OWNER', 'DENTIST']}><AppShell><ReviewsPage /></AppShell></RequireRole></RequireAuth>} />
    <Route path="/login" element={<h1>Iniciar sesión</h1>} />
  </Routes></MemoryRouter></QueryClientProvider>);
  return requests;
}
beforeEach(() => { cancelSessionRequests(); tokenStore.set('session-only-in-memory'); });
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); cancelSessionRequests(); tokenStore.set(null);
  useAuthStore.setState({ status: 'anonymous', user: null }); vi.unstubAllGlobals(); });

it('formulario público, estrellas, comentario opcional y confirmación sin credenciales', async () => {
  const requests = setup();
  fireEvent.click(await screen.findByRole('radio', { name: '5 estrellas' }));
  expect(screen.getByText('5 de 5 estrellas')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Enviar reseña' }));
  expect(await screen.findByText(/Tu reseña se guardó de forma privada/)).toBeInTheDocument();
  const post = requests.find(request => request.method === 'POST')!;
  expect(JSON.parse(String(post.body))).toEqual({ rating: 5, comment: '' });
  expect(post.headers.Authorization).toBeUndefined();
  expect(screen.queryByRole('button', { name: 'Enviar reseña' })).not.toBeInTheDocument();
});

it('no envía sin seleccionar calificación', async () => {
  const requests = setup(); await screen.findByRole('button', { name: 'Enviar reseña' });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar reseña' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Selecciona de 1 a 5 estrellas.');
  expect(requests.some(request => request.method === 'POST')).toBe(false);
});

it.each([['INVALID', /El enlace no es válido/], ['EXPIRED', /Este enlace venció/], ['USED', /ya fue respondida/]])(
  'muestra enlace %s sin formulario', async (state, message) => {
    setup({ state }); expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

it('recuperación ante error al validar no muestra URL/token', async () => {
  setup({ fail: true }); expect(await screen.findByRole('alert')).not.toHaveTextContent(TOKEN);
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
});

it('conflicto concurrente muestra utilizada y no ofrece reenviar', async () => {
  setup({ sendStatus: 409, sendState: 'USED' });
  fireEvent.click(await screen.findByRole('radio', { name: '4 estrellas' }));
  fireEvent.click(screen.getByRole('button', { name: 'Enviar reseña' }));
  expect(await screen.findByText(/ya fue respondida/)).toBeInTheDocument();
});

it.each(['OWNER', 'DENTIST'] as const)('%s consulta reseñas y tiene navegación', async role => {
  const requests = setup({ role });
  expect(await screen.findByText('<script>no ejecutar</script>')).toBeInTheDocument();
  expect(document.querySelector('script')).toBeNull();
  expect(screen.getByText('5 de 5')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Reseñas' })).toHaveAttribute('href', '/reviews');
  expect(screen.getByText(role === 'OWNER' ? 'Reseñas privadas de las consultas de la clínica.' : 'Reseñas privadas de tus propias consultas.')).toBeInTheDocument();
  expect(requests.filter(request => request.path === '/api/feedback')).toHaveLength(1);
});

it.each(['PATIENT', 'RECEPTIONIST'] as const)('%s no abre listado ni consulta API', async role => {
  const requests = setup({ role });
  expect(await screen.findByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
  await waitFor(() => expect(requests.some(request => request.path === '/api/feedback')).toBe(false));
  expect(screen.queryByRole('link', { name: 'Reseñas' })).not.toBeInTheDocument();
});

it('sin reseñas no inventa promedios', async () => {
  setup({ role: 'DENTIST', empty: true });
  expect(await screen.findByText('Sin valoraciones')).toBeInTheDocument();
  expect(screen.getByText('Aún no hay reseñas para mostrar.')).toBeInTheDocument();
});

it('error de listado permite reintentar', async () => {
  setup({ role: 'OWNER', fail: true });
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las reseñas.');
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
});

const reviewSummary: Reviews = { count: 47, average: 4.375, totalElements: 47, totalPages: 3, page: 0, size: 20,
  content: [{ id: 101, rating: 2, comment: 'Comentario autorizado.\nSegunda línea.', respondedAt: '2026-10-25T16:30:00Z' },
    { id: 102, rating: 5, comment: null, respondedAt: '2026-10-24T18:15:00Z' }] };
const feedbackReads = (requests: ReturnType<typeof setup>) => requests.filter(({ path }) => path === '/api/feedback');

it('DENTIST presenta cantidad y promedio del servidor, no la longitud ni la media de la página', async () => {
  const requests = setup({ role: 'DENTIST', reviewData: reviewSummary });
  await screen.findByText('4.38 de 5');
  expect(screen.getByText('Reseñas recibidas', { selector: 'dt' }).nextElementSibling).toHaveTextContent(/^47$/);
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(screen.queryByText('3.5 de 5')).not.toBeInTheDocument();
  expect(feedbackReads(requests)).toHaveLength(1);
  expect(feedbackReads(requests)[0]).toMatchObject({ method: 'GET', search: '?page=0&size=20' });
  expect(requests.every(({ method }) => method === 'GET')).toBe(true);
});

it('DENTIST conserva comentarios, saltos de línea, fecha ISO y calificaciones textuales', async () => {
  setup({ role: 'DENTIST', reviewData: reviewSummary });
  const entry = await screen.findByRole('article', { name: 'Reseña: 2 de 5 estrellas' });
  expect(within(entry).getByText('Comentario autorizado. Segunda línea.')).toHaveTextContent('Comentario autorizado. Segunda línea.');
  expect(entry.querySelector('.reviews-comment')?.textContent).toBe('Comentario autorizado.\nSegunda línea.');
  expect(entry.querySelector('time')).toHaveAttribute('datetime', '2026-10-25T16:30:00Z');
  expect(entry.querySelector('time')).toHaveTextContent('2026');
  expect(within(entry).getByText('2 de 5 estrellas')).toBeInTheDocument();
  expect(entry.querySelectorAll('svg[fill="currentColor"]')).toHaveLength(2);
  expect(entry.querySelectorAll('svg[fill="none"]')).toHaveLength(3);
  expect(screen.getByText('Sin comentario')).toBeInTheDocument();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});

it.each([null, 0, 4.999])('DENTIST refleja promedio %s sin fabricar valores', async average => {
  setup({ role: 'DENTIST', reviewData: { ...reviewSummary, average } });
  expect(await screen.findByText(average === null ? 'Sin valoraciones' : `${average.toLocaleString('es-MX', { maximumFractionDigits: 2 })} de 5`)).toBeInTheDocument();
});

it('DENTIST no monta estadísticas de distribución, formularios ni acciones de moderación', async () => {
  setup({ role: 'DENTIST', reviewData: reviewSummary });
  await screen.findByText('4.38 de 5');
  const page = document.querySelector('.reviews-page')!;
  expect(page.querySelector('form,input,textarea,select')).toBeNull();
  expect(within(page as HTMLElement).queryByRole('button', { name: /Eliminar|Responder|Moderar|Publicar|Editar/ })).not.toBeInTheDocument();
  expect(page.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  expect(page.querySelector('[role="img"]')).toBeNull();
});

it('DENTIST muestra carga real sin contadores provisionales ni vacío antes de la respuesta', async () => {
  let release!: (response: Response) => void;
  setup({ role: 'DENTIST', reviewRead: () => new Promise((resolve) => { release = resolve; }) });
  expect(screen.getByRole('status', { name: 'Cargando reseñas' })).toBeInTheDocument();
  expect(screen.queryByText('Aún no hay reseñas para mostrar.')).not.toBeInTheDocument();
  expect(screen.queryByText('Reseñas recibidas', { selector: 'dt' })).not.toBeInTheDocument();
  await act(async () => release(new Response(JSON.stringify(reviewSummary))));
  expect(await screen.findByText('4.38 de 5')).toBeInTheDocument();
});

it('DENTIST distingue error de vacío y reintenta la misma consulta', async () => {
  let failing = true;
  const requests = setup({ role: 'DENTIST', reviewRead: async () => failing ? new Response('{}', { status: 503 }) : new Response(JSON.stringify(reviewSummary)) });
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar reseñas.');
  expect(screen.queryByText('Aún no hay reseñas para mostrar.')).not.toBeInTheDocument();
  failing = false;
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar reseñas' }));
  expect(await screen.findByText('4.38 de 5')).toBeInTheDocument();
  expect(feedbackReads(requests).map(({ search }) => search)).toEqual(['?page=0&size=20', '?page=0&size=20']);
});

it.each(['OWNER', 'DENTIST'] as const)('%s mantiene paginación y resumen del backend en todas las páginas', async role => {
  const requests = setup({ role, reviewRead: async page => new Response(JSON.stringify({ ...reviewSummary, page,
    content: [{ ...reviewSummary.content[0], id: 101 + page, comment: `Comentario página ${page + 1}` }] })) });
  await screen.findByText('Comentario página 1');
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  await screen.findByText('Comentario página 2');
  expect(screen.getByText('Página 2 de 3')).toBeInTheDocument();
  expect(screen.getByText('4.38 de 5')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  await screen.findByText('Comentario página 3');
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
  await screen.findByText('Comentario página 2');
  expect(feedbackReads(requests).map(({ search }) => search)).toEqual(['?page=0&size=20', '?page=1&size=20', '?page=2&size=20', '?page=1&size=20']);
});

it('DENTIST reintenta una página posterior sin etiquetar la anterior como resultado nuevo', async () => {
  let failing = true;
  const requests = setup({ role: 'DENTIST', reviewRead: async page => page === 1 && failing ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ ...reviewSummary, page,
    content: [{ ...reviewSummary.content[0], id: 101 + page, comment: `Comentario página ${page + 1}` }] })) });
  await screen.findByText('Comentario página 1');
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Comentario página 1')).not.toBeInTheDocument();
  failing = false;
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar reseñas' }));
  await screen.findByText('Comentario página 2');
  expect(feedbackReads(requests).at(-1)?.search).toBe('?page=1&size=20');
});

it('DENTIST con una página no recibe controles de paginación innecesarios', async () => {
  setup({ role: 'DENTIST', reviewData: { ...reviewSummary, totalPages: 1 } });
  await screen.findByText('4.38 de 5');
  expect(screen.queryByRole('navigation', { name: 'Páginas de reseñas' })).not.toBeInTheDocument();
});
