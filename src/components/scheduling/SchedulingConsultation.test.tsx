import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { schedulingApi, type AvailabilityDto, type ScheduleDayDto } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { SchedulingPage } from './SchedulingPage';

const days: ScheduleDayDto[] = [{ dayOfWeek: 1, open: true, startTime: '09:00:00', endTime: '17:00:00', breaks: [{ startTime: '12:00:00', endTime: '13:00:00' }] }];
const directory = [
  { dentistId: 8, firstName: 'Otro', lastName: 'Profesional', days: [] },
  { dentistId: 7, firstName: 'Mi', lastName: 'Perfil', days: [] },
];
const result: AvailabilityDto = { dentistId: 7, timezone: 'Europe/Madrid', durationMinutes: 30, slots: [
  { startDate: '2026-10-26', startTime: '09:00:00', endTime: '09:30:00', start: '2026-10-26T08:00:00Z', end: '2026-10-26T08:30:00Z' },
] };
const clients: QueryClient[] = [];

function mount(dentistId: number | null = 7) {
  useAuthStore.setState({ status: 'authenticated', user: { id: 1, email: 'synthetic@example.test', active: true, role: 'DENTIST', createdAt: '', ...(dentistId === null ? {} : { dentistId }) } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><MemoryRouter><SchedulingPage /></MemoryRouter></QueryClientProvider>);
  return client;
}

function api() {
  const publicSchedule = vi.spyOn(schedulingApi, 'getPublicSchedule').mockResolvedValue({ timezone: 'Europe/Madrid', days, exceptions: [], dentists: directory });
  const week = vi.spyOn(schedulingApi, 'getDentistSchedule').mockImplementation(async (dentistId) => ({ dentistId, timezone: 'Europe/Madrid', days }));
  const exceptions = vi.spyOn(schedulingApi, 'listDentistExceptions').mockResolvedValue([]);
  const timeOff = vi.spyOn(schedulingApi, 'listTimeOff').mockResolvedValue([]);
  vi.spyOn(schedulingApi, 'getClinicSchedule').mockResolvedValue({ timezone: 'Europe/Madrid', days });
  vi.spyOn(schedulingApi, 'listClinicExceptions').mockResolvedValue([]);
  vi.spyOn(schedulingApi, 'getPolicy').mockResolvedValue({ timezone: 'Europe/Madrid', maxAdvanceDays: 73, minBookingLeadTimeHours: 3, cancellationLeadTimeHours: 16 });
  const availability = vi.spyOn(schedulingApi, 'availability').mockImplementation(async (input) => ({ ...result, dentistId: input.dentistId }));
  return { publicSchedule, week, exceptions, timeOff, availability };
}

const region = (name: string) => within(screen.getByRole('region', { name }));
const availabilityRegion = () => region('Consultar disponibilidad');
async function ready() { await availabilityRegion().findByLabelText('Dentista'); }
function search() { fireEvent.click(availabilityRegion().getByRole('button', { name: 'Buscar disponibilidad' })); }

afterEach(() => {
  cleanup(); clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks(); vi.useRealTimers();
  useAuthStore.setState({ status: 'anonymous', user: null });
});

describe('BUILD-04A consulta compartida DENTIST', () => {
  it('BUILD04B ordena identidad, calendario, gestión, disponibilidad y clínica sin duplicarlos', async () => {
    api(); mount(); await ready();
    await screen.findByRole('button', { name: 'Editar horario' });
    const tools = document.getElementById('professional-schedule-tools')!;
    const sections = [
      screen.getByRole('heading', { name: 'Horarios' }),
      screen.getByRole('region', { name: 'Profesional en consulta' }),
      screen.getByRole('region', { name: 'Horario semanal' }),
      tools,
      screen.getByRole('region', { name: 'Consultar disponibilidad' }),
      screen.getByRole('region', { name: 'Información de la clínica' }),
    ];
    sections.slice(1).forEach((node, index) => {
      expect(sections[index].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    expect(document.querySelectorAll('#professional-schedule-tools')).toHaveLength(1);
    expect(document.querySelectorAll('.rs-calendar')).toHaveLength(1);
    expect(screen.getAllByRole('tablist', { name: 'Gestionar mi horario' })).toHaveLength(1);
    expect(tools.closest('.reception-scheduling')).toBeNull(); // Editor CSS remains isolated.
    for (const name of ['Horario de la clínica', 'Excepciones de la clínica', 'Política de reservas']) {
      expect(screen.getAllByRole('region', { name })).toHaveLength(1);
    }
    expect(within(tools).queryByLabelText('Inicio Lunes')).not.toBeInTheDocument();
  });

  it('BUILD04B el enlace enfoca la pestaña activa sin reiniciar el editor ni sus errores', async () => {
    const calls = api(); mount(); await ready();
    const tools = document.getElementById('professional-schedule-tools')!;
    const scroll = vi.fn();
    tools.scrollIntoView = scroll;
    fireEvent.click(screen.getByRole('link', { name: 'Gestionar mi horario' }));
    expect(within(tools).getByRole('tab', { name: 'Mi semana' })).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
    const edit = await within(tools).findByRole('button', { name: 'Editar horario' });
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    const start = within(tools).getByLabelText('Inicio Lunes');
    fireEvent.change(start, { target: { value: '' } });
    fireEvent.submit(start.closest('form')!);
    fireEvent.click(within(tools).getByRole('tab', { name: 'Ausencias' }));
    fireEvent.click(screen.getByRole('link', { name: 'Gestionar mi horario' }));
    expect(within(tools).getByRole('tab', { name: 'Ausencias' })).toHaveFocus();
    fireEvent.click(within(tools).getByRole('tab', { name: 'Mi semana' }));
    expect(within(tools).getByLabelText('Inicio Lunes')).toBe(start);
    expect(start).toHaveValue('');
    expect(within(tools).getByText('Lunes: indica la hora de apertura y la de cierre.')).toBeVisible();
    expect(calls.week.mock.calls.every(([id]) => id === 7)).toBe(true);
  });

  it('calendario privado propio y disponibilidad inicial propia aunque otro sea el primero del directorio', async () => {
    const calls = api(); mount(); await ready();
    expect(availabilityRegion().getByLabelText('Dentista')).toHaveValue('7');
    for (const query of [calls.week, calls.exceptions, calls.timeOff]) {
      expect(query).toHaveBeenCalledWith(7);
      expect(query.mock.calls.every(([id]) => id === 7)).toBe(true);
    }
    expect(region('Horario semanal').getByText('09:00–17:00')).toBeInTheDocument();
    expect(region('Horario semanal').getByText('Descanso:', { exact: false })).toHaveTextContent('12:00–13:00');
    expect(region('Profesional en consulta').queryByRole('combobox')).not.toBeInTheDocument();
    expect(calls.availability).not.toHaveBeenCalled();
  });

  it('conserva disponibilidad pública ajena sin cambiar el contexto ni consultar recursos privados ajenos', async () => {
    const calls = api(); mount(); await ready();
    fireEvent.change(availabilityRegion().getByLabelText('Dentista'), { target: { value: '8' } });
    fireEvent.change(availabilityRegion().getByLabelText('Fecha'), { target: { value: '2026-10-26' } });
    search();
    await availabilityRegion().findByText('09:00–09:30');
    expect(calls.availability).toHaveBeenCalledWith({ dentistId: 8, from: '2026-10-26', duration: 30 });
    expect(region('Profesional en consulta').getByText('Mi Perfil')).toBeInTheDocument();
    for (const query of [calls.week, calls.exceptions, calls.timeOff]) expect(query.mock.calls.every(([id]) => id === 7)).toBe(true);
    expect(screen.getByRole('button', { name: 'Editar horario' })).toBeEnabled();
    expect(screen.queryByLabelText('Inicio Lunes')).not.toBeInTheDocument();
  });

  it('los criterios pendientes no consultan ni conservan resultados etiquetados con los criterios nuevos', async () => {
    const calls = api(); mount(); await ready();
    const date = availabilityRegion().getByLabelText('Fecha');
    fireEvent.change(date, { target: { value: '2026-10-26' } });
    search(); await availabilityRegion().findByText('09:00–09:30');
    fireEvent.change(date, { target: { value: '2026-10-27' } });
    expect(availabilityRegion().queryByText('09:00–09:30')).not.toBeInTheDocument();
    expect(calls.availability).toHaveBeenCalledTimes(1);
    fireEvent.change(availabilityRegion().getByLabelText('Duración (min)'), { target: { value: '60' } });
    search(); await availabilityRegion().findByText('09:00–09:30');
    // Show exactly the response, even when it differs from a frontend-generated interval.
    expect(calls.availability).toHaveBeenLastCalledWith({ dentistId: 7, from: '2026-10-27', duration: 60 });
    expect(availabilityRegion().queryByText('09:00–10:00')).not.toBeInTheDocument();
  });

  it('una respuesta tardía del profesional anterior no repone sus resultados', async () => {
    const calls = api();
    let release!: (value: AvailabilityDto) => void;
    calls.availability.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    mount(); await ready(); search();
    await availabilityRegion().findByText('Calculando disponibilidad…');
    fireEvent.change(availabilityRegion().getByLabelText('Dentista'), { target: { value: '8' } });
    expect(availabilityRegion().queryByText('Calculando disponibilidad…')).not.toBeInTheDocument();
    expect(availabilityRegion().getByText(/El profesional cambió/)).toBeInTheDocument();
    await act(async () => release(result));
    expect(availabilityRegion().queryByRole('list')).not.toBeInTheDocument();
    search(); await availabilityRegion().findByText('09:00–09:30');
    expect(availabilityRegion().getByRole('heading', { level: 3 })).toHaveTextContent('Otro Profesional');
  });

  it('sin asociación mantiene la consulta pública pero no toma otro perfil como propio', async () => {
    const calls = api();
    mount(null);
    await ready();
    expect(region('Horario semanal').getByText('Sin perfil profesional asociado')).toBeInTheDocument();
    search(); await availabilityRegion().findByText('09:00–09:30');
    for (const query of [calls.week, calls.exceptions, calls.timeOff]) expect(query).not.toHaveBeenCalled();
  });

  it('el calendario propio no depende de aparecer en el directorio público', async () => {
    const calls = api(); calls.publicSchedule.mockResolvedValue({ timezone: 'Europe/Madrid', days: [], exceptions: [], dentists: [directory[0]!] });
    mount(); await ready();
    expect(await region('Horario semanal').findByText('09:00–17:00')).toBeInTheDocument();
    expect(region('Profesional en consulta').getByText('Mi perfil profesional')).toBeInTheDocument();
    expect(calls.week).toHaveBeenCalledWith(7);
    expect(availabilityRegion().getByLabelText('Dentista')).toHaveValue('8');
  });

  it('carga, error y reintento del calendario son independientes de la disponibilidad', async () => {
    const calls = api();
    let fail!: (reason: Error) => void;
    calls.week.mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    mount(); await ready();
    expect(region('Horario semanal').getByRole('status')).toHaveTextContent('Cargando el horario del dentista');
    await act(async () => fail(new Error('Horario no disponible.')));
    expect(await region('Horario semanal').findByRole('alert')).toHaveTextContent('Horario no disponible.');
    expect(availabilityRegion().getByRole('button', { name: 'Buscar disponibilidad' })).toBeEnabled();
    fireEvent.click(region('Horario semanal').getByRole('button', { name: 'Reintentar el horario del dentista' }));
    expect(await region('Horario semanal').findByText('09:00–17:00')).toBeInTheDocument();
  });

  it('no usa la semana pública para inventar un calendario privado vacío', async () => {
    const calls = api(); calls.week.mockResolvedValue({ dentistId: 7, timezone: 'Europe/Madrid', days: [] });
    mount(); await ready();
    expect(await region('Horario semanal').findByText('No hay horario semanal registrado.')).toBeInTheDocument();
    expect(region('Horario semanal').queryByText('09:00–17:00')).not.toBeInTheDocument();
    expect(region('Excepciones del dentista').getByText('Sin excepciones registradas.')).toBeInTheDocument();
    expect(region('Ausencias del dentista').getByText('Sin ausencias registradas.')).toBeInTheDocument();
  });

  it('un error de disponibilidad no se presenta como vacío y puede reintentarse', async () => {
    const calls = api(); calls.availability.mockRejectedValueOnce(new Error('No se pudo consultar.'));
    mount(); await ready(); search();
    expect(await availabilityRegion().findByRole('alert')).toHaveTextContent('No se pudo consultar.');
    expect(availabilityRegion().queryByText('Sin disponibilidad')).not.toBeInTheDocument();
    calls.availability.mockResolvedValue({ ...result, slots: [] });
    fireEvent.click(availabilityRegion().getByRole('button', { name: 'Reintentar la disponibilidad' }));
    expect(await availabilityRegion().findByText('Sin disponibilidad')).toBeInTheDocument();
  });

  it('al cambiar la asociación no conserva ni muestra el resultado del perfil anterior', async () => {
    const calls = api(); mount(); await ready(); search();
    await availabilityRegion().findByText('09:00–09:30');
    act(() => useAuthStore.setState({ user: { ...useAuthStore.getState().user!, dentistId: 8 } }));
    await waitFor(() => expect(region('Profesional en consulta').getByText('Otro Profesional')).toBeInTheDocument());
    expect(availabilityRegion().queryByText('09:00–09:30')).not.toBeInTheDocument();
    expect(calls.availability).toHaveBeenCalledTimes(1);
    expect(calls.week).toHaveBeenCalledWith(8);
  });
});
