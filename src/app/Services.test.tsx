import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServicesPage } from '../components/catalog/ServicesPage';
import { tokenStore } from '../api/http';
import type { Role } from '../api/auth';
import { useAuthStore } from './authStore';

const ITEM = { id: 1, name: 'Limpieza dental', description: 'Profilaxis', referencePrice: '75.1234', durationMinutes: 35,
  active: true, createdAt: '2026-10-10T00:00:00Z', updatedAt: null };
const INACTIVE = { ...ITEM, id: 2, name: 'Consulta inicial', referencePrice: '0.0000', active: false };
function actor(role: Role) { return { id: 1, email: 'staff@clinic.com', role, active: true, createdAt: ITEM.createdAt }; }
function setup(role: Role = 'OWNER', options: { status?: number; pending?: boolean; saveError?: number; savePending?: boolean; detailError?: number } = {}) {
  useAuthStore.setState({ status: 'authenticated', user: actor(role) });
  let items = [ITEM, INACTIVE];
  const requests: Array<{ path: string; method: string; body?: string }> = [];
  let release!: () => void;
  let releaseSave!: () => void;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    requests.push({ path: url.pathname + url.search, method, ...(init?.body ? { body: String(init.body) } : {}) });
    if (method === 'GET') {
      if (options.detailError && url.pathname !== '/api/services') return new Response('{"message":"Servicio no encontrado."}', { status: options.detailError });
      const result = options.status && options.status >= 400 ? new Response('{"message":"Catálogo no disponible."}', { status: options.status })
        : new Response(JSON.stringify(url.pathname === '/api/services' ? items.filter((item) =>
          !url.searchParams.has('active') || String(item.active) === url.searchParams.get('active'))
          : items.find((item) => item.id === Number(url.pathname.split('/')[3]))), { status: 200 });
      if (options.pending) return new Promise<Response>((resolve) => { release = () => resolve(result); });
      return result;
    }
    if (options.saveError) return new Response(JSON.stringify({ message: 'No se pudo guardar.',
      ...(options.saveError === 400 ? { fieldErrors: { name: 'Nombre rechazado por servidor.' } } : {}),
    }), { status: options.saveError });
    const body = JSON.parse(String(init?.body)) as Partial<typeof ITEM>;
    let saved: typeof ITEM;
    if (method === 'POST') { saved = { ...ITEM, ...body, id: 3, active: true }; items = [...items, saved]; }
    else { const id = Number(url.pathname.split('/')[3]); saved = { ...items.find((item) => item.id === id)!, ...body }; items = items.map((item) => item.id === id ? saved : item); }
    const result = new Response(JSON.stringify(saved), { status: method === 'POST' ? 201 : 200 });
    if (options.savePending) return new Promise<Response>((resolve) => { releaseSave = () => resolve(result); });
    return result;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><ServicesPage /></MemoryRouter></QueryClientProvider>);
  return { requests, release: () => release(), releaseSave: () => releaseSave(), client };
}
async function loaded() { await screen.findByRole('article', { name: 'Servicio Limpieza dental' }); }
function form() { return screen.getByRole('form', { name: /Crear servicio|Editar servicio/ }); }
function fill(name = 'Revisión') {
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Precio de referencia'), { target: { value: '80,1234' } });
  fireEvent.change(screen.getByLabelText('Duración (minutos)'), { target: { value: '40' } });
}
beforeEach(() => tokenStore.set(null));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useAuthStore.setState({ user: null }); });

describe('Servicios F7.2', () => {
  it('DENTIST reutiliza exactamente la composición de consulta de RECEPTIONIST', async () => {
    setup('RECEPTIONIST'); await loaded();
    const reference = document.querySelector('.reception-services')!.innerHTML;
    cleanup();
    const { requests } = setup('DENTIST'); await loaded();
    expect(document.querySelector('.reception-services')!.innerHTML).toBe(reference);
    expect(screen.getByText('2 servicios en el catálogo')).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it.each(['DENTIST', 'RECEPTIONIST'] as const)('%s conserva filtros, recuento y limpieza del vacío sin escrituras', async (role) => {
    const { requests } = setup(role); await loaded();
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'active' } });
    expect(await screen.findByText('1 servicio con este estado')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Servicio Consulta inicial' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'inactive' } });
    expect(await screen.findByRole('article', { name: 'Servicio Consulta inicial' })).toBeInTheDocument();
    expect(requests.some((request) => request.path === '/api/services?active=true')).toBe(true);
    expect(requests.some((request) => request.path === '/api/services?active=false')).toBe(true);
    vi.stubGlobal('fetch', async () => new Response('[]', { status: 200 }));
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'all' } });
    await waitFor(() => expect(screen.getByText('0 servicios en el catálogo')).toBeInTheDocument());
    expect(screen.getByText('El catálogo está vacío')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'inactive' } });
    expect(await screen.findByText('No hay servicios con este estado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver todos los servicios' }));
    expect(screen.getByLabelText('Estado')).toHaveValue('all');
    expect(screen.queryByRole('button', { name: /Nuevo servicio|Editar|Desactivar|Reactivar/ })).not.toBeInTheDocument();
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it.each(['DENTIST', 'RECEPTIONIST'] as const)('%s conserva carga, error y reintento del catálogo compartido', async (role) => {
    const { release } = setup(role, { pending: true, status: 503 });
    expect(screen.getByRole('status', { name: 'Cargando servicios' })).toBeInTheDocument();
    await act(async () => release());
    expect(await screen.findByRole('alert')).toHaveTextContent('Catálogo no disponible.');
    vi.stubGlobal('fetch', async () => new Response('[]', { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar servicios' }));
    expect(await screen.findByText('El catálogo está vacío')).toBeInTheDocument();
  });

  it.each(['OWNER', 'DENTIST', 'RECEPTIONIST'] as const)('%s consulta precio, duración y vigencia; solo OWNER ve modificaciones', async (role) => {
    setup(role); await loaded();
    expect(screen.getByText('75,1234')).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: 'Servicio Limpieza dental' })).getByText('35 min', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByText('Activo', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Inactivo', { exact: true })).toBeInTheDocument();
    if (role === 'OWNER') expect(screen.getByRole('button', { name: 'Nuevo servicio' })).toBeInTheDocument();
    else expect(screen.queryByRole('button', { name: /Nuevo servicio|Editar|Desactivar|Reactivar/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/EUR|USD|IVA/)).not.toBeInTheDocument();
  });

  it('PATIENT no ve datos administrativos ni solicita endpoints del catálogo', async () => {
    const { requests } = setup('PATIENT');
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('heading', { name: 'Servicios dentales' })).not.toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it('muestra carga y permite filtrar activos e inactivos', async () => {
    const { requests, release } = setup('OWNER', { pending: true });
    expect(screen.getByRole('status')).toHaveTextContent('Cargando servicios');
    await act(async () => release()); await loaded();
    // Following filter requests should resolve directly.
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); requests.push({ path: url, method: init?.method ?? 'GET' });
      return new Response(JSON.stringify(url.includes('active=false') ? [INACTIVE] : [ITEM]), { status: 200 });
    });
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'active' } });
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Servicio Consulta inicial' })).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'inactive' } });
    expect(await screen.findByRole('article', { name: 'Servicio Consulta inicial' })).toBeInTheDocument();
    expect(requests.some((request) => request.path.endsWith('?active=true'))).toBe(true);
    expect(requests.some((request) => request.path.endsWith('?active=false'))).toBe(true);
  });

  it('muestra error con reintento y recupera un catálogo vacío', async () => {
    setup('OWNER', { status: 503 });
    expect(await screen.findByRole('alert')).toHaveTextContent('Catálogo no disponible.');
    vi.stubGlobal('fetch', async () => new Response('[]', { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('El catálogo está vacío')).toBeInTheDocument();
  });

  it('crea con POST, descripción nula, valores sin defaults e invalida el listado', async () => {
    const { requests } = setup(); await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo servicio' }));
    expect(screen.getByLabelText('Nombre')).toHaveFocus();
    expect(screen.getByLabelText('Precio de referencia')).toHaveValue('');
    expect(screen.getByLabelText('Duración (minutos)')).toHaveValue('');
    fill(); fireEvent.submit(form());
    expect(await screen.findByText('Servicio «Revisión» creado.')).toBeInTheDocument();
    expect(await screen.findByRole('article', { name: 'Servicio Revisión' })).toBeInTheDocument();
    const post = requests.find((request) => request.method === 'POST')!;
    expect(post.path).toBe('/api/services');
    expect(JSON.parse(post.body!)).toEqual({ name: 'Revisión', description: null, referencePrice: 80.1234, durationMinutes: 40 });
  });

  it('edita con GET de detalle y PUT, sin modificar la vigencia', async () => {
    const { requests } = setup(); await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Consulta inicial' }));
    expect(await screen.findByLabelText('Nombre')).toHaveValue('Consulta inicial');
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Consulta ampliada' } });
    fireEvent.submit(form());
    expect(await screen.findByText('Servicio «Consulta ampliada» actualizado.')).toBeInTheDocument();
    expect(within(await screen.findByRole('article', { name: 'Servicio Consulta ampliada' })).getByText('Inactivo')).toBeInTheDocument();
    expect(requests.some((request) => request.path === '/api/services/2' && request.method === 'GET')).toBe(true);
    const put = requests.find((request) => request.method === 'PUT')!;
    expect(JSON.parse(put.body!)).not.toHaveProperty('active');
  });

  it.each(['Desactivar Limpieza dental', 'Reactivar Consulta inicial'])('confirma %s mediante PATCH; cancelar no escribe', async (label) => {
    const { requests } = setup(); await loaded();
    fireEvent.click(screen.getByRole('button', { name: label }));
    const panel = within(screen.getByRole('region', { name: 'Confirmar cambio de estado' }));
    fireEvent.click(panel.getByRole('button', { name: 'Cancelar' }));
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: label }));
    const confirm = screen.getByRole('button', { name: label.startsWith('Desactivar') ? 'Confirmar desactivación' : 'Confirmar reactivación' });
    expect(confirm).toHaveFocus(); fireEvent.click(confirm);
    await waitFor(() => expect(requests.some((request) => request.method === 'PATCH')).toBe(true));
    const patch = requests.find((request) => request.method === 'PATCH')!;
    expect(patch.path).toBe(`/api/services/${label.startsWith('Desactivar') ? 1 : 2}/active`);
    expect(JSON.parse(patch.body!)).toEqual({ active: !label.startsWith('Desactivar') });
    expect(await screen.findByText(/Servicio «.*» (desactivado|reactivado)\./)).toBeInTheDocument();
  });

  it.each([
    ['Nombre', ''], ['Nombre', 'X'.repeat(201)], ['Descripción (opcional)', 'X'.repeat(4001)],
    ['Precio de referencia', '-1'], ['Precio de referencia', '1.12345'], ['Precio de referencia', '1000000000000000'],
    ['Duración (minutos)', '0'], ['Duración (minutos)', '30.5'], ['Duración (minutos)', '2147483648'],
  ])('valida %s=%s sin enviar HTTP y enfoca el campo inválido', async (label, value) => {
    const { requests } = setup(); await loaded(); fireEvent.click(screen.getByRole('button', { name: 'Nuevo servicio' })); fill();
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.submit(form());
    expect(screen.getByRole('alert')).toHaveTextContent('Revisa los campos indicados.');
    expect(screen.getByLabelText(label)).toHaveFocus();
    expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it.each([400, 403])('conserva el formulario y muestra los errores HTTP %s', async (status) => {
    setup('OWNER', { saveError: status }); await loaded(); fireEvent.click(screen.getByRole('button', { name: 'Nuevo servicio' })); fill();
    fireEvent.submit(form());
    expect(await screen.findByText('No se pudo guardar.')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Revisión');
    if (status === 400) {
      expect(screen.getByText('Nombre rechazado por servidor.')).toBeInTheDocument();
      expect(screen.getByLabelText('Nombre')).toHaveFocus();
    }
    expect(screen.getByRole('button', { name: 'Guardar servicio' })).toBeEnabled();
  });

  it('deshabilita el formulario y otras modificaciones durante el envío, sin duplicar POST', async () => {
    const { requests, releaseSave } = setup('OWNER', { savePending: true }); await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo servicio' })); fill();
    fireEvent.submit(form());
    expect(await screen.findByRole('button', { name: 'Guardando servicio…' })).toBeDisabled();
    expect(screen.getByLabelText('Nombre')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Editar Limpieza dental' })).toBeDisabled();
    fireEvent.submit(form());
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1);
    await act(async () => releaseSave());
    expect(await screen.findByText('Servicio «Revisión» creado.')).toBeInTheDocument();
  });

  it('un detalle 404 ofrece reintento/cancelación sin mostrar un formulario con valores ficticios', async () => {
    setup('OWNER', { detailError: 404 }); await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Limpieza dental' }));
    expect(await screen.findByText('Servicio no encontrado.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar edición' }));
    expect(screen.getByRole('button', { name: 'Editar Limpieza dental' })).toHaveFocus();
  });

  it.each(['DENTIST', 'RECEPTIONIST'] as const)('un submit obtenido como OWNER tampoco escribe tras cambiar a %s', async (role) => {
    const { requests } = setup(); await loaded(); fireEvent.click(screen.getByRole('button', { name: 'Nuevo servicio' })); fill();
    const node = form();
    act(() => { useAuthStore.setState({ user: actor(role) }); fireEvent.submit(node); });
    await act(async () => { await Promise.resolve(); });
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Guardar servicio' })).not.toBeInTheDocument();
  });
});
