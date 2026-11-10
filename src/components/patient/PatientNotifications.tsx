import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { NotificationDto } from '../../api/notifications';
import { formatDayLong, formatTime } from '../appointments/appointmentUi';
import { useMarkNotificationRead, useNotifications } from '../notifications/notificationQueries';
import { PatientEmptyState, PatientPageHeader, PatientQueryState } from './PatientUI';
import { usePatientZone } from './patientQueries';
import { NotificationContent } from '../notifications/NotificationContent';

export function PatientNotificationContent({ notification: n, timezone, preview = false, children }: {
  notification: NotificationDto; timezone: string | undefined; preview?: boolean; children?: React.ReactNode;
}) {
  return <NotificationContent notification={n} headingLevel={3} variant={preview ? 'preview' : 'inbox'} actions={children}
    recipe={{ article: 'patient-notification', unread: 'patient-notification-unread', heading: 'patient-section-heading', labels: 'patient-notification-labels', priority: 'patient-priority', footer: 'patient-notification-footer', preview: 'patient-preview' }}
    date={timezone && Number.isFinite(Date.parse(n.createdAt))
      ? { dateTime: n.createdAt, text: `${formatDayLong(n.createdAt, timezone)} · ${formatTime(n.createdAt, timezone)}` }
      : { text: 'Fecha local no disponible' }} />;
}

export function PatientNotifications() {
  const [page, setPage] = useState(0);
  const query = useNotifications({ page, size: 20 });
  const zone = usePatientZone();
  const mark = useMarkNotificationRead();
  const lock = useRef(false);
  const current = query.data?.page ?? page;
  return <div className="patient-page">
    <PatientPageHeader title="Notificaciones" intro="Los avisos de tu atención, en un solo lugar." />
    {query.isFetching && query.data ? <p role="status">Actualizando notificaciones…</p> : null}
    {mark.isPending ? <p role="status">Marcando notificación como leída…</p> : null}
    {zone.isError ? <div className="patient-error" role="alert">No se pudo consultar la hora de la clínica. Puedes leer tus avisos.<button className="patient-link" onClick={() => void zone.refetch()}>Reintentar fecha local</button></div> : null}
    <PatientQueryState query={{ ...query, isError: query.isError && !query.data }} label="notificaciones">
      {query.isError && query.data ? <div role="alert" className="patient-error">No se pudieron actualizar las notificaciones. Se muestran los últimos datos disponibles.<button className="patient-link" onClick={() => void query.refetch()}>Reintentar</button></div> : null}
      {query.data?.content.length ? <ul aria-label="Listado de notificaciones" className="patient-notifications">{query.data.content.map(n => <li key={n.id}>
        <PatientNotificationContent notification={n} timezone={zone.isError ? undefined : zone.data?.timezone}>
          {!n.read ? <button className="patient-link" disabled={mark.isPending} onClick={() => {
            if (lock.current) return;
            lock.current = true;
            mark.mutate(n.id, { onSettled: () => { lock.current = false; } });
          }}>{mark.isPending && mark.variables === n.id ? 'Marcando como leída…' : 'Marcar como leída'}</button> : null}
        </PatientNotificationContent>
        {mark.isError && mark.variables === n.id ? <p className="patient-error" role="alert">{mark.error.message || 'No se pudo marcar como leída. Vuelve a intentarlo.'}</p> : null}
      </li>)}</ul> : <PatientEmptyState title={current ? 'Esta página no tiene notificaciones.' : 'Tu buzón está vacío.'} action={<Link className="patient-link" to="/">Volver al inicio</Link>}>{current ? 'Vuelve a la página anterior para consultar tus avisos.' : 'Aquí aparecerán las notificaciones que recibas de la clínica.'}</PatientEmptyState>}
    </PatientQueryState>
    {mark.isSuccess ? <p role="status" className="patient-success">Notificación marcada como leída.</p> : null}
    <nav aria-label="Paginación de notificaciones" className="patient-pagination"><button className="patient-button patient-button-secondary" disabled={current === 0 || query.isFetching || mark.isPending} onClick={() => setPage(current - 1)}>Anterior</button><span role="status">Página {current + 1}{query.data?.totalPages ? ` de ${query.data.totalPages}` : query.data ? ' · Sin resultados' : ''}</span><button className="patient-button patient-button-secondary" disabled={query.isFetching || mark.isPending || query.isError || !query.data || current + 1 >= query.data.totalPages} onClick={() => setPage(current + 1)}>Siguiente</button></nav>
  </div>;
}
