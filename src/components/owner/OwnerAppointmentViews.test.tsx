import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppointmentResponse } from '../../api/appointments';
import { fromLocalDateInput, rangeForView } from '../appointments/appointmentUi';
import { OwnerColumnComparison, OwnerDayAgenda, OwnerMonthCalendar, OwnerStartGroups, OwnerWeekAgenda } from './OwnerAppointmentViews';
import { ownerDayLanes } from './ownerAgendaLayout';
import { ReceptionWeekAgenda } from '../reception/ReceptionWeekAgenda';
import { ReceptionMonthCell } from '../reception/ReceptionMonthCell';

const date = '2026-10-26';
const visit = (id: number, start = Date.UTC(2026, 9, 26, 9) + id * 15 * 60_000, duration = 30): AppointmentResponse => ({
  id, patientId: id + 10, patientFirstName: `Paciente ${id}`, patientLastName: 'Prueba', dentistId: 7,
  dentistFirstName: 'Ana', dentistLastName: 'Propietaria', startAt: new Date(start).toISOString(), endAt: new Date(start + duration * 60_000).toISOString(),
  durationMinutes: duration, status: 'SCHEDULED', occurrenceVersion: 1, createdByUserId: 1, createdAt: '2026-10-25T09:00:00Z',
});
const month = rangeForView('month', fromLocalDateInput(date), 'UTC').days;
const week = rangeForView('week', fromLocalDateInput(date), 'UTC').days;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('separa simultáneas horizontalmente sin cambiar orden, fechas o duración del DTO', () => {
  const start = Date.UTC(2026, 9, 26, 9);
  const entries = [visit(1, start), visit(2, start + 15 * 60_000), visit(3, start + 30 * 60_000), visit(4, start + 60 * 60_000, 5)];
  const snapshot = structuredClone(entries);
  const lanes = ownerDayLanes(entries);
  expect(lanes.count).toBe(2);
  expect(lanes.positions[1]).not.toBe(lanes.positions[2]);
  expect(lanes.positions[1]).toBe(lanes.positions[3]);
  expect(entries).toEqual(snapshot);
});

it('calcula un solo carril para citas consecutivas, ordena solo la copia y soporta el vacío', () => {
  const start = Date.UTC(2026, 9, 26, 9), entries = [visit(2, start + 30 * 60_000), visit(1, start)];
  expect(ownerDayLanes(entries).count).toBe(1);
  expect(entries.map(a => a.id)).toEqual([2, 1]);
  expect(ownerDayLanes([]).count).toBe(1);
});

it('la semana usa las jornadas completas de Recepción sin truncar citas y mantiene el acceso al día', () => {
  const entries = Array.from({ length: 8 }, (_, i) => visit(i + 1));
  const returnTo = '/appointments?view=week&date=2026-10-26&status=SCHEDULED';
  const onDay = vi.fn();
  render(<MemoryRouter><OwnerWeekAgenda days={week} appointments={entries} zone="UTC" today={date} date={date} onSelectDate={vi.fn()} exceptions={[]}
    onOpen={vi.fn()} onDay={onDay} personal={false} returnTo={returnTo} /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'La semana por jornadas' })).toBeInTheDocument();
  const links = screen.getAllByRole('link', { name: /^Cita con/ }); expect(links).toHaveLength(8);
  expect(links[3]).toHaveAttribute('href', `/appointments/4?returnTo=${encodeURIComponent(returnTo)}`);
  fireEvent.click(screen.getByRole('button', { name: 'Ver día lun, 26 oct' }));
  expect(onDay).toHaveBeenCalledWith(fromLocalDateInput(date));
  expect(screen.getByRole('navigation', { name: 'Días de esta semana' }).querySelector('[aria-current="date"]')).toHaveAttribute('aria-pressed', 'true');
  expect(links.every(link => link.classList.contains('reception-visit'))).toBe(true);
});

it('el mes separa el calendario compacto de todas las citas ordenadas en la agenda integrada', () => {
  const onDay = vi.fn(), onOpen = vi.fn(), entries = Array.from({ length: 8 }, (_, i) => visit(i + 1)).reverse();
  const { container } = render(<MemoryRouter><OwnerMonthCalendar days={month} appointments={entries} zone="UTC" today={date} date={date}
    exceptions={[]} onOpen={onOpen} onDay={onDay} personal={false} /></MemoryRouter>);
  expect(container.querySelectorAll('.owner-month-cell .reception-calendar-event, .owner-month-cell .reception-visit')).toHaveLength(0);
  expect(container.querySelectorAll('.owner-month-cell')).toHaveLength(31);
  const day = screen.getByRole('button', { name: /^Ver 8 citas del lunes, 26/ });
  expect(day.querySelector('.owner-month-count')).toHaveTextContent('8 citas');
  expect(day).not.toHaveTextContent('Paciente');
  expect(day.querySelector('time')).toBeNull();
  expect(container.querySelector('.owner-month .owner-volume')).toBeNull();
  const detail = screen.getByRole('region', { name: 'Citas del día seleccionado' });
  expect(within(detail).getAllByRole('button', { name: /^Abrir cita de/ })).toHaveLength(8);
  expect(within(detail).getByRole('list', { name: 'Citas del día' })).toBeInTheDocument();
  expect([...detail.querySelectorAll('.reception-visit-time > strong')].map(time => time.textContent)).toEqual(['09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00']);
  expect(detail).not.toHaveAttribute('popover');
  expect(detail.closest('.owner-month-overview')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cerrar panel' })).not.toBeInTheDocument();
  expect(onDay).not.toHaveBeenCalled();
  fireEvent.click(within(detail).getAllByRole('button', { name: /^Abrir cita de/ })[7]!);
  expect(onOpen).toHaveBeenCalledWith(8);
  fireEvent.click(within(detail).getByRole('button', { name: /^Ver agenda completa · 8 citas/ }));
  expect(onDay).toHaveBeenCalledWith(fromLocalDateInput(date));
});

it('la agenda mensual muestra doce citas completas sin añadir pacientes ni servicios a las celdas', () => {
  const entries = Array.from({ length: 12 }, (_, i) => visit(i + 1));
  const snapshot = structuredClone(entries);
  render(<OwnerMonthCalendar days={month} appointments={entries} zone="UTC" today={date} date={date} exceptions={[]} onOpen={vi.fn()} onDay={vi.fn()} personal />);
  const day = screen.getByRole('button', { name: /^Ver 12 citas del lunes, 26/ });
  expect(day.querySelectorAll('.owner-month-entry, .owner-month-more')).toHaveLength(0);
  expect(day.querySelector('.owner-month-count')).toHaveTextContent('12 citas');
  expect(within(screen.getByRole('region', { name: 'Citas del día seleccionado' })).getAllByRole('button', { name: /^Abrir cita de/ })).toHaveLength(12);
  expect(entries).toEqual(snapshot);
});

it('el mes conserva el total filtrado y el acceso al día con todos los estados', () => {
  const entries = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map((status, i) => ({ ...visit(i + 1), status: status as AppointmentResponse['status'] }));
  render(<OwnerMonthCalendar days={month} appointments={entries} zone="UTC" today={date} date={date}
    exceptions={[]} onOpen={vi.fn()} onDay={vi.fn()} personal />);
  fireEvent.click(screen.getByRole('button', { name: /^Ver 4 citas del lunes/ }));
  const detail = within(screen.getByRole('region', { name: 'Citas del día seleccionado' }));
  for (const status of ['Programada', 'Completada', 'Cancelada', 'No asistió']) expect(detail.getByText(status)).toBeInTheDocument();
  expect(detail.getByText('4 citas con los filtros actuales · Hora de la clínica')).toBeInTheDocument();
  expect(detail.getByRole('button', { name: /^Ver agenda completa · 4 citas/ })).toBeInTheDocument();
});

it('no infiere disponibilidad del vacío y las cuentas del mes reflejan solo las citas recibidas', () => {
  render(<OwnerMonthCalendar days={month} appointments={[]} zone="UTC" today={date} date={date}
    exceptions={[]} onOpen={vi.fn()} onDay={vi.fn()} personal />);
  fireEvent.click(screen.getByRole('button', { name: /^Ver 0 citas del lunes, 26/ }));
  expect(screen.getByText('No hay citas para esta fecha')).toBeInTheDocument();
  expect(screen.getByText('0 citas con los filtros actuales · Hora de la clínica')).toBeInTheDocument();
  expect(screen.queryByText(/^Ver \d+ más/)).not.toBeInTheDocument();
});

it('conserva la excepción de clínica sin introducir bloques que estiren las celdas del mes', () => {
  render(<OwnerMonthCalendar days={month} appointments={[visit(1)]} zone="UTC" today={date} date={date}
    exceptions={[{ date, closed: true, startTime: null, endTime: null }]} onOpen={vi.fn()} onDay={vi.fn()} personal={false} />);
  expect(screen.getByRole('button', { name: /Ver 1 cita del lunes, 26.*Clínica cerrada/ })).toHaveAttribute('title', 'Clínica cerrada');
  expect(within(screen.getByRole('button', { name: /Ver 1 cita del lunes, 26.*Clínica cerrada/ })).getByText('Cierre')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Ver 1 cita del lunes, 26.*Clínica cerrada/ }));
  expect(within(screen.getByRole('region', { name: 'Citas del día seleccionado' })).getByText('Clínica cerrada')).toBeInTheDocument();
});

it('la semana de Recepción conserva su presentación predeterminada sin expansión ni acciones clínicas', () => {
  const entries = Array.from({ length: 8 }, (_, i) => visit(i + 1));
  const { container } = render(<MemoryRouter><ReceptionWeekAgenda days={week} appointments={entries} timezone="UTC" today={date}
    exceptions={[]} onSelectDay={vi.fn()} /></MemoryRouter>);
  expect(screen.getAllByRole('link', { name: /^Cita con/ })).toHaveLength(8);
  expect(container.querySelector('details')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Abrir cita de/ })).not.toBeInTheDocument();
});

it('la celda mensual compartida conserva las tres citas y navegación originales de Recepción por defecto', () => {
  const entries = Array.from({ length: 8 }, (_, i) => visit(i + 1)), onDay = vi.fn();
  const { container } = render(<ReceptionMonthCell date={fromLocalDateInput(date)} appointments={entries} timeZone="UTC"
    clinicException={undefined} onSelectDay={onDay} renderAppointment={a => <button type="button">Cita {a.id}</button>} />);
  expect(screen.getAllByRole('button', { name: /^Cita/ })).toHaveLength(3);
  expect(container.querySelector('.owner-month-cell')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ver 5 citas más del lun, 26 oct' }));
  expect(onDay).toHaveBeenCalledOnce();
});

it('la semana personal usa las visitas de Recepción con la apertura clínica existente, no sus enlaces globales', () => {
  const onOpen = vi.fn();
  render(<MemoryRouter><OwnerWeekAgenda days={week} appointments={[visit(1)]} zone="UTC" today={date} date={date} onSelectDate={vi.fn()} exceptions={[]}
    onOpen={onOpen} onDay={vi.fn()} personal returnTo="/appointments?scope=mine&view=week" /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /^Abrir cita de Paciente 1/ }));
  expect(onOpen).toHaveBeenCalledWith(1);
  expect(screen.queryByRole('link', { name: /^Cita con/ })).not.toBeInTheDocument();
});

it('permite seleccionar fechas vacías y distingue hoy de la selección con atributos accesibles', () => {
  const onDay = vi.fn();
  render(<OwnerMonthCalendar days={month} appointments={[visit(1)]} zone="UTC" today="2026-10-27" date={date}
    exceptions={[]} onOpen={vi.fn()} onDay={onDay} personal />);
  const selected = screen.getByRole('button', { name: /^Ver 1 cita del lunes, 26/ });
  const today = screen.getByRole('button', { name: /^Ver 0 citas del martes, 27/ });
  expect(selected).toHaveAttribute('aria-pressed', 'true');
  expect(today).toHaveAttribute('aria-current', 'date');
  expect(today).toHaveAttribute('aria-pressed', 'false');
  act(() => today.focus());
  fireEvent.click(today);
  expect(today).toHaveAttribute('aria-pressed', 'true');
  const detail = within(screen.getByRole('region', { name: 'Citas del día seleccionado' }));
  expect(today).toHaveFocus();
  expect(detail.getByText('No hay citas para esta fecha')).toBeInTheDocument();
  expect(onDay).not.toHaveBeenCalled();
});

it('la agenda integrada cambia de fecha sin ventanas, cierre con Escape ni captura de foco', () => {
  const entries = [...Array.from({ length: 8 }, (_, i) => visit(i + 1)), visit(50, Date.UTC(2026, 9, 27, 10))];
  render(<OwnerMonthCalendar days={month} appointments={entries} zone="UTC" today={date} date={date}
    exceptions={[]} onOpen={vi.fn()} onDay={vi.fn()} personal={false} />);
  fireEvent.click(screen.getByRole('button', { name: /^Ver 8 citas del lunes, 26/ }));
  const detail = screen.getByRole('region', { name: 'Citas del día seleccionado' });
  expect(within(detail).getAllByRole('button', { name: /^Abrir cita de/ })).toHaveLength(8);
  fireEvent.click(screen.getByRole('button', { name: /^Ver 1 cita del martes, 27/ }));
  expect(within(detail).getAllByRole('button', { name: /^Abrir cita de/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /^Ver 8 citas del lunes, 26/ }));
  expect(within(detail).getAllByRole('button', { name: /^Abrir cita de/ })).toHaveLength(8);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('region', { name: 'Citas del día seleccionado' })).toBe(detail);
  expect(detail).not.toHaveAttribute('popover');
});

it('los conteos siguen el día clínico, no el UTC del instante, y se actualizan con el conjunto filtrado', () => {
  const entries = [visit(1, Date.UTC(2026, 9, 27, 0, 30)), visit(2, Date.UTC(2026, 9, 27, 1))];
  const props = { days: month, zone: 'America/Mexico_City', today: date, date, exceptions: [], onOpen: vi.fn(), onDay: vi.fn(), personal: false };
  const { rerender } = render(<OwnerMonthCalendar {...props} appointments={entries} />);
  const button = screen.getByRole('button', { name: /^Ver 2 citas del lunes, 26/ });
  expect(button.querySelector('.owner-month-count')).toHaveTextContent('2 citas');
  expect(screen.getByRole('button', { name: /^Ver 0 citas del martes, 27/ }).querySelector('.owner-month-count')).toHaveTextContent('0 citas');
  rerender(<OwnerMonthCalendar {...props} appointments={[entries[0]!]} />);
  expect(screen.getByRole('button', { name: /^Ver 1 cita del lunes, 26/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: /^Ver 1 cita del lunes, 26/ }));
  expect(within(screen.getByRole('region', { name: 'Citas del día seleccionado' })).getAllByRole('button', { name: /^Abrir cita de/ })).toHaveLength(1);
});

it('mantiene una selección coherente al cambiar el mes mostrado y admite el primer día como respaldo', () => {
  const props = { appointments: [], zone: 'UTC', today: date, exceptions: [], onOpen: vi.fn(), onDay: vi.fn(), personal: true, onSelectDate: vi.fn() };
  const { rerender } = render(<OwnerMonthCalendar {...props} days={month} date={date} />);
  const next = rangeForView('month', fromLocalDateInput('2026-11-19'), 'UTC').days;
  rerender(<OwnerMonthCalendar {...props} days={next} date="2026-11-19" />);
  expect(screen.getByRole('button', { name: /^Ver 0 citas del jueves, 19/ })).toHaveAttribute('aria-pressed', 'true');
  expect(within(screen.getByRole('region', { name: 'Citas del día seleccionado' })).getByRole('heading', { name: /19 de noviembre/ })).toBeInTheDocument();
  rerender(<OwnerMonthCalendar {...props} days={next} date={date} />);
  expect(screen.getByRole('button', { name: /^Ver 0 citas del domingo, 1 de/ })).toHaveAttribute('aria-pressed', 'true');
});

it('la selección mensual controlada actualiza la agenda sin mover el foco ni cerrar al salir de ella', () => {
  const onSelectDate = vi.fn();
  const entries = [visit(1), visit(2, Date.UTC(2026, 9, 27, 10))];
  const props = { days: month, appointments: entries, zone: 'UTC', today: date, exceptions: [], onOpen: vi.fn(), onDay: vi.fn(), personal: false, onSelectDate };
  const content = (selected: string) => <><button type="button">Fuera del calendario</button><OwnerMonthCalendar {...props} date={selected} /></>;
  const { rerender } = render(content(date));
  const panel = screen.getByRole('region', { name: 'Citas del día seleccionado' });
  const tuesday = screen.getByRole('button', { name: /^Ver 1 cita del martes, 27/ });
  act(() => tuesday.focus()); fireEvent.click(tuesday);
  expect(onSelectDate).toHaveBeenCalledWith(fromLocalDateInput('2026-10-27'));
  rerender(content('2026-10-27'));
  expect(screen.getByRole('region', { name: 'Citas del día seleccionado' })).toBe(panel);
  expect(within(panel).getByRole('heading', { name: /martes, 27/ })).toBeInTheDocument();
  expect(tuesday).toHaveFocus();
  act(() => screen.getByRole('button', { name: 'Fuera del calendario' }).focus());
  expect(screen.getByRole('region', { name: 'Citas del día seleccionado' })).toBe(panel);
  expect(screen.getByRole('button', { name: 'Fuera del calendario' })).toHaveFocus();
});

it('la semana conserva todas las jornadas y la selección delegada sin abrir Día', () => {
  const onSelectDate = vi.fn(), onDay = vi.fn();
  const entries = [visit(1), visit(2, Date.UTC(2026, 9, 27, 10))];
  const props = { days: week, appointments: entries, zone: 'UTC', today: date, exceptions: [], onOpen: vi.fn(), onDay, onSelectDate, personal: false, returnTo: '/appointments?view=week&date=2026-10-26&status=SCHEDULED' };
  const { rerender } = render(<MemoryRouter><OwnerWeekAgenda {...props} date={date} /></MemoryRouter>);
  expect(screen.getAllByRole('link', { name: /^Cita con/ })).toHaveLength(2);
  expect(screen.getByRole('link', { name: /^Cita con Paciente 2/ })).toBeInTheDocument();
  const tuesday = within(screen.getByRole('navigation', { name: 'Días de esta semana' })).getByRole('button', { name: /^Ver 1 cita del martes/ });
  fireEvent.click(tuesday);
  expect(onSelectDate).toHaveBeenCalledWith(fromLocalDateInput('2026-10-27'));
  expect(onDay).not.toHaveBeenCalled();
  rerender(<MemoryRouter><OwnerWeekAgenda {...props} date="2026-10-27" returnTo="/appointments?view=week&date=2026-10-27&status=SCHEDULED" /></MemoryRouter>);
  expect(tuesday).toHaveAttribute('aria-pressed', 'true');
  const link = screen.getByRole('link', { name: /^Cita con Paciente 2/ });
  expect(decodeURIComponent(link.getAttribute('href')!)).toContain('date=2026-10-27&status=SCHEDULED');
  expect(screen.getByRole('link', { name: /^Cita con Paciente 1/ })).toBeInTheDocument();
});

it('la agenda completa del día no oculta citas y conserva grupos, duración, orden y DTO originales', () => {
  const start = Date.UTC(2026, 9, 26, 9), onOpen = vi.fn();
  const entries = [visit(9, start + 60 * 60_000, 5), ...Array.from({ length: 7 }, (_, i) => visit(i + 1, start))];
  const original = structuredClone(entries);
  const { container } = render(<OwnerDayAgenda appointments={entries} zone="UTC" onOpen={onOpen} scheduleLabel="Horario de clínica: 09:00–17:00." />);
  const list = screen.getByRole('list', { name: 'Bloques de inicio del día' });
  expect(within(list).getAllByRole('button', { name: /^Abrir cita de/ })).toHaveLength(8);
  expect(within(list).getAllByText(/30 min/)).toHaveLength(7);
  expect(within(list).getAllByText('09:00')).toHaveLength(8);
  expect(screen.getByRole('region', { name: 'Citas con inicio a las 09:00' })).toHaveTextContent('7 citas · Mismo inicio');
  expect(screen.queryByText('Ver 1 cita más')).not.toBeInTheDocument();
  expect(screen.getByText(/5 min/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Abrir cita de Paciente 9/ })); expect(onOpen).toHaveBeenCalledWith(9);
  expect(entries).toEqual(original); expect(container.querySelector('.owner-day-grid')).toBeNull();
});

it('distingue un mismo inicio de intervalos solapados y no marca los extremos consecutivos', () => {
  const start = Date.UTC(2026, 9, 26, 9);
  const entries = [visit(1, start, 60), visit(2, start), visit(3, start + 15 * 60_000), visit(4, start + 60 * 60_000)];
  render(<OwnerStartGroups appointments={entries} zone="UTC" onOpen={vi.fn()} />);
  expect(screen.getAllByRole('region')).toHaveLength(3);
  expect(within(screen.getByRole('region', { name: 'Citas con inicio a las 09:00' })).getAllByRole('button')).toHaveLength(2);
  expect(within(screen.getByRole('region', { name: 'Citas con inicio a las 09:15' })).getByText(/Coincidencia horaria/)).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Citas con inicio a las 10:00' })).queryByText(/Coincidencia horaria/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/no indica un conflicto ni disponibilidad/)).toHaveLength(1);
});

it('agrupa instantes equivalentes con offsets diferentes, no etiquetas locales repetidas por DST', () => {
  const same = { ...visit(2, Date.UTC(2026, 10, 1, 5, 30)), startAt: '2026-11-01T01:30:00-04:00' };
  render(<OwnerStartGroups appointments={[visit(1, Date.UTC(2026, 10, 1, 5, 30)), same, visit(3, Date.UTC(2026, 10, 1, 6, 30))]} zone="America/New_York" onOpen={vi.fn()} />);
  expect(screen.getAllByRole('region')).toHaveLength(2);
  expect(screen.getAllByText('01:30')).toHaveLength(5);
  expect(screen.getByText('GMT-4')).toBeInTheDocument();
  expect(screen.getByText('GMT-5')).toBeInTheDocument();
  expect(screen.getByText('2 citas · Mismo inicio')).toBeInTheDocument();
});

it('la ficha agrupada conserva servicio histórico ausente, todos los estados y nombre accesible completo', () => {
  const start = Date.UTC(2026, 9, 26, 9);
  const entries = (['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const).map((status, i) => ({ ...visit(i + 1, start, 5), status }));
  render(<OwnerStartGroups appointments={entries} zone="UTC" onOpen={vi.fn()} />);
  for (const status of ['Programada', 'Completada', 'Cancelada', 'No asistió']) expect(screen.getByText(status)).toBeInTheDocument();
  expect(screen.getAllByText('Cita sin servicio asociado')).toHaveLength(4);
  expect(screen.getByRole('button', { name: /Paciente 1 Prueba.*09:00.*Programada.*Ana Propietaria.*09:05.*5 min/ })).toBeInTheDocument();
});

it('la comparación temporal es un despliegue opcional nativo, no el contenido principal del Día', () => {
  render(<OwnerColumnComparison><section aria-label="Cuadrícula de prueba">Columnas</section></OwnerColumnComparison>);
  const summary = screen.getByText('Comparar dentistas en columnas'), details = summary.closest('details')!;
  expect(details).not.toHaveAttribute('open'); fireEvent.click(summary); expect(details).toHaveAttribute('open');
});

it('la semana muestra jornadas vacías sin interpretar disponibilidad ni ocultar otras fechas', () => {
  render(<MemoryRouter><OwnerWeekAgenda days={week} appointments={[visit(1)]} zone="UTC" today={date} date="2026-10-28"
    exceptions={[]} onOpen={vi.fn()} onDay={vi.fn()} onSelectDate={vi.fn()} personal returnTo="/appointments?scope=mine&view=week" /></MemoryRouter>);
  expect(screen.getByRole('button', { name: /^Abrir cita de/ })).toBeInTheDocument();
  expect(screen.getAllByText(/Sin citas registradas/)).toHaveLength(6);
  expect(screen.getByText(/Un día sin citas no implica disponibilidad/)).toBeInTheDocument();
});
