import type { AppointmentEventView } from '../../api/appointments';
import { FormAlert } from '../auth/ui';
import { apiErrorMessage, EVENT_LABELS, formatDayLong, formatTime } from './appointmentUi';

/** Historial de solo lectura. El caller conserva la query y su ciclo de vida. */
export function AppointmentEvents({ events, loading, error, timeZone, owner = false }: {
  events: AppointmentEventView[] | undefined; loading: boolean; error: unknown; timeZone: string; owner?: boolean;
}) {
  const content = <>
    {loading ? <p role="status" className={owner ? 'appointment-detail-muted' : 'mt-2 text-[length:var(--text-body-sm)] text-ink-muted'}>Cargando eventos…</p> : null}
    {error ? <FormAlert>{apiErrorMessage(error, 'No se pudieron cargar los eventos de la cita.')}</FormAlert> : null}
    {!loading && !error && events && events.length === 0 ? <p className={owner ? 'appointment-detail-muted' : 'mt-2 text-ink-secondary'}>Sin eventos.</p> : null}
    {events && events.length > 0 ? <ul className={owner ? 'appointment-detail-events' : 'mt-2 grid gap-1'}>{events.map(e =>
      <li key={e.id} className={owner ? undefined : 'text-[length:var(--text-body-sm)] text-ink-secondary'}>{EVENT_LABELS[e.eventType]} · {formatDayLong(e.createdAt, timeZone)} {formatTime(e.createdAt, timeZone)}</li>)}</ul> : null}
  </>;
  return owner ? <section className="reception-section">
    <div className="reception-section-heading"><div><h2>Historial y eventos</h2><p>Trazabilidad de la cita.</p></div></div>
    <div className="appointment-detail-stack">{content}</div>
  </section> : <section className="mt-6 rounded-card bg-paper p-5 ring-1 ring-hairline">
    <h2 className="text-[length:var(--text-h5)] text-ink">Eventos</h2>{content}
  </section>;
}
