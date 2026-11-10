import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clinicApi, type ClinicDto } from '../../api/clinic';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import { UnsavedChangesProvider } from '../../app/UnsavedChangesProvider';
import { ClinicSettingsPage } from './ClinicSettingsPage';

const original: ClinicDto = {
  id: 1, name: 'Clínica de prueba', timezone: 'Europe/Madrid', description: null, address: 'Dirección operativa',
  phone: null, email: null, logoUrl: null, brandColor: null, publicInfo: null,
  socialNetworks: { instagram: 'https://instagram.com/prueba', facebook: 'https://facebook.com/prueba', website: 'https://example.test', extra: 'valor adicional', blank: '' },
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
const clients: QueryClient[] = [];
const routers: ReturnType<typeof createMemoryRouter>[] = [];
let clinic: ClinicDto;

beforeEach(() => {
  clinic = structuredClone(original);
  useAuthStore.setState({ status: 'authenticated', user: { id: 1, role: 'OWNER', email: 'owner@example.test', active: true, createdAt: original.createdAt } });
  vi.spyOn(clinicApi, 'get').mockImplementation(async () => clinic);
  vi.spyOn(clinicApi, 'update').mockImplementation(async input => {
    clinic = { ...clinic, ...input } as ClinicDto;
    return clinic;
  });
});

afterEach(() => {
  cleanup();
  routers.splice(0).forEach(router => router.dispose());
  clients.splice(0).forEach(client => client.clear());
  vi.restoreAllMocks();
  useAuthStore.setState({ status: 'anonymous', user: null });
});

async function setup(entries = ['/clinic'], index = entries.length - 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  clients.push(client);
  const router = createMemoryRouter([{ element: <UnsavedChangesProvider><Outlet /></UnsavedChangesProvider>, children: [
    { path: '/clinic', element: <><Link to="/other">Salir de Clínica</Link><ClinicSettingsPage /></> },
    { path: '/other', element: <><h1>Otro módulo</h1><Link to="/clinic">Volver a Clínica</Link></> },
  ] }], { initialEntries: entries, initialIndex: index });
  routers.push(router);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, router };
}

function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit() {
  fireEvent.submit(screen.getByLabelText('Nombre').closest('form')!);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function unloadBlocked() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function rejected() {
  return new ApiError(400, {
    status: 400, error: 'Bad Request', message: 'No se pudo guardar la configuración.',
    path: '/api/clinic', timestamp: original.updatedAt, fieldErrors: { timezone: 'Zona rechazada por el servidor.' },
  }, 'Error');
}

const affectedKeys = [
  ['public-schedule'], ['clinic-schedule'], ['dentist-schedule', 7], ['booking-policy'], ['policy'],
  ['availability', 'form', 7], ['agenda-context', 7], ['clinical-trace', 1, 7, 1, 'NOTES', 0],
];
const unrelatedKeys = [['appointments'], ['financial-report', 'portfolio'], ['financial-charges'], ['services'], ['users'], ['clinic-exceptions'], ['time-off', 7]];

describe('DC-OWNER-03 — Clínica segura', () => {
  it('F7 agrupa los nueve controles sin duplicar formulario ni retirar website', async () => {
    await setup();
    const name = await screen.findByLabelText('Nombre');
    const form = name.closest('form')!;
    expect(within(form).getAllByRole('textbox')).toHaveLength(9);
    expect(form).toHaveClass('ce-surface--paper', 'ce-admin-form');
    expect(form.querySelectorAll('.ce-surface--paper')).toHaveLength(0);
    expect(within(screen.getByRole('region', { name: 'Identidad y zona horaria' })).getByLabelText('Nombre')).toBe(name);
    expect(within(screen.getByRole('region', { name: 'Contacto y descripción' })).getByLabelText('Descripción')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Redes y enlaces' })).getByLabelText('Sitio web')).toHaveValue('https://example.test');
    expect(document.querySelectorAll('form')).toHaveLength(1);
  });

  it('preserva brandColor null, los campos ocultos y las claves adicionales en el PUT', async () => {
    await setup();
    await screen.findByLabelText('Nombre');
    change('Nombre', 'Nombre operativo nuevo');
    submit();
    await waitFor(() => expect(clinicApi.update).toHaveBeenCalledTimes(1));
    expect(vi.mocked(clinicApi.update).mock.calls[0]![0]).toMatchObject({
      name: 'Nombre operativo nuevo', logoUrl: null, brandColor: null, publicInfo: null,
      socialNetworks: original.socialNetworks,
    });
    expect(vi.mocked(clinicApi.update).mock.calls[0]![0]).toMatchObject({ description: null, phone: null, email: null, address: original.address });
  });

  it('retira los tres controles sin retirar datos operativos ni redes', async () => {
    clinic = { ...clinic, logoUrl: 'https://example.test/logo.png', brandColor: '#193F43', publicInfo: 'Texto conservado no editable' };
    await setup();
    await screen.findByLabelText('Nombre');
    expect(screen.queryByLabelText('URL del logo')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Color de marca (#RRGGBB)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Información pública')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Texto conservado no editable')).not.toBeInTheDocument();
    expect(screen.getAllByRole('textbox')).toHaveLength(9);
    change('Teléfono', '+34 611 222 333');
    submit();
    await screen.findByText('Configuración guardada.');
    expect(clinicApi.update).toHaveBeenCalledWith(expect.objectContaining({
      logoUrl: 'https://example.test/logo.png', brandColor: '#193F43', publicInfo: 'Texto conservado no editable', phone: '+34 611 222 333',
    }));
  });

  it('edita o elimina solo las redes visibles solicitadas y conserva todas las otras claves', async () => {
    await setup();
    await screen.findByLabelText('Instagram');
    change('Instagram', '  https://instagram.com/nueva  ');
    change('Facebook', '');
    change('Sitio web', 'https://nuevo.example.test');
    submit();
    await screen.findByText('Configuración guardada.');
    expect(clinicApi.update).toHaveBeenCalledWith(expect.objectContaining({ socialNetworks: {
      instagram: 'https://instagram.com/nueva', website: 'https://nuevo.example.test', extra: 'valor adicional', blank: '',
    } }));
  });

  it.each([null, {}, { extra: 'dato', instagram: '  valor original  ' }])('preserva el mapa de redes sin cambios: %j', async socialNetworks => {
    clinic = { ...clinic, socialNetworks };
    await setup();
    await screen.findByLabelText('Nombre');
    change('Nombre', 'Nuevo nombre');
    submit();
    await screen.findByText('Configuración guardada.');
    expect(clinicApi.update).toHaveBeenCalledWith(expect.objectContaining({ socialNetworks }));
  });

  it('la segunda edición utiliza los valores ocultos y redes de la respuesta confirmada', async () => {
    vi.mocked(clinicApi.update).mockImplementationOnce(async input => {
      clinic = { ...clinic, ...input, brandColor: '#123456', publicInfo: 'Dato confirmado', socialNetworks: { ...clinic.socialNetworks, newKey: 'conservada' } } as ClinicDto;
      return clinic;
    });
    await setup();
    await screen.findByLabelText('Nombre');
    change('Nombre', 'Primera edición');
    submit();
    await screen.findByText('Configuración guardada.');
    change('Nombre', 'Segunda edición');
    submit();
    await screen.findByText('Configuración guardada.');
    expect(clinicApi.update).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'Segunda edición', brandColor: '#123456', publicInfo: 'Dato confirmado',
      socialNetworks: { ...original.socialNetworks, newKey: 'conservada' },
    }));
  });

  it('un formulario intacto o revertido no bloquea; navegar modificado conserva o descarta sin PUT ni almacenamiento', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const { router } = await setup();
    await screen.findByLabelText('Nombre');
    expect(unloadBlocked()).toBe(false);
    change('Nombre', 'Modificado');
    expect(unloadBlocked()).toBe(true);
    change('Nombre', original.name);
    expect(unloadBlocked()).toBe(false);
    change('Nombre', 'Borrador');
    fireEvent.click(screen.getByRole('link', { name: 'Salir de Clínica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Seguir aquí' }));
    expect(screen.getByLabelText('Nombre')).toHaveValue('Borrador');
    expect(router.state.location.pathname).toBe('/clinic');
    fireEvent.click(screen.getByRole('link', { name: 'Salir de Clínica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
    expect(await screen.findByRole('heading', { name: 'Otro módulo' })).toBeVisible();
    expect(clinicApi.update).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    expect(unloadBlocked()).toBe(false);
  });

  it.each([[-1, ['/other', '/clinic'], 1], [1, ['/clinic', '/other'], 0]] as const)(
    'protege Back/Forward (%s) con data router y provider reales', async (direction, entries, index) => {
      const { router } = await setup([...entries], index);
      await screen.findByLabelText('Nombre');
      change('Nombre', 'Borrador para conservar');
      await act(async () => { await router.navigate(direction); });
      fireEvent.click(await screen.findByRole('button', { name: 'Seguir aquí' }));
      expect(screen.getByLabelText('Nombre')).toHaveValue('Borrador para conservar');
      expect(router.state.location.pathname).toBe('/clinic');
      await act(async () => { await router.navigate(direction); });
      fireEvent.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
      expect(await screen.findByRole('heading', { name: 'Otro módulo' })).toBeVisible();
      expect(router.state.historyAction).toBe('POP');
      expect(clinicApi.update).not.toHaveBeenCalled();
    },
  );

  it('un rechazo conserva formulario, errores asociados y protección; reintentar con éxito libera el borrador', async () => {
    vi.mocked(clinicApi.update).mockRejectedValueOnce(rejected());
    await setup();
    await screen.findByLabelText('Nombre');
    change('Zona horaria (IANA)', 'Zona incorrecta');
    submit();
    await screen.findByText('Zona rechazada por el servidor.');
    expect(screen.getByLabelText('Zona horaria (IANA)')).toHaveValue('Zona incorrecta');
    expect(screen.getByLabelText('Zona horaria (IANA)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Zona horaria (IANA)')).toHaveAccessibleDescription('Zona rechazada por el servidor.');
    expect(screen.getByLabelText('Zona horaria (IANA)')).toHaveFocus();
    expect(screen.queryByText('Configuración guardada.')).not.toBeInTheDocument();
    expect(unloadBlocked()).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Salir de Clínica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Seguir aquí' }));
    expect(screen.getByText('Zona rechazada por el servidor.')).toBeVisible();
    change('Zona horaria (IANA)', 'Europe/Paris');
    expect(screen.getByLabelText('Zona horaria (IANA)')).not.toHaveAttribute('aria-invalid');
    submit();
    await screen.findByText('Configuración guardada.');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toHaveFocus();
    expect(unloadBlocked()).toBe(false);
    expect(clinicApi.update).toHaveBeenCalledTimes(2);
  });

  it('bloquea campos y duplicados desde el inicio; la respuesta no puede pisar una edición posterior', async () => {
    const request = deferred<ClinicDto>();
    vi.mocked(clinicApi.update).mockReturnValueOnce(request.promise);
    await setup();
    await screen.findByLabelText('Nombre');
    change('Nombre', 'Nombre enviado');
    act(() => { submit(); submit(); change('Nombre', 'Cambio forzado durante el envío'); });
    await waitFor(() => expect(clinicApi.update).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Nombre')).toHaveValue('Nombre enviado');
    expect(screen.getByLabelText('Nombre')).toBeDisabled();
    expect(screen.getByLabelText('Instagram')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    await act(async () => request.resolve({ ...original, name: 'Nombre confirmado' }));
    await screen.findByText('Configuración guardada.');
    expect(screen.getByLabelText('Nombre')).toHaveValue('Nombre confirmado');
    expect(unloadBlocked()).toBe(false);
    change('Nombre', 'Edición realmente posterior');
    expect(screen.getByLabelText('Nombre')).toHaveValue('Edición realmente posterior');
    expect(unloadBlocked()).toBe(true);
  });

  it('un guardado intacto pendiente también protege navegación y recarga', async () => {
    const request = deferred<ClinicDto>();
    vi.mocked(clinicApi.update).mockReturnValueOnce(request.promise);
    await setup();
    await screen.findByLabelText('Nombre');
    submit();
    await waitFor(() => expect(clinicApi.update).toHaveBeenCalledTimes(1));
    expect(unloadBlocked()).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Salir de Clínica' }));
    const dialog = await screen.findByRole('dialog', { name: 'Guardado en curso' });
    expect(within(dialog).getByText('Hay un guardado en curso. Salir no garantiza que la operación se cancele')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Seguir aquí' }));
    await act(async () => request.resolve(original));
    await screen.findByText('Configuración guardada.');
    expect(unloadBlocked()).toBe(false);
  });

  it('un refetch no borra el borrador y el PUT conserva los valores ocultos más recientes', async () => {
    const { client } = await setup();
    await screen.findByLabelText('Nombre');
    change('Nombre', 'Mi borrador');
    clinic = { ...clinic, logoUrl: 'https://example.test/actual.png', brandColor: '#123456', publicInfo: 'Texto actualizado', socialNetworks: { ...clinic.socialNetworks, extraNew: 'nueva clave' } };
    await act(async () => { await client.refetchQueries({ queryKey: ['clinic'], exact: true }); });
    expect(screen.getByLabelText('Nombre')).toHaveValue('Mi borrador');
    submit();
    await screen.findByText('Configuración guardada.');
    expect(clinicApi.update).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Mi borrador', logoUrl: clinic.logoUrl, brandColor: '#123456', publicInfo: 'Texto actualizado',
      socialNetworks: { ...original.socialNetworks, extraNew: 'nueva clave' },
    }));
  });

  it('un refresco limpio adopta la configuración recibida sin registrar cambios locales', async () => {
    const { client } = await setup();
    await screen.findByLabelText('Nombre');
    clinic = { ...clinic, name: 'Nombre actualizado en servidor' };
    await act(async () => { await client.refetchQueries({ queryKey: ['clinic'], exact: true }); });
    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveValue(clinic.name));
    expect(unloadBlocked()).toBe(false);
  });

  it('cancela un GET iniciado durante el PUT para que no reemplace la confirmación', async () => {
    const write = deferred<ClinicDto>();
    const read = deferred<ClinicDto>();
    vi.mocked(clinicApi.update).mockReturnValueOnce(write.promise);
    const { client } = await setup();
    await screen.findByLabelText('Nombre');
    change('Nombre', 'Nombre enviado');
    submit();
    await waitFor(() => expect(clinicApi.update).toHaveBeenCalledTimes(1));
    vi.mocked(clinicApi.get).mockReturnValueOnce(read.promise);
    act(() => { void client.refetchQueries({ queryKey: ['clinic'], exact: true }); });
    await waitFor(() => expect(clinicApi.get).toHaveBeenCalledTimes(2));
    await act(async () => write.resolve({ ...original, name: 'Nombre confirmado' }));
    await screen.findByText('Configuración guardada.');
    change('Nombre', 'Nuevo borrador');
    await act(async () => read.resolve({ ...original, name: 'GET antiguo' }));
    expect(screen.getByLabelText('Nombre')).toHaveValue('Nuevo borrador');
    expect(client.getQueryData<ClinicDto>(['clinic'])?.name).toBe('Nombre confirmado');
    expect(unloadBlocked()).toBe(true);
  });

  it.each(['éxito', 'rechazo'])('una respuesta tardía (%s) no reemplaza el nuevo editor ni publica feedback antiguo', async result => {
    const write = deferred<ClinicDto>();
    vi.mocked(clinicApi.update).mockReturnValueOnce(write.promise);
    const { client } = await setup();
    await screen.findByLabelText('Nombre');
    change('Nombre', 'Edición enviada');
    submit();
    await waitFor(() => expect(clinicApi.update).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('link', { name: 'Salir de Clínica' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salir de esta vista' }));
    await screen.findByRole('heading', { name: 'Otro módulo' });
    fireEvent.click(screen.getByRole('link', { name: 'Volver a Clínica' }));
    await screen.findByLabelText('Nombre');
    change('Nombre', 'Borrador nuevo');
    clinic = { ...clinic, name: 'Estado vigente del servidor' };
    await act(async () => {
      if (result === 'éxito') write.resolve({ ...original, name: 'Respuesta antigua' });
      else write.reject(rejected());
    });
    if (result === 'éxito') await waitFor(() => expect(client.getQueryData<ClinicDto>(['clinic'])?.name).toBe('Estado vigente del servidor'));
    expect(screen.getByLabelText('Nombre')).toHaveValue('Borrador nuevo');
    expect(screen.queryByText('Configuración guardada.')).not.toBeInTheDocument();
    expect(screen.queryByText('Zona rechazada por el servidor.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
  });

  it('ignora una confirmación de una sesión anterior incluso si el transporte no se cancela', async () => {
    const request = deferred<ClinicDto>();
    vi.mocked(clinicApi.update).mockReturnValueOnce(request.promise);
    const { client } = await setup();
    await screen.findByLabelText('Nombre');
    change('Nombre', 'Sesión anterior');
    submit();
    await waitFor(() => expect(clinicApi.update).toHaveBeenCalledTimes(1));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    act(() => useAuthStore.setState({ sessionVersion: useAuthStore.getState().sessionVersion + 1 }));
    await act(async () => request.resolve({ ...original, name: 'Confirmación vieja', timezone: 'UTC' }));
    expect(client.getQueryData<ClinicDto>(['clinic'])?.name).toBe(original.name);
    expect(screen.queryByText('Configuración guardada.')).not.toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('muestra carga, error y reintento sin presentar un formulario vacío inventado', async () => {
    const read = deferred<ClinicDto>();
    vi.mocked(clinicApi.get).mockReturnValueOnce(read.promise);
    await setup();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando configuración…');
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
    await act(async () => read.reject(new Error('Lectura fallida')));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la configuración de la clínica.');
    expect(clinicApi.get).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar lectura' }));
    expect(await screen.findByLabelText('Nombre')).toHaveValue(original.name);
    expect(clinicApi.get).toHaveBeenCalledTimes(2);
  });

  it('cambiar zona invalida solo consumidores relacionados y los activos vuelven a consultar al servidor', async () => {
    const { client } = await setup();
    await screen.findByLabelText('Nombre');
    [...affectedKeys, ...unrelatedKeys].forEach(key => client.setQueryData(key, { timezone: original.timezone }));
    const readPolicy = vi.fn(async () => ({ timezone: clinic.timezone }));
    const observer = new QueryObserver(client, { queryKey: ['booking-policy'], queryFn: readPolicy, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => undefined);
    change('Zona horaria (IANA)', 'America/Mexico_City');
    submit();
    await screen.findByText('Configuración guardada.');
    await waitFor(() => expect(observer.getCurrentResult().data?.timezone).toBe('America/Mexico_City'));
    expect(readPolicy).toHaveBeenCalledTimes(1);
    for (const key of affectedKeys.filter(key => key[0] !== 'booking-policy')) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    for (const key of unrelatedKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(client.getQueryData<ClinicDto>(['clinic'])?.timezone).toBe('America/Mexico_City');
    unsubscribe();
  });

  it('un GET dependiente iniciado antes del cambio de zona no repone resultados antiguos', async () => {
    const { client } = await setup();
    await screen.findByLabelText('Nombre');
    const oldRead = deferred<{ timezone: string }>();
    const readPolicy = vi.fn(async () => ({ timezone: clinic.timezone })).mockReturnValueOnce(oldRead.promise);
    const observer = new QueryObserver(client, { queryKey: ['booking-policy'], queryFn: readPolicy, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => undefined);
    await waitFor(() => expect(readPolicy).toHaveBeenCalledTimes(1));
    change('Zona horaria (IANA)', 'UTC');
    submit();
    await screen.findByText('Configuración guardada.');
    await waitFor(() => expect(readPolicy).toHaveBeenCalledTimes(2));
    await act(async () => oldRead.resolve({ timezone: original.timezone }));
    expect(observer.getCurrentResult().data?.timezone).toBe('UTC');
    unsubscribe();
  });

  it.each(['nombre', 'rechazo'])('no invalida consumidores de zona por %s', async scenario => {
    const { client } = await setup();
    await screen.findByLabelText('Nombre');
    affectedKeys.forEach(key => client.setQueryData(key, { timezone: original.timezone }));
    if (scenario === 'rechazo') {
      vi.mocked(clinicApi.update).mockRejectedValueOnce(rejected());
      change('Zona horaria (IANA)', 'UTC');
    } else change('Nombre', 'Nombre actualizado');
    submit();
    await screen.findByText(scenario === 'rechazo' ? 'No se pudo guardar la configuración.' : 'Configuración guardada.');
    for (const key of affectedKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it('un fallo al refrescar un consumidor no convierte el PUT confirmado en error ni repite la escritura', async () => {
    const { client } = await setup();
    await screen.findByLabelText('Nombre');
    client.setQueryData(['public-schedule'], { timezone: original.timezone });
    const observer = new QueryObserver(client, { queryKey: ['public-schedule'], queryFn: async () => { throw new Error('Fallo de lectura dependiente'); }, staleTime: Infinity, retry: false });
    const unsubscribe = observer.subscribe(() => undefined);
    change('Zona horaria (IANA)', 'UTC');
    submit();
    await screen.findByText('Configuración guardada.');
    await waitFor(() => expect(observer.getCurrentResult().isError).toBe(true));
    expect(screen.getByText('Configuración guardada.')).toBeVisible();
    expect(unloadBlocked()).toBe(false);
    expect(clinicApi.update).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
