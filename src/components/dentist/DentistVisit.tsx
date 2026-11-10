import { Link } from 'react-router-dom';

import type { AppointmentResponse, AppointmentStatus } from '../../api/appointments';
import { statusLabel } from '../appointments/appointmentUi';

/**
 * UX-05A — Estado de una cita como chip con color Y texto (§22.1: nunca solo color).
 * La salvia se reserva a "Programada"; el resto usa tokens semánticos de estado.
 */
export function DentistStatusChip({ status }: { status: AppointmentStatus }) {
  const modifier = status === 'SCHEDULED' ? 'scheduled'
    : status === 'COMPLETED' ? 'completed'
      : status === 'CANCELLED' ? 'cancelled' : 'noshow';
  return <span className={`dentist-status dentist-status-${modifier}`}>{statusLabel(status)}</span>;
}

/**
 * Fila de agenda de solo lectura: hora, paciente, servicio y estado. Los enlaces a cita
 * y expediente reutilizan las rutas autorizadas (ninguna ruta ni dato clínico nuevo).
 */
export function DentistVisitRow({ appointment, time, endTime, recordHref, appointmentHref }: {
  appointment: AppointmentResponse; time: string; endTime?: string; recordHref: string; appointmentHref?: string;
}) {
  const name = `${appointment.patientFirstName ?? ''} ${appointment.patientLastName ?? ''}`.trim();
  const when = `${time} · ${statusLabel(appointment.status)}`;
  return (
    <article className="dentist-visit" data-status={appointment.status} aria-label={`Cita con ${name} a las ${when}`}>
      <time className="dentist-visit-time" dateTime={appointment.startAt}>
        <strong>{time}</strong><span>{endTime ? `– ${endTime}` : appointment.startAt && appointment.endAt ? 'Cita de hoy' : ''}</span>
      </time>
      <div className="dentist-visit-person">
        <strong>{name}</strong>
        <span>{appointment.service?.name ?? 'Cita sin servicio asociado'}</span>
        <div className="dentist-visit-actions">
          <Link className="dentist-link" to={appointmentHref ?? `/appointments/${appointment.id}`}>Abrir cita</Link>
          <Link className="dentist-link" to={recordHref}>Abrir expediente</Link>
        </div>
      </div>
      <DentistStatusChip status={appointment.status} />
    </article>
  );
}
