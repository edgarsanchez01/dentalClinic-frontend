import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usersApi, type StaffUserDto, type UpdateDentistInput } from '../../api/users';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import { UnsavedChangesProvider } from '../../app/UnsavedChangesProvider';
import { TeamPage } from './TeamPage';

const profile = (firstName: string, lastName: string, photoUrl: string | null = null) => ({
  firstName, lastName, phone: '+34 600 000 000', specialty: null, licenseNumber: null, publicInfo: null, photoUrl,
});
const owner: StaffUserDto = { id: 1, email: 'owner@example.test', role: 'OWNER', active: true, status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z', dentist: profile('Ada', 'Owner') };
const first: StaffUserDto = { ...owner, id: 2, email: 'ana@example.test', role: 'DENTIST', dentist: profile('Ana', 'Alfa', 'https://example.test/ana.jpg') };
const second: StaffUserDto = { ...owner, id: 5, email: 'beatriz@example.test', role: 'DENTIST', dentist: profile('Beatriz', 'Beta', 'https://example.test/beatriz.jpg') };
const reception: StaffUserDto = { ...owner, id: 3, email: 'reception@example.test', role: 'RECEPTIONIST', dentist: null };
const routers: ReturnType<typeof createMemoryRouter>[] = [];
const clients: QueryClient[] = [];
let team: StaffUserDto[];

function updated(member: StaffUserDto, input: UpdateDentistInput): StaffUserDto {
  return { ...member, dentist: { ...member.dentist!, ...input } };
}

beforeEach(() => {
  team = structuredClone([owner, first, second, reception]);
  useAuthStore.setState({ status: 'authenticated', user: owner });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(usersApi, 'list').mockImplementation(async () => team);
  vi.spyOn(usersApi, 'updateDentistProfile').mockImplementation(async (id, input) => {
    const result = updated(team.find(member => member.id === id)!, input);
    team = team.map(member => member.id === id ? result : member);
    return result;
  });
  vi.spyOn(usersApi, 'setActive').mockImplementation(async (id, active) => ({
    ...team.find(member => member.id === id)!, active, status: active ? 'ACTIVE' : 'INACTIVE',
  }));
});

afterEach(() => {
  cleanup();
  routers.splice(0).forEach(router => router.dispose());
  clients.splice(0).forEach(client => client.clear());
  vi.restoreAllMocks();
  useAuthStore.setState({ status: 'anonymous', user: null });
});

async function setup(entries = ['/users'], index = entries.length - 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const router = createMemoryRouter([{ element: <UnsavedChangesProvider><Outlet /></UnsavedChangesProvider>, children: [
    { path: '/users', element: <><Link to="/other">Salir de Equipo</Link><TeamPage /></> },
    { path: '/other', element: <><h1>Otro módulo</h1><Link to="/users">Volver a Equipo</Link></> },
  ] }], { initialEntries: entries, initialIndex: index });
  routers.push(router);
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  await screen.findByRole('button', { name: 'Editar perfil Ana Alfa' });
  return { router, client };
}

function edit(name = 'Ana Alfa') {
  fireEvent.click(screen.getByRole('button', { name: `Editar perfil ${name}` }));
}

function editor(name = 'Ana Alfa') {
  return screen.getByRole('form', { name: `Editar perfil de ${name}` });
}

function change(label: string, value: string, form = editor()) {
  fireEvent.change(within(form).getByLabelText(label), { target: { value } });
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

const invalidPhone = () => new ApiError(400, {
  status: 400, error: 'Bad Request', message: 'El perfil no se pudo guardar.', path: '/api/users/2/dentist',
  timestamp: '2026-01-01T00:00:00Z', fieldErrors: { phone: 'Teléfono rechazado por el servidor.' },
}, 'Error');

describe('DC-OWNER-02 — identidad del editor de Equipo', () => {
  it('cambiar A → B sin cambios muestra los valores de B y envía su ID/payload, no los de A', async () => {
    await setup();
    edit();
    expect(within(editor()).getByLabelText('Nombre')).toHaveValue('Ana');
    edit('Beatriz Beta');
    const form = editor('Beatriz Beta');
    expect(within(form).getByLabelText('Nombre')).toHaveValue('Beatriz');
    expect(window.confirm).not.toHaveBeenCalled();
    change('Nombre', 'Beatriz editada', form);
    fireEvent.submit(form);
    await waitFor(() => expect(usersApi.updateDentistProfile).toHaveBeenCalledExactlyOnceWith(second.id, {
      firstName: 'Beatriz editada', lastName: 'Beta', phone: second.dentist!.phone,
      specialty: null, licenseNumber: null, publicInfo: null, photoUrl: second.dentist!.photoUrl,
    }));
    expect(await screen.findByText(/Perfil de «Beatriz editada Beta» actualizado/)).toBeVisible();
  });

  it.each(['otro perfil', 'cancelar', 'cambio de estado'])('%s confirma el descarte y quedarse conserva borrador, errores y foco', async action => {
    await setup();
    edit();
    change('Nombre', '   ');
    change('Especialidad (opcional)', 'Borrador de Ana');
    fireEvent.submit(editor());
    const issue = 'Escribe un nombre de hasta 100 caracteres.';
    expect(within(editor()).getByText(issue)).toBeVisible();
    const attempt = () => {
      if (action === 'otro perfil') edit('Beatriz Beta');
      else if (action === 'cancelar') fireEvent.click(within(editor()).getByRole('button', { name: 'Cancelar' }));
      else fireEvent.click(screen.getByRole('button', { name: 'Desactivar reception@example.test' }));
    };
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    attempt();
    expect(window.confirm).toHaveBeenLastCalledWith('¿Descartar los cambios sin guardar de este perfil?');
    expect(within(editor()).getByLabelText('Nombre')).toHaveValue('   ');
    expect(within(editor()).getByLabelText('Especialidad (opcional)')).toHaveValue('Borrador de Ana');
    expect(within(editor()).getByText(issue)).toBeVisible();
    expect(unloadBlocked()).toBe(true);
    expect(usersApi.updateDentistProfile).not.toHaveBeenCalled();
    expect(usersApi.setActive).not.toHaveBeenCalled();

    attempt();
    expect(screen.queryByRole('form', { name: 'Editar perfil de Ana Alfa' })).not.toBeInTheDocument();
    expect(unloadBlocked()).toBe(false);
    expect(usersApi.updateDentistProfile).not.toHaveBeenCalled();
    expect(usersApi.setActive).not.toHaveBeenCalled();
    if (action === 'otro perfil') {
      expect(within(editor('Beatriz Beta')).getByLabelText('Nombre')).toHaveValue('Beatriz');
      expect(within(editor('Beatriz Beta')).queryByText(issue)).not.toBeInTheDocument();
      expect(within(editor('Beatriz Beta')).getByLabelText('Nombre')).toHaveFocus();
    } else if (action === 'cancelar') {
      expect(screen.getByRole('button', { name: 'Editar perfil Ana Alfa' })).toHaveFocus();
    } else {
      expect(screen.getByRole('heading', { name: '¿Desactivar «reception@example.test»?' })).toBeVisible();
      expect(screen.getByRole('button', { name: 'Confirmar desactivación' })).toHaveFocus();
    }
  });

  it('seleccionar el mismo profesional conserva la instancia, el borrador y los errores sin confirmar', async () => {
    await setup();
    edit();
    const form = editor();
    change('Nombre', '');
    fireEvent.submit(form);
    edit();
    expect(editor()).toBe(form);
    expect(within(form).getByLabelText('Nombre')).toHaveValue('');
    expect(within(form).getByText('Escribe un nombre de hasta 100 caracteres.')).toBeVisible();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(usersApi.updateDentistProfile).not.toHaveBeenCalled();
  });

  it('un rechazo conserva los valores y errores propios; reintentar guarda el mismo ID y preserva la foto', async () => {
    vi.mocked(usersApi.updateDentistProfile).mockRejectedValueOnce(invalidPhone());
    await setup();
    edit();
    change('Nombre', 'Ana editada');
    fireEvent.submit(editor());
    expect(await within(editor()).findByText('Teléfono rechazado por el servidor.')).toBeVisible();
    expect(within(editor()).getByLabelText('Nombre')).toHaveValue('Ana editada');
    expect(within(editor()).getByText('El perfil no se pudo guardar.')).toBeVisible();
    expect(screen.queryByText(/actualizado/)).not.toBeInTheDocument();
    expect(unloadBlocked()).toBe(true);
    fireEvent.submit(editor());
    await screen.findByText('Perfil de «Ana editada Alfa» actualizado.');
    expect(usersApi.updateDentistProfile).toHaveBeenCalledTimes(2);
    expect(usersApi.updateDentistProfile).toHaveBeenLastCalledWith(first.id, {
      firstName: 'Ana editada', lastName: 'Alfa', phone: first.dentist!.phone,
      specialty: null, licenseNumber: null, publicInfo: null, photoUrl: first.dentist!.photoUrl,
    });
    expect(unloadBlocked()).toBe(false);
    expect(screen.getByRole('button', { name: 'Editar perfil Ana editada Alfa' })).toHaveFocus();
  });

  it('los errores del servidor de A no pasan al nuevo editor B', async () => {
    vi.mocked(usersApi.updateDentistProfile).mockRejectedValueOnce(invalidPhone());
    await setup();
    edit();
    change('Nombre', 'Ana editada');
    fireEvent.submit(editor());
    await within(editor()).findByText('Teléfono rechazado por el servidor.');
    edit('Beatriz Beta');
    expect(within(editor('Beatriz Beta')).getByLabelText('Nombre')).toHaveValue('Beatriz');
    expect(screen.queryByText('Teléfono rechazado por el servidor.')).not.toBeInTheDocument();
    expect(screen.queryByText('El perfil no se pudo guardar.')).not.toBeInTheDocument();
    expect(usersApi.updateDentistProfile).toHaveBeenCalledTimes(1);
  });

  it('bloquea los cambios de contexto, los campos y los envíos duplicados antes del siguiente render', async () => {
    const request = deferred<StaffUserDto>();
    vi.mocked(usersApi.updateDentistProfile).mockReturnValueOnce(request.promise);
    await setup();
    edit();
    change('Nombre', 'Ana enviada');
    const form = editor();
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      // Force the transition in the same batch, before disabled controls render.
      edit('Beatriz Beta');
      fireEvent.click(screen.getByRole('button', { name: 'Desactivar reception@example.test' }));
      fireEvent.click(within(form).getByRole('button', { name: 'Cancelar' }));
    });
    await waitFor(() => expect(usersApi.updateDentistProfile).toHaveBeenCalledTimes(1));
    expect(editor()).toBe(form);
    expect(within(form).getByLabelText('Nombre')).toBeDisabled();
    expect(within(form).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Editar perfil Beatriz Beta' })).toBeDisabled();
    change('Nombre', 'Cambio forzado durante envío');
    expect(within(form).getByLabelText('Nombre')).toHaveValue('Ana enviada');
    expect(window.confirm).not.toHaveBeenCalled();
    expect(usersApi.setActive).not.toHaveBeenCalled();
    await act(async () => request.resolve(updated(first, { firstName: 'Ana enviada', lastName: 'Alfa', phone: first.dentist!.phone })));
    expect(await screen.findByText('Perfil de «Ana enviada Alfa» actualizado.')).toBeVisible();
  });

  it.each(['éxito', 'rechazo'])('una respuesta tardía (%s) del editor desmontado no toca el nuevo editor B ni su caché', async result => {
    const request = deferred<StaffUserDto>();
    vi.mocked(usersApi.updateDentistProfile).mockReturnValueOnce(request.promise);
    const { client } = await setup();
    edit();
    change('Nombre', 'Ana enviada');
    fireEvent.submit(editor());
    await waitFor(() => expect(usersApi.updateDentistProfile).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('link', { name: 'Salir de Equipo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Guardado en curso' });
    expect(within(dialog).getByText('Hay un guardado en curso. Salir no garantiza que la operación se cancele')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salir de esta vista' }));
    await screen.findByRole('heading', { name: 'Otro módulo' });
    fireEvent.click(screen.getByRole('link', { name: 'Volver a Equipo' }));
    await screen.findByRole('button', { name: 'Editar perfil Beatriz Beta' });
    edit('Beatriz Beta');
    const form = editor('Beatriz Beta');
    change('Nombre', '', form);
    fireEvent.submit(form);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await act(async () => {
      if (result === 'éxito') request.resolve(updated(first, { firstName: 'Ana enviada', lastName: 'Alfa', phone: first.dentist!.phone }));
      else request.reject(invalidPhone());
    });
    expect(editor('Beatriz Beta')).toBe(form);
    expect(within(form).getByLabelText('Nombre')).toHaveValue('');
    expect(within(form).getByText('Escribe un nombre de hasta 100 caracteres.')).toBeVisible();
    expect(within(form).getByRole('button', { name: 'Guardar cambios' })).toBeEnabled();
    expect(screen.queryByText(/actualizado/)).not.toBeInTheDocument();
    expect(screen.queryByText('Teléfono rechazado por el servidor.')).not.toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('un refetch del listado no reinicia el editor activo ni sus errores', async () => {
    const { client } = await setup();
    edit();
    const form = editor();
    change('Nombre', '');
    fireEvent.submit(form);
    team = team.map(member => member.id === first.id ? updated(member, { firstName: 'Nombre remoto', lastName: 'Alfa', phone: first.dentist!.phone }) : member);
    await act(async () => { await client.invalidateQueries({ queryKey: ['users'] }); });
    expect(editor()).toBe(form);
    expect(within(form).getByLabelText('Nombre')).toHaveValue('');
    expect(within(form).getByText('Escribe un nombre de hasta 100 caracteres.')).toBeVisible();
  });

  it('navegación con provider/data router reales protege el borrador y sus errores sin persistirlos', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const { router } = await setup();
    edit();
    change('Nombre', '');
    fireEvent.submit(editor());
    fireEvent.click(screen.getByRole('link', { name: 'Salir de Equipo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Seguir aquí' }));
    expect(router.state.location.pathname).toBe('/users');
    expect(within(editor()).getByLabelText('Nombre')).toHaveValue('');
    expect(within(editor()).getByText('Escribe un nombre de hasta 100 caracteres.')).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Salir de Equipo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
    expect(await screen.findByRole('heading', { name: 'Otro módulo' })).toBeVisible();
    expect(usersApi.updateDentistProfile).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    expect(unloadBlocked()).toBe(false);
  });

  it.each([[-1, ['/other', '/users'], 1], [1, ['/users', '/other'], 0]] as const)(
    'protege Back/Forward (%s) manteniendo historial y borrador al quedarse', async (direction, entries, index) => {
      const { router } = await setup([...entries], index);
      edit();
      change('Nombre', 'Ana local');
      await act(async () => { await router.navigate(direction); });
      fireEvent.click(await screen.findByRole('button', { name: 'Seguir aquí' }));
      expect(router.state.location.pathname).toBe('/users');
      expect(within(editor()).getByLabelText('Nombre')).toHaveValue('Ana local');
      await act(async () => { await router.navigate(direction); });
      fireEvent.click(await screen.findByRole('button', { name: 'Salir sin guardar' }));
      expect(await screen.findByRole('heading', { name: 'Otro módulo' })).toBeVisible();
      expect(router.state.historyAction).toBe('POP');
      expect(usersApi.updateDentistProfile).not.toHaveBeenCalled();
    },
  );

  it('no protege un formulario intacto o revertido, pero protege un guardado pendiente aunque esté intacto', async () => {
    const request = deferred<StaffUserDto>();
    vi.mocked(usersApi.updateDentistProfile).mockReturnValueOnce(request.promise);
    await setup();
    edit();
    expect(unloadBlocked()).toBe(false);
    change('Nombre', 'Modificado');
    expect(unloadBlocked()).toBe(true);
    change('Nombre', 'Ana');
    expect(unloadBlocked()).toBe(false);
    fireEvent.submit(editor());
    await waitFor(() => expect(usersApi.updateDentistProfile).toHaveBeenCalledTimes(1));
    expect(unloadBlocked()).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Salir de Equipo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Seguir aquí' }));
    expect(editor()).toBeVisible();
    await act(async () => request.reject(invalidPhone()));
    expect(await within(editor()).findByText('El perfil no se pudo guardar.')).toBeVisible();
    expect(unloadBlocked()).toBe(false);
  });
});
