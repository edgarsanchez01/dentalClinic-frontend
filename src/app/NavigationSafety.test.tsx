import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, Link, Outlet, RouterProvider, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelSessionRequests, tokenStore } from '../api/http';
import { AppShell } from '../components/layout/AppShell';
import { CorrectionForm } from '../components/patients/ClinicalCorrection';
import { useAuthStore } from './authStore';
import { UnsavedChangesProvider } from './UnsavedChangesProvider';
import { useGuardedNavigate, useUnsavedChanges } from './unsavedChanges';

const routers: ReturnType<typeof createMemoryRouter>[] = [];
let logoutRequests = 0;

function DraftPage() {
  const [draft, setDraft] = useState('');
  const navigate = useNavigate();
  const attempt = useGuardedNavigate();
  useUnsavedChanges(draft !== '');
  return <AppShell><h1>Edición clínica</h1>
    <label>Nota<textarea value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
    <CorrectionForm entryId={1} originalContent="Texto original" pending={false} error={null} onCancel={() => undefined} onSubmit={() => undefined} />
    <Link to="/other">Enlace interno</Link>
    <button onClick={() => navigate('/other')}>Programática directa</button>
    <button onClick={() => attempt(() => navigate('/other'))}>Programática protegida</button>
    <button onClick={() => navigate(-1)}>Atrás nativo del router</button>
    <button onClick={() => navigate(1)}>Adelante nativo del router</button>
  </AppShell>;
}

function setup(entries = ['/edit'], index = entries.length - 1) {
  const router = createMemoryRouter([{
    element: <QueryClientProvider client={useAuthStore.getState().queryClient}><UnsavedChangesProvider><Outlet /></UnsavedChangesProvider></QueryClientProvider>,
    children: [
      { path: '/edit', element: <DraftPage /> },
      { path: '/other', element: <h1>Destino</h1> },
      { path: '/login', element: <h1>Login</h1> },
      { path: '/', element: <h1>Landing pública</h1> },
      { path: '/appointments', element: <h1>Agenda</h1> },
    ],
  }], { initialEntries: entries, initialIndex: index });
  routers.push(router);
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'authenticated', user: { id: 1, email: 'actor@dc.test', role: 'OWNER', active: true, createdAt: '2026-01-01' } });
  tokenStore.set('test-only');
  logoutRequests = 0;
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes('/logout')) { logoutRequests++; return new Response(null, { status: 204 }); }
    return new Response('{"unread":0}');
  }));
});
afterEach(() => {
  cleanup();
  for (const router of routers.splice(0)) router.dispose();
  cancelSessionRequests(); tokenStore.set(null);
  useAuthStore.getState().queryClient.clear();
  useAuthStore.setState({ status: 'anonymous', user: null });
  vi.unstubAllGlobals();
});

describe('9A.1 data router y borradores', () => {
  it.each(['Enlace interno', 'Programática directa', 'Programática protegida'])(
    '%s confirma una sola vez y conserva el texto al quedarse', async (action) => {
      setup();
      fireEvent.change(screen.getByLabelText('Nota'), { target: { value: 'Borrador privado' } });
      fireEvent.click(screen.getByText(action));
      expect(await screen.findAllByRole('dialog', { name: 'Tienes cambios sin guardar' })).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Seguir aquí' }));
      expect(screen.getByLabelText('Nota')).toHaveValue('Borrador privado');
      fireEvent.click(screen.getByText(action));
      fireEvent.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
      expect(await screen.findByRole('heading', { name: 'Destino' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );

  it.each([['Atrás nativo del router', ['/other', '/edit'], 1], ['Adelante nativo del router', ['/edit', '/other'], 0]] as const)(
    '%s bloquea POP sin alterar ni reemplazar el historial', async (button, entries, index) => {
      const router = setup([...entries], index);
      fireEvent.change(screen.getByLabelText('Nota'), { target: { value: 'Conservar' } });
      fireEvent.click(screen.getByRole('button', { name: button }));
      fireEvent.click(await screen.findByRole('button', { name: 'Seguir aquí' }));
      expect(router.state.location.pathname).toBe('/edit');
      expect(screen.getByLabelText('Nota')).toHaveValue('Conservar');
      fireEvent.click(screen.getByRole('button', { name: button }));
      fireEvent.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
      expect(await screen.findByRole('heading', { name: 'Destino' })).toBeInTheDocument();
      expect(router.state.historyAction).toBe('POP');
    },
  );

  it('no bloquea al abrir una corrección sin editarla', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Programática directa' }));
    expect(await screen.findByRole('heading', { name: 'Destino' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['Contenido corregido', 'Motivo de la corrección'])(
    'registra la corrección clínica cuando cambia %s', async (label) => {
      setup();
      fireEvent.change(screen.getByLabelText(label), { target: { value: 'Cambio clínico' } });
      fireEvent.click(screen.getByRole('button', { name: 'Programática directa' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Seguir aquí' }));
      expect(screen.getByLabelText(label)).toHaveValue('Cambio clínico');
    },
  );

  it('no ejecuta logout ni limpia caché antes del consentimiento', async () => {
    const client = useAuthStore.getState().queryClient;
    client.setQueryData(['private'], 'datos de la sesión');
    setup();
    fireEvent.change(screen.getByLabelText('Nota'), { target: { value: 'Pendiente' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Seguir aquí' }));
    expect(logoutRequests).toBe(0);
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(client.getQueryData(['private'])).toBe('datos de la sesión');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
    expect(await screen.findByRole('heading', { name: 'Landing pública' })).toBeInTheDocument();
    expect(logoutRequests).toBe(1);
    expect(client.getQueryData(['private'])).toBeUndefined();
  });

  it('cierra el drawer antes de resolver la única confirmación', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('Nota'), { target: { value: 'Pendiente' } });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú de navegación' }));
    const drawer = screen.getByRole('dialog', { name: 'Menú de navegación' });
    fireEvent.click(within(drawer).getByRole('link', { name: 'Citas' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Tienes cambios sin guardar' });
    expect(drawer).not.toHaveAttribute('open');
    expect(confirmation).toHaveAttribute('open');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Seguir aquí' }));
    expect(screen.getByLabelText('Nota')).toHaveValue('Pendiente');
  });

  it('restaurar el valor original elimina el bloqueo', async () => {
    const router = setup();
    fireEvent.change(screen.getByLabelText('Contenido corregido'), { target: { value: 'Modificado' } });
    fireEvent.change(screen.getByLabelText('Contenido corregido'), { target: { value: 'Texto original' } });
    await act(async () => { await router.navigate('/other'); });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Destino' })).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
