import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AppointmentResponse } from '../../api/appointments';
import type { NotificationDto } from '../../api/notifications';
import { formatDayLong, formatTime, fullName, statusChipClass, statusLabel } from '../appointments/appointmentUi';
import { patientRecordLink } from '../dashboard/careDashboardData';
import { ReceptionPageHeader } from '../reception/ReceptionUI';
import './owner-home.css';
import './owner-clinical-home.css';

/** Presentation only. The existing DENTIST dashboard owns queries, scope and paging. */
export function OwnerClinicalHome({ children }: { children: ReactNode }) {
  return <div className="owner-home-hybrid owner-personal-home">{children}</div>;
}

export function OwnerClinicalHeader({ title, intro, context, action }: {
  title: string; intro: string; context?: ReactNode; action?: ReactNode;
}) {
  return <ReceptionPageHeader title={title} intro={intro}
    action={<div className="oh-header-context"><div>{context}</div>{action}</div>} />;
}

export function OwnerClinicalSection({ title, intro, action, label, children }: {
  title?: string; intro?: string; action?: ReactNode; label?: string; children: ReactNode;
}) {
  return <section aria-label={label} className="oh-card">
    <div className="oh-section-heading"><h2>{title}</h2>{action}</div>
    {intro ? <p className="oh-caption">{intro}</p> : null}
    {children}
  </section>;
}

function ClinicalStatus({ appointment }: { appointment: AppointmentResponse }) {
  return <span className={`oh-status ${statusChipClass(appointment.status)}`} data-status={appointment.status}>{statusLabel(appointment.status)}</span>;
}

export function OwnerClinicalNextPatient({ appointment, timezone, appointmentHref }: {
  appointment: AppointmentResponse; timezone: string; appointmentHref: string;
}) {
  return <>
    <div className="oh-section-heading"><h2>Siguiente paciente</h2></div>
    <p className="oh-caption">{formatDayLong(appointment.startAt, timezone)}</p>
    <div className="oh-next-visit">
      <time dateTime={appointment.startAt}><strong>{formatTime(appointment.startAt, timezone)}</strong><span>Fin: {formatTime(appointment.endAt, timezone)}</span></time>
      <div><h3>{fullName(appointment.patientFirstName, appointment.patientLastName)}</h3>
        <p>{appointment.service?.name ?? 'Cita sin servicio asociado'}</p><ClinicalStatus appointment={appointment} /></div>
    </div>
    <div className="oh-next-actions"><Link className="oh-link" to={appointmentHref}>Abrir cita</Link>
      <Link className="oh-link" to={patientRecordLink(appointment)}>Abrir expediente</Link></div>
    <p className="oh-caption op-protected-note">Notas, tratamientos y odontograma están disponibles dentro de la cita o el expediente autorizado. Dato de salud protegido.</p>
  </>;
}

export function OwnerClinicalVisit({ appointment, timezone, appointmentHref }: {
  appointment: AppointmentResponse; timezone: string; appointmentHref: string;
}) {
  const name = fullName(appointment.patientFirstName, appointment.patientLastName);
  const start = formatTime(appointment.startAt, timezone);
  return <article className="op-visit" data-status={appointment.status} aria-label={`Cita con ${name} a las ${start} · ${statusLabel(appointment.status)}`}>
    <time dateTime={appointment.startAt}><strong>{start}</strong><span>– {formatTime(appointment.endAt, timezone)}</span></time>
    <ClinicalStatus appointment={appointment} />
    <div className="op-visit-person"><strong>{name}</strong><span>{appointment.service?.name ?? 'Cita sin servicio asociado'}</span></div>
    <div className="op-visit-actions"><Link className="oh-link" to={appointmentHref}>Abrir cita</Link>
      <Link className="oh-link" to={patientRecordLink(appointment)}>Abrir expediente</Link></div>
  </article>;
}

export function OwnerClinicalNotices({ notifications, timezone }: { notifications: NotificationDto[]; timezone: string | undefined }) {
  return <ul className="oh-notifications op-notifications-list">{notifications.map(notification => <li key={notification.id} data-unread={!notification.read}>
    <h3>{notification.title}</h3><p className="op-notice-body">{notification.body}</p>
    <div className="op-notice-meta"><span>{notification.read ? 'Leída' : 'No leída'}</span>
      {notification.priority === 'HIGH' ? <span>Prioridad alta</span> : null}
      {timezone && Number.isFinite(Date.parse(notification.createdAt))
        ? <time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString('es-ES', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' })}</time> : null}
    </div>
  </li>)}</ul>;
}
