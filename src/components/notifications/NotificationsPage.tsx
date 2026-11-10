import { useRef, useState } from 'react';
import type { NotificationDto } from '../../api/notifications';
import { useAuthStore } from '../../app/authStore';
import { FormAlert } from '../auth/ui';
import { PatientNotifications } from '../patient/PatientNotifications';
import { ReceptionEmptyState, ReceptionPage, ReceptionPageHeader } from '../reception/ReceptionUI';
import { useMarkNotificationRead, useNotifications } from './notificationQueries';
import { NotificationContent } from './NotificationContent';

const dateFormat = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function NotificationsPage() {
  const patient = useAuthStore(state => state.user?.role === 'PATIENT');
  return patient ? <PatientNotifications /> : <div className="clinical-editorial"><StaffNotificationsPage /></div>;
}

function StaffNotificationsPage() {
  const [requestedPage, setRequestedPage] = useState(0);
  const query = useNotifications({ page: requestedPage, size: 20 });
  const mark = useMarkNotificationRead();
  const marking = useRef(false);
  const data = query.data;
  const currentPage = data?.page ?? requestedPage;
  const busy = query.isFetching || mark.isPending;
  const emptyInbox = data?.content.length === 0 && data.totalElements === 0 && currentPage === 0;

  function markRead(id: number) {
    if (marking.current) return;
    marking.current = true;
    mark.mutate(id, { onSettled: () => { marking.current = false; } });
  }

  return (
    <ReceptionPage>
      <ReceptionPageHeader
        title="Notificaciones"
        intro="Consulta tus avisos y marca como leídos los que ya revisaste."
      />

      {query.isLoading ? <p role="status" className="reception-readonly-note">Cargando notificaciones…</p> : null}
      {query.isFetching && data ? <p role="status" className="reception-readonly-note">Actualizando notificaciones…</p> : null}
      {mark.isPending ? <p role="status" className="reception-readonly-note">Marcando notificación como leída…</p> : null}
      {mark.isSuccess ? <p role="status" className="reception-readonly-note" style={{ color: 'var(--auth-petrol)' }}>Notificación marcada como leída.</p> : null}
      {query.isError ? (
        <FormAlert>
          {data ? 'No se pudieron actualizar las notificaciones. Se muestran los últimos datos disponibles.' : 'No se pudieron cargar las notificaciones.'}
          {' '}
          <button type="button" className="reception-link" disabled={query.isFetching} onClick={() => { void query.refetch(); }}>Reintentar</button>
        </FormAlert>
      ) : null}

      {data?.content.length === 0 ? (
        <ReceptionEmptyState
          title={emptyInbox ? 'Tu buzón está vacío.' : 'Esta página no tiene notificaciones.'}
          action={currentPage > 0 ? <button type="button" className="reception-link" onClick={() => setRequestedPage(currentPage - 1)}>Volver a la página anterior</button> : undefined}
        >
          {currentPage > 0 ? 'Puedes volver a la página anterior.' : 'Aquí aparecerán los avisos que recibas.'}
        </ReceptionEmptyState>
      ) : null}

      {data && data.content.length > 0 ? (
        <ul aria-label="Listado de notificaciones" className="reception-notifications" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {data.content.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              disabled={mark.isPending}
              pending={mark.isPending && mark.variables === notification.id}
              error={mark.isError && mark.variables === notification.id
                ? mark.error instanceof Error ? mark.error.message : 'No se pudo marcar como leída. Vuelve a intentarlo.'
                : null}
              onMark={() => markRead(notification.id)}
            />
          ))}
        </ul>
      ) : null}

      <nav aria-label="Paginación de notificaciones" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <button type="button" className="reception-button reception-button-secondary" disabled={busy || currentPage === 0} onClick={() => setRequestedPage(currentPage - 1)}>Anterior</button>
        <p role="status" style={{ color: 'var(--auth-muted)' }}>
          {data ? data.totalPages > 0 && currentPage < data.totalPages
            ? `Página ${currentPage + 1} de ${data.totalPages}`
            : `Página ${currentPage + 1} · Sin resultados`
            : `Página ${currentPage + 1}`}
        </p>
        <button type="button" className="reception-button reception-button-secondary" disabled={busy || !data || currentPage + 1 >= data.totalPages} onClick={() => setRequestedPage(currentPage + 1)}>Siguiente</button>
      </nav>
    </ReceptionPage>
  );
}

function NotificationItem({ notification, disabled, pending, error, onMark }: {
  notification: NotificationDto;
  disabled: boolean;
  pending: boolean;
  error: string | null;
  onMark: () => void;
}) {
  return (
    <li>
      <NotificationContent notification={notification} headingLevel={2}
        recipe={{ article: 'reception-notification', unread: 'reception-notification-unread', heading: 'reception-section-heading', labels: 'reception-notification-labels', footer: 'reception-notification-footer' }}
        date={{ dateTime: notification.createdAt, text: `${dateFormat.format(new Date(notification.createdAt))} UTC` }}
        actions={!notification.read ? (
            <button type="button" className="reception-link" disabled={disabled} onClick={onMark}>
              {pending ? 'Marcando como leída…' : 'Marcar como leída'}
            </button>
          ) : null}
        feedback={error ? <div style={{ marginTop: 12 }}><FormAlert>{error} Puedes reintentar el marcado.</FormAlert></div> : null} />
    </li>
  );
}
