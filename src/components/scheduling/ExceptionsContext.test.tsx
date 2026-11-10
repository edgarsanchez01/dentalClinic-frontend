import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { schedulingApi, type ScheduleExceptionDto } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { UnsavedChangesProvider } from '../../app/UnsavedChangesProvider';
import { SchedulingPage } from './SchedulingPage';

const actor = { id: 10, role: 'DENTIST' as const, dentistId: 7, email: 'dentist@example.test', active: true, createdAt: '2026-01-01T00:00:00Z' };
const timezone = 'Europe/Madrid';
const days = [{ dayOfWeek: 1, open: true, startTime: '09:00:00', endTime: '17:00:00', breaks: [] }];
const first = { date: '2026-11-02', closed: true, reason: 'Cierre registrado' };
const second = { date: '2026-11-03', closed: false, startTime: '10:00:00', endTime: '14:00:00', reason: 'Horario especial' };
let rows: ScheduleExceptionDto[];
const clients: QueryClient[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  rows = [first, second];
  useAuthStore.setState({ status: 'authenticated', user: actor });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(schedulingApi, 'getPublicSchedule').mockResolvedValue({ timezone, days: [], exceptions: [], dentists: [
    { dentistId: 7, firstName: 'Mi', lastName: 'Perfil', days: [] },
    { dentistId: 8, firstName: 'Otro', lastName: 'Perfil', days: [] },
  ] });
  vi.spyOn(schedulingApi, 'getDentistSchedule').mockImplementation(async (dentistId) => ({ dentistId, timezone, days }));
  vi.spyOn(schedulingApi, 'listDentistExceptions').mockImplementation(async () => rows);
  vi.spyOn(schedulingApi, 'listTimeOff').mockResolvedValue([]);
  vi.spyOn(schedulingApi, 'getClinicSchedule').mockResolvedValue({ timezone, days });
  vi.spyOn(schedulingApi, 'listClinicExceptions').mockResolvedValue([]);
  vi.spyOn(schedulingApi, 'getPolicy').mockResolvedValue({ timezone, maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 });
  vi.spyOn(schedulingApi, 'putDentistException').mockImplementation(async (_id, date, input) => {
    const row = { date, ...input };
    rows = [...rows.filter((item) => item.date !== date), row];
    return row;
  });
  vi.spyOn(schedulingApi, 'deleteDentistException').mockImplementation(async (_id, date) => { rows = rows.filter((item) => item.date !== date); });
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

async function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } } });
  clients.push(client);
  const router = createMemoryRouter([{ element: <UnsavedChangesProvider><Outlet /></UnsavedChangesProvider>, children: [
    { path: '/scheduling', element: <><Link to="/other">Salir de horarios</Link><SchedulingPage /></> },
    { path: '/other', element: <p>Página destino</p> },
  ] }], { initialEntries: ['/scheduling'] });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('tab', { name: 'Excepciones' }));
  const panel = screen.getByRole('tabpanel', { name: 'Excepciones' });
  await within(panel).findByRole('button', { name: 'Nueva excepción' });
  await waitFor(() => expect(within(panel).queryByText('Cargando…')).not.toBeInTheDocument());
  return { panel, client };
}

const create = (panel: HTMLElement) => fireEvent.click(within(panel).getByRole('button', { name: 'Nueva excepción' }));
const row = (panel: HTMLElement, date: string) => within(panel).getByText(new RegExp(`^${date} ·`)).closest('li')!;
const edit = (panel: HTMLElement, date = first.date) => fireEvent.click(within(row(panel, date)).getByRole('button', { name: 'Editar' }));
const remove = (panel: HTMLElement, date = first.date) => fireEvent.click(within(row(panel, date)).getByRole('button', { name: 'Eliminar excepción' }));
const reason = (panel: HTMLElement, value: string) => fireEvent.change(within(panel).getByLabelText('Motivo (opcional)'), { target: { value } });
const submit = (panel: HTMLElement) => fireEvent.submit(within(panel).getByLabelText('Fecha').closest('form')!);
const cancel = (panel: HTMLElement) => fireEvent.click(within(panel).getByRole('button', { name: 'Cancelar' }));
function unloadBlocked() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('UX01 BUILD03 — excepciones contextuales propias', () => {
  it('inicia con cabecera, listado y CTA; abre inline y cancela intacto sin confirmar', async () => {
    const { panel } = await setup();
    await within(panel).findByText(/Cierre registrado/);
    expect(within(panel).getByRole('heading', { name: 'Excepciones por fecha' })).toBeVisible();
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument();
    expect(within(panel).queryByLabelText('Fecha')).not.toBeInTheDocument();
    create(panel);
    const form = within(panel).getByRole('form', { name: 'Nueva excepción' });
    expect(within(form).getByLabelText('Fecha')).toHaveFocus();
    expect(within(panel).getAllByRole('form')).toHaveLength(1);
    expect(unloadBlocked()).toBe(false);
    cancel(panel);
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Nueva excepción' })).toHaveFocus();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('conserva el estado vacío sin mostrar campos de creación', async () => {
    rows = [];
    const { panel } = await setup();
    expect(await within(panel).findByText('Sin excepciones registradas.')).toBeVisible();
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument();
    create(panel);
    expect(within(panel).getByRole('form', { name: 'Nueva excepción' })).toBeVisible();
  });

  it('un error de lectura no se confunde con vacío ni habilita el alta', async () => {
    vi.mocked(schedulingApi.listDentistExceptions).mockRejectedValue(new Error('Lectura fallida'));
    const { panel } = await setup();
    expect(await within(panel).findByText('No se pudieron cargar las excepciones.')).toBeVisible();
    expect(within(panel).getByRole('button', { name: 'Nueva excepción' })).toBeDisabled();
    expect(within(panel).queryByText('Sin excepciones registradas.')).not.toBeInTheDocument();
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument();
  });

  it('edita con el mismo formulario, fecha fija y horas actuales; cancelar intacto no confirma', async () => {
    const { panel } = await setup();
    await within(panel).findByText(/Horario especial/);
    edit(panel, second.date);
    expect(within(panel).getByRole('form', { name: 'Editar excepción' })).toBeVisible();
    expect(within(panel).getByLabelText('Fecha')).toHaveValue(second.date);
    expect(within(panel).getByLabelText('Fecha')).toBeDisabled();
    expect(within(panel).getByLabelText('Apertura')).toHaveValue('10:00');
    expect(within(panel).getByLabelText('Cierre')).toHaveValue('14:00');
    expect(within(panel).getByLabelText('Cerrado todo el día')).toHaveFocus();
    expect(unloadBlocked()).toBe(false);
    cancel(panel);
    expect(within(row(panel, second.date)).getByRole('button', { name: 'Editar' })).toHaveFocus();
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('cancelar modificado permite quedarse o descartar sin perder valores/errores silenciosamente', async () => {
    const { panel } = await setup();
    create(panel);
    reason(panel, 'Borrador');
    submit(panel);
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    cancel(panel);
    expect(window.confirm).toHaveBeenLastCalledWith('¿Descartar los cambios sin guardar de esta excepción?');
    expect(within(panel).getByLabelText('Motivo (opcional)')).toHaveValue('Borrador');
    expect(within(panel).getByText('Selecciona la fecha de la excepción.')).toBeVisible();
    expect(unloadBlocked()).toBe(true);
    cancel(panel);
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument();
    expect(unloadBlocked()).toBe(false);
  });

  it('Nueva excepción y editar otro registro no reemplazan un borrador sin autorización', async () => {
    const { panel } = await setup();
    edit(panel);
    reason(panel, 'Cambios locales');
    edit(panel); // Clicking the same row is a no-op, not a reset.
    expect(window.confirm).not.toHaveBeenCalled();
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    create(panel);
    expect(within(panel).getByLabelText('Fecha')).toHaveValue(first.date);
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    edit(panel, second.date);
    expect(within(panel).getByLabelText('Motivo (opcional)')).toHaveValue('Cambios locales');
    edit(panel, second.date);
    expect(within(panel).getByLabelText('Fecha')).toHaveValue(second.date);
    reason(panel, 'Otro borrador');
    create(panel);
    expect(within(panel).getByLabelText('Fecha')).toHaveValue('');
    expect(within(panel).getByLabelText('Motivo (opcional)')).toHaveValue('');
    expect(unloadBlocked()).toBe(false);
  });

  it('alternar pestañas conserva formulario, valores y errores; salir protege el borrador oculto', async () => {
    const { panel, client } = await setup();
    create(panel);
    reason(panel, 'Borrador');
    submit(panel);
    const form = within(panel).getByRole('form');
    fireEvent.click(screen.getByRole('tab', { name: 'Mi semana' }));
    await act(async () => client.invalidateQueries({ queryKey: ['dentist-exceptions', 7] }));
    expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: 'Salir de horarios' }));
    expect(screen.getByRole('dialog', { name: 'Tienes cambios sin guardar' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Seguir aquí' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Excepciones' }));
    expect(within(panel).getByRole('form')).toBe(form);
    expect(within(panel).getByLabelText('Motivo (opcional)')).toHaveValue('Borrador');
    expect(within(panel).getByText('Selecciona la fecha de la excepción.')).toBeVisible();
  });

  it('cancelar intacto no confirma por el borrador de Mi semana ni libera su protección', async () => {
    const { panel } = await setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Mi semana' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Editar horario' }));
    fireEvent.change(screen.getByLabelText('Inicio Lunes'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Excepciones' }));
    create(panel);
    cancel(panel);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(unloadBlocked()).toBe(true);
  });

  it('crea con el mismo PUT/payload, cierra el formulario y refresca listado y confirmación', async () => {
    const { panel } = await setup();
    create(panel);
    fireEvent.change(within(panel).getByLabelText('Fecha'), { target: { value: '2026-11-05' } });
    reason(panel, '  Cierre propio  ');
    submit(panel);
    await within(panel).findByText('Excepción guardada.');
    expect(schedulingApi.putDentistException).toHaveBeenCalledExactlyOnceWith(7, '2026-11-05', { closed: true, startTime: null, endTime: null, reason: 'Cierre propio' });
    expect(await within(panel).findByText(/2026-11-05 · Cerrado/)).toBeVisible();
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Nueva excepción' })).toHaveFocus();
    expect(unloadBlocked()).toBe(false);
  });

  it('actualiza la excepción abierta sin cambiar la fecha ni las reglas/payloads', async () => {
    const { panel } = await setup();
    edit(panel, second.date);
    fireEvent.change(within(panel).getByLabelText('Apertura'), { target: { value: '11:00' } });
    reason(panel, '');
    submit(panel);
    await within(panel).findByText('Excepción actualizada.');
    expect(schedulingApi.putDentistException).toHaveBeenCalledExactlyOnceWith(7, second.date, { closed: false, startTime: '11:00', endTime: '14:00', reason: null });
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument();
  });

  it('mantiene el bloqueo del recurso hasta que se actualiza el listado confirmado', async () => {
    const refresh = deferred<ScheduleExceptionDto[]>();
    const { panel } = await setup();
    edit(panel);
    reason(panel, 'Confirmado');
    vi.mocked(schedulingApi.listDentistExceptions).mockReturnValueOnce(refresh.promise);
    submit(panel);
    await within(panel).findByText('Excepción actualizada.');
    expect(within(panel).getByRole('button', { name: 'Nueva excepción' })).toBeDisabled();
    expect(unloadBlocked()).toBe(true);
    await act(async () => refresh.resolve(rows));
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Nueva excepción' })).toBeEnabled());
    expect(unloadBlocked()).toBe(false);
  });

  it('bloquea operaciones duplicadas y reemplazos durante un guardado; el fallo conserva y permite reintentar', async () => {
    const request = deferred<ScheduleExceptionDto>();
    vi.mocked(schedulingApi.putDentistException).mockReturnValueOnce(request.promise);
    const { panel } = await setup();
    edit(panel);
    reason(panel, 'Borrador pendiente');
    submit(panel);
    submit(panel);
    await waitFor(() => expect(schedulingApi.putDentistException).toHaveBeenCalledTimes(1));
    expect(within(panel).getByLabelText('Motivo (opcional)')).toBeDisabled();
    expect(within(panel).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    create(panel);
    edit(panel, second.date);
    remove(panel);
    cancel(panel);
    reason(panel, 'No debe sustituir el envío');
    expect(within(panel).getByLabelText('Motivo (opcional)')).toHaveValue('Borrador pendiente');
    expect(schedulingApi.deleteDentistException).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
    await act(async () => request.reject(new Error('Guardado fallido')));
    expect(within(panel).getByText('Guardado fallido')).toBeVisible();
    expect(within(panel).getByLabelText('Motivo (opcional)')).toHaveValue('Borrador pendiente');
    expect(within(panel).getByRole('form', { name: 'Editar excepción' })).toBeVisible();
    expect(unloadBlocked()).toBe(true);
    submit(panel);
    await within(panel).findByText('Excepción actualizada.');
    expect(unloadBlocked()).toBe(false);
  });

  it('eliminar el registro editado advierte del borrador y conserva la confirmación anterior', async () => {
    const { panel } = await setup();
    edit(panel);
    reason(panel, 'Borrador relacionado');
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    remove(panel);
    expect(schedulingApi.deleteDentistException).not.toHaveBeenCalled();
    expect(within(panel).getByLabelText('Motivo (opcional)')).toHaveValue('Borrador relacionado');
    vi.mocked(window.confirm).mockReturnValueOnce(true).mockReturnValueOnce(false);
    remove(panel);
    expect(window.confirm).toHaveBeenLastCalledWith(`¿Eliminar la excepción del ${first.date}?`);
    expect(schedulingApi.deleteDentistException).not.toHaveBeenCalled();
    remove(panel);
    await within(panel).findByText('Excepción eliminada.');
    expect(schedulingApi.deleteDentistException).toHaveBeenCalledExactlyOnceWith(7, first.date);
    expect(within(panel).queryByRole('form')).not.toBeInTheDocument();
    expect(unloadBlocked()).toBe(false);
  });

  it('un borrado fallido mantiene el registro, formulario y borrador; después puede reintentarse', async () => {
    const request = deferred<void>();
    vi.mocked(schedulingApi.deleteDentistException).mockReturnValueOnce(request.promise);
    const { panel } = await setup();
    edit(panel);
    reason(panel, 'No perder');
    remove(panel);
    remove(panel);
    await waitFor(() => expect(schedulingApi.deleteDentistException).toHaveBeenCalledTimes(1));
    expect(within(panel).getByRole('button', { name: 'Nueva excepción' })).toBeDisabled();
    submit(panel);
    expect(schedulingApi.putDentistException).not.toHaveBeenCalled();
    await act(async () => request.reject(new Error('Borrado fallido')));
    expect(within(panel).getByText('Borrado fallido')).toBeVisible();
    expect(within(panel).getByLabelText('Motivo (opcional)')).toHaveValue('No perder');
    remove(panel);
    await within(panel).findByText('Excepción eliminada.');
  });

  it('eliminar otro registro no descarta el borrador ni sus errores', async () => {
    const { panel } = await setup();
    create(panel);
    reason(panel, 'Borrador independiente');
    submit(panel);
    remove(panel, second.date);
    await within(panel).findByText('Excepción eliminada.');
    expect(window.confirm).toHaveBeenCalledExactlyOnceWith(`¿Eliminar la excepción del ${second.date}?`);
    expect(within(panel).getByLabelText('Motivo (opcional)')).toHaveValue('Borrador independiente');
    expect(within(panel).getByText('Selecciona la fecha de la excepción.')).toBeVisible();
    expect(unloadBlocked()).toBe(true);
  });

  it.each(['usuario', 'profesional', 'sesión'] as const)('no recupera formularios ni respuestas anteriores después de cambiar de %s', async (boundary) => {
    const request = deferred<ScheduleExceptionDto>();
    vi.mocked(schedulingApi.putDentistException).mockReturnValueOnce(request.promise);
    const { panel } = await setup();
    edit(panel);
    reason(panel, 'Anterior');
    submit(panel);
    await waitFor(() => expect(schedulingApi.putDentistException).toHaveBeenCalledTimes(1));
    const reads = vi.mocked(schedulingApi.listDentistExceptions).mock.calls.length;
    act(() => {
      if (boundary === 'sesión') useAuthStore.setState({ sessionVersion: useAuthStore.getState().sessionVersion + 1 });
      else useAuthStore.setState({ user: { ...actor, ...(boundary === 'usuario' ? { id: 11 } : { dentistId: 8 }) } });
    });
    fireEvent.click(await screen.findByRole('tab', { name: 'Excepciones' }));
    const nextPanel = screen.getByRole('tabpanel', { name: 'Excepciones' });
    await within(nextPanel).findByText(/Cierre registrado/);
    expect(within(nextPanel).queryByRole('form')).not.toBeInTheDocument();
    const afterIdentity = vi.mocked(schedulingApi.listDentistExceptions).mock.calls.length;
    await act(async () => request.resolve({ ...first, reason: 'Anterior' }));
    expect(within(nextPanel).queryByText('Excepción actualizada.')).not.toBeInTheDocument();
    expect(vi.mocked(schedulingApi.listDentistExceptions).mock.calls.length).toBe(afterIdentity);
    expect(afterIdentity).toBeGreaterThanOrEqual(reads);
    expect(unloadBlocked()).toBe(false);
  });
});
