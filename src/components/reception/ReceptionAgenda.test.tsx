import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentResponse } from '../../api/appointments';
import { addDays } from '../appointments/appointmentUi';
import { ReceptionWeekAgenda } from './ReceptionWeekAgenda';
import { ReceptionDayAgenda } from './ReceptionDayAgenda';

const days = Array.from({ length: 7 }, (_, index) => addDays(new Date('2026-10-19T00:00:00Z'), index));
const appointment: AppointmentResponse = { id: 1, patientId: 2, patientFirstName: 'Paciente', patientLastName: 'Sintético', dentistId: 7, dentistFirstName: 'Profesional', dentistLastName: 'Sintética', startAt: '2026-10-20T01:00:00Z', endAt: '2026-10-20T01:30:00Z', status: 'SCHEDULED', durationMinutes: 30, occurrenceVersion: 1, createdByUserId: 1, createdAt: '2026-10-19T16:00:00Z' };
afterEach(cleanup);

function week(appointments: AppointmentResponse[] = [appointment]) {
  const select = vi.fn();
  render(<MemoryRouter><ReceptionWeekAgenda days={days} appointments={appointments} timezone="America/Mexico_City" today="2026-10-19" exceptions={[{ date: '2026-10-23', closed: true }]} onSelectDay={select} /></MemoryRouter>);
  return select;
}
describe('Agenda editorial de recepción, sin reglas de disponibilidad', () => {
  it('agrupa por día clínico, muestra hora, paciente, profesional y estado y enlaza el detalle existente', () => {
    week();
    const monday = within(screen.getByRole('region', { name: 'lunes, 19 de octubre de 2026' }));
    const link = monday.getByRole('link', { name: 'Cita con Paciente Sintético a las 19:00 Programada' });
    expect(link).toHaveAttribute('href', '/appointments/1');
    expect(link).toHaveTextContent('19:30');
    expect(link).toHaveTextContent('Profesional Sintética');
    expect(link).toHaveTextContent('Cita sin servicio asociado');
    expect(within(screen.getByRole('region', { name: 'martes, 20 de octubre de 2026' })).queryByRole('link')).not.toBeInTheDocument();
  });
  it('no oculta citas simultáneas de distintos profesionales ni estados terminales', () => {
    week(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map((status, index) => ({ ...appointment, id: index + 1, dentistId: index + 7, status: status as AppointmentResponse['status'] })));
    expect(screen.getAllByRole('link', { name: /^Cita con/ })).toHaveLength(4);
    for (const status of ['Programada', 'Completada', 'Cancelada', 'No asistió']) expect(screen.getByText(status, { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Completar|Reservar|Deshacer/ })).not.toBeInTheDocument();
  });
  it('diferencia vacío de disponibilidad, conserva siete días y excepciones y abre el día elegido', () => {
    const select = week([]);
    expect(screen.getByRole('heading', { name: 'Una semana por organizar' })).toBeInTheDocument();
    expect(screen.getByText(/Un día sin citas no implica disponibilidad/)).toBeInTheDocument();
    expect(screen.getByText('Clínica cerrada')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Ver día/ })).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Ver día mar, 20 oct' }));
    expect(select).toHaveBeenCalledWith(days[1]);
    expect(screen.queryByRole('button', { name: /^Reservar/ })).not.toBeInTheDocument();
  });
  it('la lista diaria conserva las citas existentes aunque la clínica esté cerrada, y solo abre el detalle', () => {
    const open = vi.fn();
    render(<MemoryRouter><ReceptionDayAgenda appointments={[appointment]} timezone="America/Mexico_City" onOpen={open} clinicConfigured clinicOpen={false} hasWindow={false} /></MemoryRouter>);
    expect(screen.getByText('La clínica no atiende este día.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir cita de Paciente Sintético a las 19:00 Programada' }));
    expect(open).toHaveBeenCalledWith(1);
  });
  it('horarios no configurados no se convierten en disponibilidad ni en una rejilla ficticia', () => {
    render(<MemoryRouter><ReceptionDayAgenda appointments={[]} timezone="America/Mexico_City" onOpen={vi.fn()} clinicConfigured={false} clinicOpen={false} hasWindow={false} /></MemoryRouter>);
    expect(screen.getByText(/Configura el horario de la clínica/)).toBeInTheDocument();
    expect(screen.queryByText('09:00')).not.toBeInTheDocument();
  });
});
