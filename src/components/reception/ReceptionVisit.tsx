import { Link } from 'react-router-dom';
import type { AppointmentResponse } from '../../api/appointments';
import { formatTime, fullName, statusChipClass, statusLabel } from '../appointments/appointmentUi';
import './reception-visit.css';

/** A readable appointment, not a compressed calendar chip. No clinical fields or actions. */
export function ReceptionVisit({ appointment, timezone, onOpen, returnTo, showDuration = false, groupedStart = false, className: extraClass, ariaLabel, title, serviceFallback = 'Cita sin servicio asociado' }: { appointment: AppointmentResponse; timezone: string; onOpen?: (id: number) => void; returnTo?: string; showDuration?: boolean; groupedStart?: boolean; className?: string; ariaLabel?: string; title?: string; serviceFallback?: string }) {
  const content = <>
    {!groupedStart ? <time className="reception-visit-time" dateTime={appointment.startAt}>
      <strong>{formatTime(appointment.startAt, timezone)}</strong><span>{formatTime(appointment.endAt, timezone)}</span>
      {showDuration && Number.isFinite(appointment.durationMinutes) ? <span>{appointment.durationMinutes} min</span> : null}
    </time> : null}
    <span className="reception-visit-person"><strong>{fullName(appointment.patientFirstName, appointment.patientLastName)}</strong>
      {groupedStart ? <span className="owner-start-description"><span className="owner-visit-service">{appointment.service?.name ?? serviceFallback}</span>
        <span className="owner-start-meta"><span className="reception-visit-professional">{fullName(appointment.dentistFirstName, appointment.dentistLastName)}</span>
          <span>Hasta <time dateTime={appointment.endAt}>{formatTime(appointment.endAt, timezone)}</time>{Number.isFinite(appointment.durationMinutes) ? <> · {appointment.durationMinutes} min</> : null}</span>
        </span>
      </span> : <><span>{appointment.service?.name ?? serviceFallback}</span><span className="reception-visit-professional">{fullName(appointment.dentistFirstName, appointment.dentistLastName)}</span></>}
    </span>
    <span className={`reception-visit-status ${statusChipClass(appointment.status)}`}>{statusLabel(appointment.status)}</span>
  </>;
  const name = fullName(appointment.patientFirstName, appointment.patientLastName);
  const when = `${formatTime(appointment.startAt, timezone)} ${statusLabel(appointment.status)}`;
  const context = groupedStart || showDuration ? ` · ${appointment.service?.name ?? 'Cita sin servicio asociado'} · ${fullName(appointment.dentistFirstName, appointment.dentistLastName)} · hasta ${formatTime(appointment.endAt, timezone)} · ${appointment.durationMinutes} min` : '';
  const className = `reception-visit${groupedStart ? ' owner-start-visit' : ''}${extraClass ? ` ${extraClass}` : ''}`;
  return onOpen ? <button type="button" className={className} title={title} data-status={appointment.status} aria-label={ariaLabel ?? `Abrir cita de ${name} a las ${when}${context}`} onClick={() => onOpen(appointment.id)}>{content}</button>
    : <Link className={className} title={title} data-status={appointment.status} to={`/appointments/${appointment.id}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`} aria-label={ariaLabel ?? `Cita con ${name} a las ${when}${context}`}>{content}</Link>;
}
