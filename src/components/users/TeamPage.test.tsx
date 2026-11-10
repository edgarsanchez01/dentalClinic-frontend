import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '../../app/authStore';
import { TeamPage } from './TeamPage';

const OWNER = {
  id: 1, email: 'duena@clinica.test', role: 'OWNER', active: true, status: 'ACTIVE',
  createdAt: '2026-10-10T00:00:00Z',
  dentist: { firstName: 'Ada', lastName: 'Owner', phone: '+34 600 000 000', specialty: null,
    licenseNumber: null, publicInfo: null, photoUrl: null },
};
const DENTIST_PENDING = {
  id: 2, email: 'dentista@clinica.test', role: 'DENTIST', active: false, status: 'PENDING',
  createdAt: '2026-10-10T00:00:00Z',
  dentist: { firstName: 'Luis', lastName: 'Gomez', phone: '+34 611 111 111', specialty: 'Endodoncia',
    licenseNumber: null, publicInfo: null, photoUrl: 'https://cdn/old.jpg' },
};
const DENTIST_ACTIVE = {
  id: 5, email: 'activo@clinica.test', role: 'DENTIST', active: true, status: 'ACTIVE',
  createdAt: '2026-10-11T00:00:00Z',
  dentist: { firstName: 'Sara', lastName: 'Ruiz', phone: '+34 611 222 222', specialty: null,
    licenseNumber: null, publicInfo: null, photoUrl: null },
};
const RECEPTIONIST = {
  id: 3, email: 'recepcion@clinica.test', role: 'RECEPTIONIST', active: true, status: 'ACTIVE',
  createdAt: '2026-10-10T00:00:00Z', dentist: null,
};
const RECEPTIONIST_INACTIVE = {
  id: 6, email: 'baja@clinica.test', role: 'RECEPTIONIST', active: false, status: 'INACTIVE',
  createdAt: '2026-10-12T00:00:00Z', dentist: null,
};
const PATIENT = {
  id: 4, email: 'paciente@clinica.test', role: 'PATIENT', active: true, status: 'ACTIVE',
  createdAt: '2026-10-10T00:00:00Z', dentist: null,
};

type Request = { path: string; method: string; body: unknown };

const writeText = vi.fn().mockResolvedValue(undefined);

function setup() {
  const team = [OWNER, DENTIST_PENDING, DENTIST_ACTIVE, RECEPTIONIST, RECEPTIONIST_INACTIVE, PATIENT];
  const requests: Request[] = [];
  const reply = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost:5174');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path: url.pathname, method, body });
    const dentistMatch = url.pathname.match(/^\/api\/users\/(\d+)\/dentist$/);
    if (method === 'PUT' && dentistMatch) {
      const member = team.find((item) => item.id === Number(dentistMatch[1]))!;
      return reply({ ...member, dentist: { ...member.dentist, ...(body as object) } });
    }
    const activeMatch = url.pathname.match(/^\/api\/users\/(\d+)\/active$/);
    if (method === 'PATCH' && activeMatch) {
      const member = team.find((item) => item.id === Number(activeMatch[1]))!;
      const active = Boolean((body as { active?: boolean }).active);
      return reply({ ...member, active, status: active ? 'ACTIVE' : 'INACTIVE' });
    }
    if (method === 'POST') {
      return reply({ userId: DENTIST_PENDING.id, email: DENTIST_PENDING.email, token: 'tok-123' });
    }
    return reply(team);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: OWNER.id, email: OWNER.email, role: 'OWNER', active: true, createdAt: OWNER.createdAt },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TeamPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { requests };
}

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (navigator as { clipboard?: unknown }).clipboard;
  useAuthStore.setState({ status: 'anonymous', user: null });
});

describe('Equipo: listado, estado y edición (Fase 8A)', () => {
  it('F7 CTA de cabecera enfoca el único formulario y conserva datos al alternar función', async () => {
    const { requests } = setup();
    await screen.findByText(OWNER.email);
    const email = screen.getByLabelText('Email');
    fireEvent.change(email, { target: { value: 'borrador@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invitar al equipo' }));
    expect(email).toHaveFocus();
    expect(document.querySelectorAll('#team-invitation form')).toHaveLength(1);
    const buttons = screen.getAllByRole('button', { name: 'Invitar recepción' });
    fireEvent.click(buttons[0]);
    expect(screen.queryByLabelText('Especialidad (opcional)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Invitar odontólogo' }));
    expect(screen.getByLabelText('Email')).toHaveValue('borrador@example.test');
    expect(document.querySelectorAll('#team-invitation form')).toHaveLength(1);
    expect(requests.filter(request => request.method !== 'GET')).toHaveLength(0);
  });

  it('muestra solo personal y etiqueta cada rol sin confundir pacientes con propietario', async () => {
    setup();
    await screen.findByText('Propietario');

    expect(screen.getAllByText('Odontólogo')).toHaveLength(2);
    expect(screen.getAllByText('Recepción')).toHaveLength(2);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByText('paciente@clinica.test')).not.toBeInTheDocument();
  });

  it('distingue activo, pendiente e inactivo en las insignias', async () => {
    setup();
    await screen.findByText('Propietario');

    expect(screen.getAllByText('Activo')).toHaveLength(3);
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
  });

  it('permite reemitir y copiar el enlace solo para cuentas pendientes', async () => {
    const { requests } = setup();
    await screen.findByText('Propietario');

    const buttons = screen.getAllByRole('button', { name: 'Copiar enlace de activación' });
    expect(buttons).toHaveLength(1);

    fireEvent.click(buttons[0]);

    const link = await screen.findByLabelText('Enlace de activación');
    expect((link as HTMLInputElement).value).toMatch(/\/activate\?token=tok-123$/);
    expect(requests).toContainEqual({
      path: `/api/users/${DENTIST_PENDING.id}/invitations/resend`, method: 'POST', body: undefined,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith((link as HTMLInputElement).value));
  });

  it('edita el perfil de un odontólogo con PUT y preserva la foto existente', async () => {
    const { requests } = setup();
    await screen.findByText('Propietario');

    fireEvent.click(screen.getByRole('button', { name: /Editar perfil.*Sara Ruiz/ }));
    const editor = await screen.findByRole('form', { name: 'Editar perfil de Sara Ruiz' });

    fireEvent.change(within(editor).getByLabelText('Nombre'), { target: { value: 'Luis Miguel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(requests.some((r) => r.method === 'PUT')).toBe(true));
    const put = requests.find((r) => r.method === 'PUT')!;
    expect(put.path).toBe(`/api/users/${DENTIST_ACTIVE.id}/dentist`);
    expect(put.body).toMatchObject({ firstName: 'Luis Miguel' });

    await screen.findByText(/actualizado/);
  });

  it('no envía la edición si los campos obligatorios están vacíos', async () => {
    const { requests } = setup();
    await screen.findByText('Propietario');

    fireEvent.click(screen.getByRole('button', { name: /Editar perfil.*Ada Owner/ }));
    const editor = await screen.findByRole('form', { name: 'Editar perfil de Ada Owner' });
    fireEvent.change(within(editor).getByLabelText('Nombre'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
    expect(screen.getByText('Escribe un nombre de hasta 100 caracteres.')).toBeInTheDocument();
  });

  it('desactiva una cuenta tras confirmar, con PATCH y el estado reflejado', async () => {
    const { requests } = setup();
    await screen.findByText('Propietario');

    fireEvent.click(screen.getByRole('button', { name: /Desactivar.*recepcion@clinica.test/ }));
    expect(await screen.findByRole('heading', { name: /¿Desactivar «recepcion@clinica.test»\?/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar desactivación' }));

    await waitFor(() => expect(requests.some((r) => r.method === 'PATCH')).toBe(true));
    const patch = requests.find((r) => r.method === 'PATCH')!;
    expect(patch.path).toBe(`/api/users/${RECEPTIONIST.id}/active`);
    expect(patch.body).toEqual({ active: false });
  });

  it('reactiva una cuenta inactiva', async () => {
    const { requests } = setup();
    await screen.findByText('Propietario');

    fireEvent.click(screen.getByRole('button', { name: /Reactivar.*baja@clinica.test/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar reactivación' }));

    await waitFor(() => expect(requests.some((r) => r.method === 'PATCH')).toBe(true));
    expect(requests.find((r) => r.method === 'PATCH')!.body).toEqual({ active: true });
  });

  it('no ofrece desactivar la propia cuenta ni la del propietario', async () => {
    setup();
    await screen.findByText('Propietario');

    expect(screen.queryByRole('button', { name: /Desactivar.*duena@clinica.test/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Editar perfil.*Ada Owner/ })).toBeInTheDocument();
  });

  it('no permite cambiar el estado de una cuenta pendiente (solo reenviar)', async () => {
    setup();
    await screen.findByText('Propietario');

    expect(screen.queryByRole('button', { name: /Desactivar.*dentista@clinica.test/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copiar enlace de activación' })).toBeInTheDocument();
  });
});
