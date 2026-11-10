import type { AppointmentResponse } from '../../api/appointments';
import type { PublicScheduleDto } from '../../api/scheduling';
import { ClinicExceptionLabel } from '../appointments/AgendaAnnotations';
import { dayKey, formatDayLong, formatDayShort } from '../appointments/appointmentUi';
import { AgendaVisitList } from '../appointments/AgendaPresentation';
import './reception-operations.css';

/** Weekly register: seven full-width days, never seven narrow appointment columns. */
export function ReceptionWeekAgenda({ days, appointments, timezone, today, exceptions, onSelectDay, returnTo, onOpen, initialCount, title, selection, showAllDays = false }: {
  days: Date[]; appointments: AppointmentResponse[]; timezone: string; today: string;
  exceptions: PublicScheduleDto['exceptions']; onSelectDay: (day: Date) => void; returnTo?: string;
  onOpen?: (id: number) => void; initialCount?: number; title?: string;
  selection?: { date: string; onSelect: (day: Date) => void };
  showAllDays?: boolean;
}) {
  const entries = days.map(date => ({ date, key: dayKey(date), visits: appointments.filter(appointment => dayKey(new Date(appointment.startAt), timezone) === dayKey(date)) }));
  const selectedKey = entries.some(entry => entry.key === selection?.date) ? selection?.date : entries[0]?.key;
  const visibleEntries = selection && !showAllDays ? entries.filter(entry => entry.key === selectedKey) : entries;
  return <section aria-label="Agenda semanal" data-week-selection={selection ? 'true' : undefined} className={`reception-week-register${selection ? ' owner-selected-week owner-compact-visits' : ''}`}>
    <div className="reception-register-heading"><h2>{title ?? 'La semana por jornadas'}</h2><p>{appointments.length} {appointments.length === 1 ? 'cita en el período' : 'citas en el período'}</p></div>
    <nav aria-label="Días de esta semana" className="reception-week-index">{entries.map(({ date, key, visits }) => selection ? <button type="button" key={key}
      aria-label={`Ver ${visits.length} ${visits.length === 1 ? 'cita' : 'citas'} del ${formatDayLong(date.toISOString(), 'UTC')}`}
      aria-pressed={key === selectedKey} aria-current={key === today ? 'date' : undefined} aria-controls={showAllDays ? `reception-day-${key}` : 'owner-week-day-detail'} onClick={() => { selection.onSelect(date); if (showAllDays) document.getElementById(`reception-day-${key}`)?.scrollIntoView?.({ block: 'start' }); }}>
      <span>{date.toLocaleDateString('es-MX', { timeZone: 'UTC', weekday: 'short' })}</span><strong>{date.getUTCDate()}</strong><span>{visits.length} {visits.length === 1 ? 'cita' : 'citas'}</span>
    </button> : <a key={key}
      href={`#reception-day-${key}`} aria-current={key === today ? 'date' : undefined}>
      <span>{date.toLocaleDateString('es-MX', { timeZone: 'UTC', weekday: 'short' })}</span>
      <strong>{date.getUTCDate()}</strong><span>{visits.length} {visits.length === 1 ? 'cita' : 'citas'}</span>
    </a>)}</nav>
    {appointments.length === 0 ? <div className="reception-quiet-week"><h3>Una semana por organizar</h3><p>No hay citas en este período con los filtros actuales. Cambia de fecha o usa «Crear cita» para consultar horarios reales.</p></div> : null}
    <div className="reception-week-days">{visibleEntries.map(({ date, key, visits }) => <section key={key} id={selection && !showAllDays ? 'owner-week-day-detail' : `reception-day-${key}`}
      aria-label={formatDayLong(date.toISOString(), 'UTC')} className="reception-register-day" data-today={key === today ? 'true' : undefined}>
      <div className="reception-register-date">
        <button type="button" aria-label={`Ver día ${formatDayShort(date)}`} onClick={() => onSelectDay(date)}>
          <span>{date.toLocaleDateString('es-MX', { timeZone: 'UTC', weekday: 'long' })}</span>
          <strong>{date.getUTCDate()} <small>{date.toLocaleDateString('es-MX', { timeZone: 'UTC', month: 'short' })}</small></strong>
        </button>
        {key === today ? <span className="reception-today-marker">Hoy</span> : null}
        <ClinicExceptionLabel exception={exceptions.find(exception => exception.date === key)} />
      </div>
      {visits.length ? initialCount === undefined ? <AgendaVisitList appointments={visits} timezone={timezone} {...(returnTo ? { returnTo } : {})} />
        : <div><AgendaVisitList appointments={visits.slice(0, initialCount)} timezone={timezone} showDuration={Boolean(selection)} onOpen={onOpen} returnTo={returnTo} />
          {visits.length > initialCount ? <details><summary className="reception-link">Ver {visits.length - initialCount} más<span className="sr-only"> del {formatDayShort(date)}</span></summary>
            <AgendaVisitList appointments={visits.slice(initialCount)} timezone={timezone} showDuration={Boolean(selection)} onOpen={onOpen} returnTo={returnTo} /></details> : null}</div>
        : <p className="reception-register-empty">Sin citas registradas{key === today ? ' hoy' : ''}.</p>}
    </section>)}</div>
    <p className="reception-operation-caption reception-register-footnote">Se muestran las citas del período y los filtros elegidos. Un día sin citas no implica disponibilidad.</p>
  </section>;
}
