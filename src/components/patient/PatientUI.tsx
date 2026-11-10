import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AppointmentResponse } from '../../api/appointments';
import { apiErrorMessage, formatDayLong, formatTime, fullName, statusChipClass, statusLabel } from '../appointments/appointmentUi';
import { PageHeader } from '../ui/Page';
import { EmptyState } from '../ui/EmptyState';
import { QueryState } from '../ui/QueryState';

export function PatientPageHeader({ title, intro, action }: { title: string; intro: string; action?: ReactNode }) {
  return <PageHeader title={title} intro={intro} action={action} recipe={{ header: 'patient-page-heading' }} />;
}

export function PatientEmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <EmptyState title={title} action={action} className="patient-empty">{children}</EmptyState>;
}

export function PatientQueryState({ query, label, children }: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  label: string; children: ReactNode;
}) {
  return <QueryState status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
    loading={<div role="status" aria-label={`Cargando ${label}`} className="patient-loading"><span>Cargando {label}…</span><div aria-hidden="true" /><div aria-hidden="true" /></div>}
    failure={query.isError ? <div role="alert" className="patient-error"><p>{apiErrorMessage(query.error, `No se pudo cargar ${label}.`)}</p><button className="patient-link" onClick={() => void query.refetch()}>Reintentar {label}</button></div> : undefined}>{children}</QueryState>;
}

export function AppointmentCard({ appointment: a, timezone, featured = false }: { appointment: AppointmentResponse; timezone: string; featured?: boolean }) {
  return <article className={`patient-appointment${featured ? ' patient-appointment-featured' : ''}`}>
    <div className="patient-date-tile" aria-hidden="true"><span>{new Intl.DateTimeFormat('es-MX', { timeZone: timezone, month: 'short' }).format(new Date(a.startAt))}</span><strong>{new Intl.DateTimeFormat('es-MX', { timeZone: timezone, day: 'numeric' }).format(new Date(a.startAt))}</strong></div>
    <div className="patient-appointment-body">
      {featured ? <p className="patient-appointment-eyebrow">Tu próxima visita</p> : null}
      <span className={`patient-status ${statusChipClass(a.status)}`}>{statusLabel(a.status)}</span>
      <h3>{a.service?.name ?? 'Cita dental'}</h3>
      <time dateTime={a.startAt}>{formatDayLong(a.startAt, timezone)}<span>{formatTime(a.startAt, timezone)} – {formatTime(a.endAt, timezone)}</span></time>
      {fullName(a.dentistFirstName, a.dentistLastName) ? <p>Odontólogo: {fullName(a.dentistFirstName, a.dentistLastName)}</p> : null}
      <Link to={`/appointments/${a.id}`} className={featured ? 'patient-button patient-button-secondary' : 'patient-link'}>Ver mi cita</Link>
    </div>
  </article>;
}
