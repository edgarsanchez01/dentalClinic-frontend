import type { AppointmentResponse } from '../../api/appointments';
import { formatTime, fullName, statusChipClass, statusLabel } from '../appointments/appointmentUi';

/** Existing reception event, shared with OWNER without its own status/type scale. */
export function ReceptionCalendarEvent({ appointment, timeZone, onOpen, temporal = false }: {
  appointment: AppointmentResponse; timeZone: string; onOpen: (id: number) => void; temporal?: boolean;
}) {
  const start = formatTime(appointment.startAt, timeZone);
  const name = fullName(appointment.patientFirstName, appointment.patientLastName);
  return <button type="button" title={statusLabel(appointment.status)}
    aria-label={`Cita con ${name} a las ${start} ${statusLabel(appointment.status)}`} onClick={() => onOpen(appointment.id)}
    data-short={temporal && appointment.durationMinutes < 25 || undefined}
    className={`reception-calendar-event ${statusChipClass(appointment.status)} focus-visible:ring-2 focus-visible:ring-primary`}>
    <span className="reception-calendar-event-time">{start}–{formatTime(appointment.endAt, timeZone)} · {statusLabel(appointment.status)}</span><strong>{name}</strong>
    <span className="block text-[length:var(--text-caption)]">{fullName(appointment.dentistFirstName, appointment.dentistLastName)} · {statusLabel(appointment.status)}</span>
  </button>;
}
