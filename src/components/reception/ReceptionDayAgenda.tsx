import type { AppointmentResponse } from '../../api/appointments';
import { clockLabel, minutesOfDay } from '../appointments/appointmentUi';
import { ReceptionVisit } from './ReceptionVisit';
import type { ReactNode } from 'react';

export function ReceptionDayAgenda({ appointments, timezone, onOpen, clinicConfigured, clinicOpen, hasWindow, context, children, renderAppointment }: {
  appointments: AppointmentResponse[]; timezone: string; onOpen: (id: number) => void;
  clinicConfigured: boolean; clinicOpen: boolean; hasWindow: boolean;
  context?: ReactNode; children?: ReactNode; renderAppointment?: (appointment: AppointmentResponse) => ReactNode;
}) {
  const groups = new Map<number, AppointmentResponse[]>();
  for (const appointment of appointments) {
    const hour = Math.floor(minutesOfDay(new Date(appointment.startAt), timezone) / 60);
    groups.set(hour, [...(groups.get(hour) ?? []), appointment]);
  }
  return <section aria-label="Agenda del día" className="reception-day-register">
    <h2>Agenda del día</h2>
    {context}
    {!clinicConfigured ? <p className="reception-operation-notice">Configura el horario de la clínica para ver la disponibilidad del día.</p>
      : !clinicOpen || !hasWindow ? <p className="reception-operation-notice">La clínica no atiende este día.</p>
        : appointments.length === 0 ? <div className="reception-quiet-day"><h3>Un día por organizar</h3><p>No hay citas para este día.</p><p>Usa «Crear cita» para consultar los horarios disponibles.</p></div> : null}
    {children ?? [...groups.entries()].map(([hour, visits]) => <div key={hour} className="reception-hour-group">
      <h3>{clockLabel(hour * 60)}</h3><ul>{visits.map(appointment => <li key={appointment.id}>{renderAppointment ? renderAppointment(appointment) : <ReceptionVisit appointment={appointment} timezone={timezone} onOpen={onOpen} />}</li>)}</ul>
    </div>)}
  </section>;
}
