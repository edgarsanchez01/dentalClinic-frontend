import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { schedulingApi, type DentistScheduleDto, type TimeOffDto } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { UnsavedChangesProvider } from '../../app/UnsavedChangesProvider';
import { SchedulingPage } from './SchedulingPage';
import { WeekEditor } from './WeekEditor';

const timezone = 'Europe/Madrid';
const week = (startTime = '09:00:00', dentistId = 7): DentistScheduleDto => ({ dentistId, timezone,
  days: [{ dayOfWeek: 1, open: true, startTime, endTime: '17:00:00', breaks: [] }],
});
const actor = { id: 10, role: 'DENTIST' as const, dentistId: 7, email: 'dentist@example.test', active: true, createdAt: '2026-01-01T00:00:00Z' };
const clients: QueryClient[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  useAuthStore.setState({ status: 'authenticated', user: actor });
  vi.spyOn(schedulingApi, 'getPublicSchedule').mockResolvedValue({ timezone, days: [], exceptions: [], dentists: [
    { dentistId: 7, firstName: 'Mi', lastName: 'Perfil', days: [] },
    { dentistId: 8, firstName: 'Otro', lastName: 'Perfil', days: [] },
  ] });
  vi.spyOn(schedulingApi, 'getDentistSchedule').mockImplementation(async (id) => week('09:00:00', id));
  vi.spyOn(schedulingApi, 'listDentistExceptions').mockResolvedValue([]);
  vi.spyOn(schedulingApi, 'listTimeOff').mockResolvedValue([]);
  vi.spyOn(schedulingApi, 'getClinicSchedule').mockResolvedValue({ timezone, days: week().days });
  vi.spyOn(schedulingApi, 'listClinicExceptions').mockResolvedValue([]);
  vi.spyOn(schedulingApi, 'getPolicy').mockResolvedValue({ timezone, maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 });
  vi.spyOn(schedulingApi, 'replaceDentistWeek').mockImplementation(async (dentistId, days) => ({ dentistId, timezone, days }));
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

async function setup(editWeek = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } } });
  clients.push(client);
  const router = createMemoryRouter([{ element: <UnsavedChangesProvider><Outlet /></UnsavedChangesProvider>, children: [
    { path: '/scheduling', element: <><Link to="/other">Salir de horarios</Link><SchedulingPage /></> },
    { path: '/other', element: <p>Página destino</p> },
  ] }], { initialEntries: ['/other', '/scheduling'] });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  await screen.findByRole('tablist', { name: 'Gestionar mi horario' });
  const tools = document.getElementById('professional-schedule-tools')!;
  if (editWeek) {
    await openWeek(tools);
    await within(tools).findByLabelText('Inicio Lunes');
  } else await within(tools).findByRole('button', { name: 'Editar horario' });
  return { client, router, tools };
}

async function openWeek(tools: HTMLElement) {
  const button = await within(tools).findByRole('button', { name: 'Editar horario' });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

function select(tools: HTMLElement, name: string) {
  fireEvent.click(within(tools).getByRole('tab', { name }));
  return within(tools).getByRole('tabpanel', { name });
}

function changeStart(tools: HTMLElement, value: string) {
  const field = within(tools).getByLabelText('Inicio Lunes');
  fireEvent.change(field, { target: { value } });
  return field;
}

function submit(tools: HTMLElement) {
  fireEvent.submit(within(tools).getByLabelText('Inicio Lunes').closest('form')!);
}

function unloadBlocked() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

async function refetch(client: QueryClient) {
  await act(async () => { await client.invalidateQueries({ queryKey: ['dentist-schedule', 7], exact: true }); });
}

describe('UX01 BUILD02 — referencia semanal y borradores en memoria', () => {
  it('acepta un refresco limpio sin remontar el editor y no protege un formulario intacto', async () => {
    const { client, tools } = await setup();
    const input = within(tools).getByLabelText('Inicio Lunes');
    vi.mocked(schedulingApi.getDentistSchedule).mockResolvedValue(week('08:00:00'));
    await refetch(client);
    expect(within(tools).getByLabelText('Inicio Lunes')).toBe(input);
    await waitFor(() => expect(input).toHaveValue('08:00'));
    expect(unloadBlocked()).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: 'Salir de horarios' }));
    expect(await screen.findByText('Página destino')).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('conserva valores y errores ante refrescos y errores de lectura; también estando oculto', async () => {
    const { client, tools } = await setup();
    const input = changeStart(tools, '');
    submit(tools);
    select(tools, 'Excepciones');
    vi.mocked(schedulingApi.getDentistSchedule).mockResolvedValue(week('08:00:00'));
    await refetch(client);
    vi.mocked(schedulingApi.getDentistSchedule).mockRejectedValue(new Error('Refresco fallido'));
    await refetch(client);
    expect(unloadBlocked()).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    select(tools, 'Mi semana');
    expect(within(tools).getByLabelText('Inicio Lunes')).toBe(input);
    expect(input).toHaveValue('');
    expect(within(tools).getByText('Lunes: indica la hora de apertura y la de cierre.')).toBeVisible();
    expect(schedulingApi.replaceDentistWeek).not.toHaveBeenCalled();
  });

  it('al revertir un borrador acepta el último refresco que había quedado pendiente', async () => {
    const { client, tools } = await setup();
    changeStart(tools, '10:00');
    vi.mocked(schedulingApi.getDentistSchedule).mockResolvedValue(week('08:00:00'));
    await refetch(client);
    expect(within(tools).getByLabelText('Inicio Lunes')).toHaveValue('10:00');
    changeStart(tools, '09:00');
    await waitFor(() => expect(within(tools).getByLabelText('Inicio Lunes')).toHaveValue('08:00'));
    expect(unloadBlocked()).toBe(false);
  });

  it('adopta la respuesta confirmada, conserva el contrato y libera la protección tras guardar', async () => {
    const { tools, client } = await setup();
    vi.mocked(schedulingApi.replaceDentistWeek).mockResolvedValue(week('10:15:00'));
    changeStart(tools, '10:00');
    submit(tools);
    await within(tools).findByText('Horario del dentista guardado.');
    await openWeek(tools);
    await waitFor(() => expect(within(tools).getByLabelText('Inicio Lunes')).toHaveValue('10:15'));
    expect(schedulingApi.replaceDentistWeek).toHaveBeenCalledExactlyOnceWith(7, [{ dayOfWeek: 1, open: true, startTime: '10:00', endTime: '17:00', breaks: [] }]);
    expect(client.getQueryData(['dentist-schedule', 7])).toEqual(week('10:15:00'));
    expect(unloadBlocked()).toBe(false);
    changeStart(tools, '11:00');
    expect(unloadBlocked()).toBe(true);
    changeStart(tools, '10:15');
    expect(unloadBlocked()).toBe(false);
  });

  it('un guardado fallido conserva los valores y permite reintentar', async () => {
    const { tools } = await setup();
    vi.mocked(schedulingApi.replaceDentistWeek).mockRejectedValueOnce(new Error('Guardado fallido'));
    const input = changeStart(tools, '10:00');
    submit(tools);
    await within(tools).findByText('Guardado fallido');
    expect(input).toHaveValue('10:00');
    expect(unloadBlocked()).toBe(true);
    submit(tools);
    await within(tools).findByText('Horario del dentista guardado.');
    await waitFor(() => expect(unloadBlocked()).toBe(false));
  });

  it('una respuesta tardía no pisa las modificaciones ni errores posteriores al envío', async () => {
    const request = deferred<DentistScheduleDto>();
    vi.mocked(schedulingApi.replaceDentistWeek).mockReturnValueOnce(request.promise);
    const { tools } = await setup();
    changeStart(tools, '10:00');
    submit(tools);
    await within(tools).findByRole('button', { name: 'Guardando…' });
    changeStart(tools, '');
    submit(tools); // A new validation error while the original request is still pending.
    select(tools, 'Ausencias');
    await act(async () => request.resolve(week('10:00:00')));
    select(tools, 'Mi semana');
    expect(within(tools).getByLabelText('Inicio Lunes')).toHaveValue('');
    expect(within(tools).getByText('Lunes: indica la hora de apertura y la de cierre.')).toBeVisible();
    expect(unloadBlocked()).toBe(true);
    expect(schedulingApi.replaceDentistWeek).toHaveBeenCalledTimes(1);
    changeStart(tools, '10:00');
    expect(unloadBlocked()).toBe(false); // The new baseline is the confirmed response.
  });

  it('no envía dos guardados aunque se fuerce submit durante la solicitud', async () => {
    const request = deferred<DentistScheduleDto>();
    vi.mocked(schedulingApi.replaceDentistWeek).mockReturnValue(request.promise);
    const { tools } = await setup();
    changeStart(tools, '10:00');
    submit(tools);
    submit(tools);
    await waitFor(() => expect(schedulingApi.replaceDentistWeek).toHaveBeenCalledTimes(1));
    await act(async () => request.resolve(week('10:00:00')));
  });

  it('un GET iniciado durante el PUT no reemplaza después su respuesta confirmada', async () => {
    const save = deferred<DentistScheduleDto>();
    const get = deferred<DentistScheduleDto>();
    const { client, tools } = await setup();
    vi.mocked(schedulingApi.replaceDentistWeek).mockReturnValueOnce(save.promise);
    changeStart(tools, '10:00');
    submit(tools);
    await waitFor(() => expect(schedulingApi.replaceDentistWeek).toHaveBeenCalledTimes(1));
    vi.mocked(schedulingApi.getDentistSchedule).mockReturnValueOnce(get.promise);
    let refresh!: Promise<void>;
    act(() => { refresh = client.invalidateQueries({ queryKey: ['dentist-schedule', 7], exact: true }); });
    await waitFor(() => expect(client.isFetching({ queryKey: ['dentist-schedule', 7] })).toBe(1));
    await act(async () => save.resolve(week('10:00:00')));
    await act(async () => { get.resolve(week()); await refresh; });
    await openWeek(tools);
    expect(within(tools).getByLabelText('Inicio Lunes')).toHaveValue('10:00');
    expect(client.getQueryData(['dentist-schedule', 7])).toEqual(week('10:00:00'));
    expect(unloadBlocked()).toBe(false);
  });
});

describe('UX01 BUILD02 — navegación, operaciones y aislamiento', () => {
  it('protege cambios ocultos al navegar Atrás, mantiene el foco al quedarse y sale al confirmar', async () => {
    const { tools, router } = await setup();
    changeStart(tools, '10:00');
    select(tools, 'Ausencias');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => { await router.navigate(-1); });
    expect(screen.getByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir aquí' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    select(tools, 'Mi semana');
    expect(within(tools).getByLabelText('Inicio Lunes')).toHaveValue('10:00');
    fireEvent.click(screen.getByRole('link', { name: 'Salir de horarios' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salir sin guardar' }));
    expect(await screen.findByText('Página destino')).toBeVisible();
    expect(unloadBlocked()).toBe(false);
  });

  it('distingue un guardado pendiente incluso sin borrador y actualiza el diálogo al terminar', async () => {
    const request = deferred<DentistScheduleDto>();
    vi.mocked(schedulingApi.replaceDentistWeek).mockReturnValueOnce(request.promise);
    const { tools } = await setup();
    submit(tools); // Saving an unchanged week still registers an operation.
    await within(tools).findByRole('button', { name: 'Guardando…' });
    select(tools, 'Excepciones');
    expect(unloadBlocked()).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Salir de horarios' }));
    const dialog = screen.getByRole('dialog', { name: 'Guardado en curso' });
    expect(dialog).toHaveTextContent('Hay un guardado en curso. Salir no garantiza que la operación se cancele');
    expect(dialog).not.toHaveTextContent(/cobro|finalización|clave/);
    expect(within(dialog).getByRole('button', { name: 'Salir de esta vista' })).toBeVisible();
    await act(async () => request.resolve(week()));
    expect(screen.getByRole('dialog', { name: 'Operación finalizada' })).toBeVisible();
    expect(screen.queryByText('Página destino')).not.toBeInTheDocument(); // Never auto-navigate.
    fireEvent.click(screen.getByRole('button', { name: 'Salir de esta vista' }));
    expect(await screen.findByText('Página destino')).toBeVisible();
  });

  it.each(['Excepciones', 'Ausencias'])('también protege el borrador oculto de %s, sin cambiar sus formularios', async (name) => {
    const { tools } = await setup();
    const panel = select(tools, name);
    if (name === 'Excepciones') {
      await waitFor(() => expect(within(panel).getByRole('button', { name: 'Nueva excepción' })).toBeEnabled());
      fireEvent.click(within(panel).getByRole('button', { name: 'Nueva excepción' }));
    } else {
      await waitFor(() => expect(within(panel).getByRole('button', { name: 'Nueva ausencia' })).toBeEnabled());
      fireEvent.click(within(panel).getByRole('button', { name: 'Nueva ausencia' }));
    }
    const reason = await within(panel).findByLabelText('Motivo (opcional)');
    expect(unloadBlocked()).toBe(false);
    fireEvent.change(reason, { target: { value: 'Borrador sin enviar' } });
    select(tools, 'Mi semana');
    expect(unloadBlocked()).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Salir de horarios' }));
    expect(screen.getByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir aquí' }));
    select(tools, name);
    expect(reason).toHaveValue('Borrador sin enviar');
    fireEvent.change(reason, { target: { value: '' } });
    expect(unloadBlocked()).toBe(false);
  });

  it.each(['usuario', 'profesional', 'sesión'] as const)('descarta registros anteriores y aísla respuestas tardías al cambiar de %s', async (boundary) => {
    const request = deferred<DentistScheduleDto>();
    vi.mocked(schedulingApi.replaceDentistWeek).mockReturnValueOnce(request.promise);
    const { client, tools: previousTools } = await setup();
    const previousInput = changeStart(previousTools, '10:00');
    submit(previousTools);
    await waitFor(() => expect(schedulingApi.replaceDentistWeek).toHaveBeenCalledTimes(1));
    act(() => {
      client.setQueryData(['dentist-schedule', 7], week('08:00:00'));
      const state = useAuthStore.getState();
      if (boundary === 'sesión') useAuthStore.setState({ sessionVersion: state.sessionVersion + 1 });
      else useAuthStore.setState({ user: { ...actor, ...(boundary === 'usuario' ? { id: 11 } : { dentistId: 8 }) } });
    });
    const tools = document.getElementById('professional-schedule-tools')!;
    expect(previousInput).not.toBeInTheDocument();
    await openWeek(tools);
    await waitFor(() => expect(within(tools).getByLabelText('Inicio Lunes')).toHaveValue(boundary === 'profesional' ? '09:00' : '08:00'));
    await act(async () => request.resolve(week('10:00:00')));
    expect(within(tools).getByLabelText('Inicio Lunes')).toHaveValue(boundary === 'profesional' ? '09:00' : '08:00');
    expect(client.getQueryData(['dentist-schedule', 7])).toEqual(boundary === 'profesional' ? undefined : week('08:00:00'));
    expect(unloadBlocked()).toBe(false);
    expect(within(tools).queryByText('Horario del dentista guardado.')).not.toBeInTheDocument();
  });

  it('volver a la misma identidad no reactiva callbacks de una instancia ya desmontada', async () => {
    const request = deferred<DentistScheduleDto>();
    vi.mocked(schedulingApi.replaceDentistWeek).mockReturnValueOnce(request.promise);
    const { client, tools: previousTools } = await setup();
    const previousInput = changeStart(previousTools, '10:00');
    submit(previousTools);
    await waitFor(() => expect(schedulingApi.replaceDentistWeek).toHaveBeenCalledTimes(1));
    act(() => useAuthStore.setState({ user: { ...actor, dentistId: 8 } }));
    await waitFor(() => expect(client.getQueryData(['dentist-schedule', 8])).toEqual(week('09:00:00', 8)));
    act(() => useAuthStore.setState({ user: actor }));
    const tools = document.getElementById('professional-schedule-tools')!;
    expect(previousInput).not.toBeInTheDocument();
    await openWeek(tools);
    await waitFor(() => expect(within(tools).getByLabelText('Inicio Lunes')).toHaveValue('09:00'));
    await act(async () => request.resolve(week('10:00:00')));
    expect(within(tools).getByLabelText('Inicio Lunes')).toHaveValue('09:00');
    expect(client.getQueryData(['dentist-schedule', 7])).toEqual(week());
    expect(unloadBlocked()).toBe(false);
  });
});

describe('UX01 BUILD04 — consulta y edición consistente', () => {
  const timeOff: TimeOffDto = { id: 40, startDate: '2026-11-03', endDate: '2026-11-03', allDay: false, startTime: '10:00:00', endTime: '11:00:00', reason: 'Ausencia registrada' };

  async function newAbsence(tools: HTMLElement) {
    const panel = select(tools, 'Ausencias');
    const button = await within(panel).findByRole('button', { name: 'Nueva ausencia' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    return panel;
  }

  it('inicia en consulta con siete días, sin inventar horarios faltantes ni selector privado', async () => {
    const { tools } = await setup(false);
    expect(within(tools).queryByLabelText('Dentista')).not.toBeInTheDocument();
    expect(within(tools).queryByLabelText('Inicio Lunes')).not.toBeInTheDocument();
    expect(tools.querySelectorAll('.reception-week-row')).toHaveLength(7);
    expect(within(tools).getAllByText('Sin horario registrado')).toHaveLength(6);
    expect(within(tools).getByText('09:00–17:00')).toBeVisible();
    expect(unloadBlocked()).toBe(false);
  });

  it('cancelar una edición semanal limpia vuelve a consulta y restaura el foco sin confirmar', async () => {
    const { tools } = await setup();
    fireEvent.click(within(tools).getByRole('button', { name: 'Cancelar' }));
    expect(within(tools).queryByLabelText('Inicio Lunes')).not.toBeInTheDocument();
    expect(within(tools).getByRole('button', { name: 'Editar horario' })).toHaveFocus();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(unloadBlocked()).toBe(false);
  });

  it('cancelar cambios semanales conserva o descarta valores/errores y adopta el último refresco', async () => {
    const { tools, client } = await setup();
    changeStart(tools, '');
    submit(tools);
    vi.mocked(schedulingApi.getDentistSchedule).mockResolvedValue(week('08:00:00'));
    await refetch(client);
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(within(tools).getByRole('button', { name: 'Cancelar' }));
    expect(within(tools).getByText('Lunes: indica la hora de apertura y la de cierre.')).toBeVisible();
    expect(unloadBlocked()).toBe(true);
    fireEvent.click(within(tools).getByRole('button', { name: 'Cancelar' }));
    expect(within(tools).queryByLabelText('Inicio Lunes')).not.toBeInTheDocument();
    expect(await within(tools).findByText('08:00–17:00')).toBeVisible();
    expect(unloadBlocked()).toBe(false);
    await openWeek(tools);
    expect(within(tools).getByLabelText('Inicio Lunes')).toHaveValue('08:00');
    expect(within(tools).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('un éxito vuelve a consulta; si hay ediciones posteriores al envío mantiene abierto su borrador', async () => {
    const { tools } = await setup();
    const request = deferred<DentistScheduleDto>();
    vi.mocked(schedulingApi.replaceDentistWeek).mockReturnValueOnce(request.promise);
    changeStart(tools, '10:00');
    submit(tools);
    await within(tools).findByRole('button', { name: 'Guardando…' });
    expect(within(tools).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    changeStart(tools, '11:00');
    await act(async () => request.resolve(week('10:00:00')));
    expect(within(tools).getByLabelText('Inicio Lunes')).toHaveValue('11:00');
    expect(unloadBlocked()).toBe(true);
    submit(tools);
    await waitFor(() => expect(within(tools).queryByLabelText('Inicio Lunes')).not.toBeInTheDocument());
    expect(within(tools).getByText('11:00–17:00')).toBeVisible();
    expect(unloadBlocked()).toBe(false);
  });

  it('Ausencias inicia como listado vacío; abre inline y cancela intacto sin confirmar', async () => {
    const { tools } = await setup(false);
    const panel = select(tools, 'Ausencias');
    expect(await within(panel).findByText('Sin ausencias registradas.')).toBeVisible();
    expect(within(panel).getByRole('heading', { name: 'Ausencias programadas' })).toBeVisible();
    expect(within(panel).queryByLabelText('Desde')).not.toBeInTheDocument();
    await newAbsence(tools);
    expect(within(panel).getByRole('form', { name: 'Nueva ausencia' })).toBeVisible();
    expect(within(panel).getByLabelText('Desde')).toHaveFocus();
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancelar' }));
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Nueva ausencia' })).toHaveFocus();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('cancelar una ausencia modificada confirma y no descarta el borrador de Mi semana', async () => {
    const { tools } = await setup();
    changeStart(tools, '10:00');
    const panel = await newAbsence(tools);
    fireEvent.change(within(panel).getByLabelText('Motivo (opcional)'), { target: { value: 'Borrador' } });
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancelar' }));
    expect(within(panel).getByLabelText('Motivo (opcional)')).toHaveValue('Borrador');
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancelar' }));
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument();
    expect(unloadBlocked()).toBe(true);
    select(tools, 'Mi semana');
    expect(within(tools).getByLabelText('Inicio Lunes')).toHaveValue('10:00');
  });

  it('registra la ausencia con el payload existente, cierra y sincroniza el listado', async () => {
    let records: TimeOffDto[] = [];
    vi.mocked(schedulingApi.listTimeOff).mockImplementation(async () => records);
    const save = vi.spyOn(schedulingApi, 'createTimeOff').mockImplementation(async (_id, input) => {
      const result = { id: 50, allDay: input.startTime == null, ...input };
      records = [result]; return result;
    });
    const { tools } = await setup(false);
    const panel = await newAbsence(tools);
    fireEvent.change(within(panel).getByLabelText('Desde'), { target: { value: '2026-11-09' } });
    fireEvent.change(within(panel).getByLabelText('Hasta'), { target: { value: '2026-11-10' } });
    fireEvent.change(within(panel).getByLabelText('Motivo (opcional)'), { target: { value: '  Vacaciones  ' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Registrar ausencia' }));
    await within(panel).findByText('Ausencia registrada.');
    expect(save).toHaveBeenCalledExactlyOnceWith(7, { startDate: '2026-11-09', endDate: '2026-11-10', startTime: null, endTime: null, reason: 'Vacaciones' });
    expect(await within(panel).findByText(/2026-11-09 → 2026-11-10/)).toBeVisible();
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument();
    await waitFor(() => expect(unloadBlocked()).toBe(false));
  });

  it('conserva errores y la misma instancia de ausencia al alternar y refrescar', async () => {
    const { tools, client } = await setup(false);
    const panel = await newAbsence(tools);
    fireEvent.click(within(panel).getByLabelText('Todo el día (permite varios días)'));
    const form = within(panel).getByRole('form');
    fireEvent.submit(form);
    expect(within(panel).getByText('Indica la hora de inicio y la de fin de la ausencia parcial.')).toBeVisible();
    select(tools, 'Excepciones');
    await act(async () => client.invalidateQueries({ queryKey: ['timeoff', 7] }));
    expect(unloadBlocked()).toBe(true);
    select(tools, 'Ausencias');
    expect(within(panel).getByRole('form')).toBe(form);
    expect(within(panel).getByRole('alert')).toBeVisible();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('un fallo de guardado de ausencia conserva valores y permite reintentar sin doble envío', async () => {
    const request = deferred<TimeOffDto>();
    const save = vi.spyOn(schedulingApi, 'createTimeOff').mockReturnValueOnce(request.promise).mockResolvedValue(timeOff);
    const { tools } = await setup(false);
    const panel = await newAbsence(tools);
    fireEvent.change(within(panel).getByLabelText('Motivo (opcional)'), { target: { value: 'No perder' } });
    const form = within(panel).getByRole('form');
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(within(panel).getByLabelText('Motivo (opcional)')).toBeDisabled();
    expect(within(panel).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await act(async () => request.reject(new Error('Guardado fallido')));
    expect(within(panel).getByText('Guardado fallido')).toBeVisible();
    expect(within(panel).getByLabelText('Motivo (opcional)')).toHaveValue('No perder');
    expect(unloadBlocked()).toBe(true);
    fireEvent.submit(form);
    await within(panel).findByText('Ausencia registrada.');
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument();
  });

  it('conserva edición y eliminación de ausencias, con confirmación si el borrado descarta cambios', async () => {
    let records = [timeOff];
    vi.mocked(schedulingApi.listTimeOff).mockImplementation(async () => records);
    const update = vi.spyOn(schedulingApi, 'updateTimeOff').mockImplementation(async (_id, id, input) => {
      const result = { id, allDay: input.startTime == null, ...input }; records = [result]; return result;
    });
    const remove = vi.spyOn(schedulingApi, 'deleteTimeOff').mockImplementation(async () => { records = []; });
    const { tools } = await setup(false);
    const panel = select(tools, 'Ausencias');
    fireEvent.click(await within(panel).findByRole('button', { name: 'Editar' }));
    expect(within(panel).getByLabelText('Hora inicio')).toHaveValue('10:00');
    expect(unloadBlocked()).toBe(false);
    fireEvent.change(within(panel).getByLabelText('Motivo (opcional)'), { target: { value: 'Actualizada' } });
    fireEvent.submit(within(panel).getByRole('form'));
    await within(panel).findByText('Ausencia actualizada.');
    expect(update).toHaveBeenCalledWith(7, 40, { startDate: timeOff.startDate, endDate: timeOff.endDate, startTime: '10:00', endTime: '11:00', reason: 'Actualizada' });
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Editar' })).toBeEnabled());
    fireEvent.click(within(panel).getByRole('button', { name: 'Editar' }));
    fireEvent.change(within(panel).getByLabelText('Motivo (opcional)'), { target: { value: 'Borrador relacionado' } });
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(within(panel).getByRole('button', { name: 'Eliminar' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole('button', { name: 'Eliminar' }));
    expect(window.confirm).toHaveBeenLastCalledWith('¿Eliminar la ausencia del 2026-11-03?');
    await within(panel).findByText('Ausencia eliminada.');
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument();
    expect(await within(panel).findByText('Sin ausencias registradas.')).toBeVisible();
  });

  it.each(['usuario', 'profesional', 'sesión'] as const)('aísla el borrador y la respuesta de Ausencias al cambiar de %s', async (boundary) => {
    const request = deferred<TimeOffDto>();
    vi.spyOn(schedulingApi, 'createTimeOff').mockReturnValueOnce(request.promise);
    const { tools } = await setup(false);
    const panel = await newAbsence(tools);
    fireEvent.change(within(panel).getByLabelText('Motivo (opcional)'), { target: { value: 'Sesión anterior' } });
    fireEvent.submit(within(panel).getByRole('form'));
    await waitFor(() => expect(schedulingApi.createTimeOff).toHaveBeenCalledTimes(1));
    act(() => {
      if (boundary === 'sesión') useAuthStore.setState({ sessionVersion: useAuthStore.getState().sessionVersion + 1 });
      else useAuthStore.setState({ user: { ...actor, ...(boundary === 'usuario' ? { id: 11 } : { dentistId: 8 }) } });
    });
    const next = select(document.getElementById('professional-schedule-tools')!, 'Ausencias');
    expect(panel).not.toBeInTheDocument();
    expect(within(next).queryByRole('form')).not.toBeInTheDocument();
    await act(async () => request.resolve(timeOff));
    expect(within(next).queryByText('Ausencia registrada.')).not.toBeInTheDocument();
    expect(unloadBlocked()).toBe(false);
  });
});

describe('WeekEditor sin opt-in — compatibilidad', () => {
  it('conserva su estado local, validaciones y payload sin adoptar automáticamente otras props', () => {
    const onSave = vi.fn();
    const view = render(<WeekEditor days={week().days} timezone={timezone} onSave={onSave} />);
    const input = screen.getByLabelText('Inicio Lunes');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.submit(input.closest('form')!);
    view.rerender(<WeekEditor days={week('08:00:00').days} timezone={timezone} onSave={onSave} />);
    expect(input).toHaveValue('');
    expect(screen.getByText('Lunes: indica la hora de apertura y la de cierre.')).toBeVisible();
    fireEvent.change(input, { target: { value: '10:00' } });
    fireEvent.submit(input.closest('form')!);
    expect(onSave).toHaveBeenCalledExactlyOnceWith([{ dayOfWeek: 1, open: true, startTime: '10:00', endTime: '17:00', breaks: [] }]);
    expect(unloadBlocked()).toBe(false);
  });
});
