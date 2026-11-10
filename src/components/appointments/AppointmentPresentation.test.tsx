import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppointmentResponse } from '../../api/appointments';
import { AvailableSlots } from './AvailableSlots';
import { AppointmentFacts } from './AppointmentFacts';
import { AppointmentEvents } from './AppointmentEvents';
import { ServiceSnapshot } from './ServiceSnapshot';
import { BookingStep, BookingStepRail } from './BookingPresentation';
import { AgendaFilters, OwnerAgendaToolbar } from './AgendaToolbar';
import { DentistSlots } from '../dentist/DentistSlots';
import { ReceptionVisit } from '../reception/ReceptionVisit';

afterEach(cleanup);
const morning = { startDate: '2026-10-20', startTime: '09:00:00', endTime: '09:30:00', start: '2026-10-20T15:00:00Z', end: '2026-10-20T15:30:00Z' };
const afternoon = { ...morning, startTime: '16:00:00', endTime: '16:30:00', start: '2026-10-20T22:00:00Z', end: '2026-10-20T22:30:00Z' };
const appointment: AppointmentResponse = { id: 7, patientId: 4, patientFirstName: 'Paciente', patientLastName: 'Prueba', dentistId: 3, dentistFirstName: 'Profesional', dentistLastName: 'Prueba', startAt: morning.start, endAt: morning.end, durationMinutes: 30, status: 'SCHEDULED', occurrenceVersion: 2, createdByUserId: 1, createdAt: morning.start, reason: 'Motivo original', notes: 'Nota administrativa' };

it('slots delegan el objeto API intacto, selección controlada y disabled', () => {
  const select = vi.fn();
  const view = render(<AvailableSlots slots={[morning, afternoon]} selected={morning.start} onSelect={select} label="Huecos" className="slots" />);
  expect(screen.getByRole('button', { name: '09:00–09:30' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '16:00–16:30' }));
  expect(select).toHaveBeenCalledWith(afternoon);
  expect(select.mock.calls[0][0]).toBe(afternoon);
  view.rerender(<AvailableSlots slots={[morning]} selected="" onSelect={select} label="Huecos" className="slots" disabled />);
  expect(screen.getByRole('button')).toBeDisabled();
});

it('agrupa PATIENT en hora clínica, no en hora UTC; conserva el foco al seleccionar', () => {
  const props = { slots: [morning, afternoon], onSelect: vi.fn(), label: 'Huecos', className: 'patient-slots', periods: { timezone: 'America/Mexico_City', periodClassName: 'patient-slot-group', gridClassName: 'patient-slot-grid' } };
  const view = render(<AvailableSlots {...props} selected="" />);
  const group = screen.getByRole('heading', { name: 'Mañana' }).parentElement!;
  const button = within(group).getByRole('button', { name: '09:00–09:30' });
  button.focus();
  view.rerender(<AvailableSlots {...props} selected={morning.start} />);
  expect(button).toHaveFocus();
  expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(within(screen.getByRole('heading', { name: 'Tarde' }).parentElement!).getAllByRole('button')).toHaveLength(1);
});

it('slots editoriales muestran hora clínica, duración y selección sin mutar el objeto ni reservar', () => {
  const select = vi.fn();
  const props = { slots: [morning, afternoon], onSelect: select, label: 'Horarios reales', className: 'legacy', editorial: { timezone: 'America/Mexico_City', durationMinutes: 30 } };
  const view = render(<AvailableSlots {...props} selected="" />);
  const group = within(screen.getByRole('heading', { name: 'Mañana' }).parentElement!);
  const button = group.getByRole('button', { name: '09:00–09:30' });
  expect(button).toHaveTextContent('30 min');
  expect(button).toHaveAttribute('aria-description', '30 minutos');
  button.focus(); fireEvent.click(button);
  expect(select).toHaveBeenCalledExactlyOnceWith(morning);
  expect(select.mock.calls[0][0]).toBe(morning);
  expect(button).toHaveAttribute('aria-pressed', 'false');
  view.rerender(<AvailableSlots {...props} selected={morning.start} />);
  expect(button).toHaveFocus();
  expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(button).toHaveTextContent('Seleccionado');
  expect(within(screen.getByRole('heading', { name: 'Tarde' }).parentElement!).getByRole('button')).toHaveAccessibleName('16:00–16:30');
});

it('DENTIST muestra todos los slots sin selector previo y conserva la selección controlada entre renders', () => {
  const next = { ...morning, startTime: '10:00:00', endTime: '10:30:00', start: '2026-10-20T16:00:00Z', end: '2026-10-20T16:30:00Z' };
  const select = vi.fn();
  const props = { slots: [morning, next, afternoon], onSelect: select, timezone: 'America/Mexico_City', durationMinutes: 30 };
  const view = render(<DentistSlots {...props} selected={morning.start} />);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(3);
  expect(screen.getByRole('button', { name: '09:00–09:30' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '10:00–10:30' }));
  expect(select).toHaveBeenCalledExactlyOnceWith(next);
  expect(select.mock.calls[0][0]).toBe(next);
  select.mockClear();
  expect(select).not.toHaveBeenCalled();
  view.rerender(<DentistSlots {...props} selected={morning.start} />);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(3);
  expect(screen.getByRole('button', { name: '09:00–09:30' })).toHaveAttribute('aria-pressed', 'true');
});

it('la duración editorial viene de la respuesta autoritativa, no de restar instantes ni textos', () => {
  render(<AvailableSlots slots={[morning]} selected="" onSelect={vi.fn()} label="Duración recibida" className="" editorial={{ timezone: 'America/Mexico_City', durationMinutes: 45 }} />);
  const button = screen.getByRole('button', { name: '09:00–09:30' });
  expect(button).toHaveTextContent('45 min');
  expect(button).toHaveAttribute('aria-description', '45 minutos');
});

it('composición compartida mantiene información, estado y callback clínico sin convertirlo en enlace', () => {
  const onOpen = vi.fn();
  render(<ReceptionVisit appointment={{ ...appointment, status: 'NO_SHOW', patientLastName: 'Nombre extenso de la Fuente Rodríguez', service: { id: 2, name: 'Seguimiento prolongado de tratamiento odontológico', durationMinutes: 30, referencePrice: '100.00', description: null } }} timezone="America/Mexico_City" onOpen={onOpen} className="dc-agenda-visit" ariaLabel="Abrir atención original" />);
  const button = screen.getByRole('button', { name: 'Abrir atención original' });
  expect(button).toHaveTextContent('Nombre extenso de la Fuente Rodríguez');
  expect(button).toHaveTextContent('Seguimiento prolongado de tratamiento odontológico');
  expect(button).toHaveTextContent('No asistió');
  expect(button).toHaveTextContent('09:00');
  expect(button).toHaveTextContent('09:30');
  fireEvent.click(button);
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(7);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it.each([true, false])('facts conservan versión y datos administrativos en receta owner=%s', owner => {
  render(<AppointmentFacts appointment={appointment} timeZone="UTC" owner={owner} />);
  expect(screen.getByText('Paciente Prueba')).toBeInTheDocument();
  expect(screen.getByText('Motivo original')).toBeInTheDocument();
  expect(screen.getByText('Nota administrativa')).toBeInTheDocument();
  expect(screen.getByText('2')).toBeInTheDocument();
  expect(screen.getAllByRole('term')).toHaveLength(6);
});

it('snapshot histórico no requiere catálogo y PATIENT no muestra precio', () => {
  const service = { id: 999, name: 'Servicio histórico retirado', durationMinutes: 45, referencePrice: '123.45', description: 'Descripción original' };
  const view = render(<ServiceSnapshot service={service} owner />);
  expect(screen.getByText('Servicio histórico retirado · 45 min')).toBeInTheDocument();
  expect(screen.getByText(/Precio de referencia:/)).toBeInTheDocument();
  view.rerender(<ServiceSnapshot service={service} patient />);
  expect(screen.queryByText(/Precio de referencia:/)).not.toBeInTheDocument();
  expect(screen.getByText('Descripción original')).toBeInTheDocument();
  view.rerender(<ServiceSnapshot service={null} />);
  expect(screen.getByText(/Cita histórica sin servicio asociado/)).toBeInTheDocument();
});

it('events preservan carga/error/vacío e historial de solo lectura', () => {
  const view = render(<AppointmentEvents events={undefined} loading error={null} timeZone="UTC" />);
  expect(screen.getByRole('status')).toHaveTextContent('Cargando eventos');
  view.rerender(<AppointmentEvents events={undefined} loading={false} error={new Error('Fallo')} timeZone="UTC" />);
  expect(screen.getByRole('alert')).toBeInTheDocument();
  view.rerender(<AppointmentEvents events={[]} loading={false} error={null} timeZone="UTC" />);
  expect(screen.getByText('Sin eventos.')).toBeInTheDocument();
  view.rerender(<AppointmentEvents events={[{ id: 1, eventType: 'PATIENT_ARRIVED', actorUserId: 1, occurrenceVersion: 1, createdAt: morning.start }]} loading={false} error={null} timeZone="UTC" owner />);
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('pasos quedan montados: cambiar paso no borra campos ni altera el ref del encabezado', () => {
  const ref = vi.fn();
  const view = render(<><BookingStepRail current={1} /><BookingStep step={1} title="Paciente y servicio" active done={false} headingRef={ref}><input aria-label="Borrador" defaultValue="Texto conservado" /></BookingStep></>);
  const input = screen.getByRole('textbox');
  view.rerender(<><BookingStepRail current={2} /><BookingStep step={1} title="Paciente y servicio" active={false} done headingRef={ref}><input aria-label="Borrador" defaultValue="Texto conservado" /></BookingStep></>);
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input).toHaveValue('Texto conservado');
  expect(input.closest('.reception-step')).toHaveAttribute('data-active', 'false');
  expect(screen.getByRole('list').querySelector('[aria-current="step"]')).toHaveTextContent('Fecha y horario');
  expect(ref).toHaveBeenCalledWith(screen.getByRole('heading'));
});

it('toolbar OWNER solo delega navegación y filtros, sin modificar el modelo', () => {
  const change = vi.fn(), shift = vi.fn(), date = vi.fn(), status = vi.fn();
  render(<OwnerAgendaToolbar view="week" onView={change} onShift={shift} onToday={vi.fn()} periodLabel="Semana" dateValue="2026-10-20" onDateChange={date} isMobile={false} personal={false} dentistFilter="" statusFilter="" timeZone="UTC"
    filters={<AgendaFilters dentists={[]} dentistFilter="" myDentistId={undefined} isDentist={false} statusFilter="" onDentistChange={vi.fn()} onStatusChange={status} />} />);
  fireEvent.click(screen.getByRole('button', { name: 'Día' })); expect(change).toHaveBeenCalledWith('day');
  fireEvent.click(screen.getByRole('button', { name: 'Siguiente' })); expect(shift).toHaveBeenCalledWith(1);
  fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-10-21' } }); expect(date).toHaveBeenCalledWith('2026-10-21');
  fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: 'NO_SHOW' } }); expect(status).toHaveBeenCalledWith('NO_SHOW');
});
