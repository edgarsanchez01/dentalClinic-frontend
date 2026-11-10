import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppointmentResponse } from '../../api/appointments';
import { useAuthStore } from '../../app/authStore';
import { formatDayLong, formatTime, fromLocalDateInput, localDateInput, rangeForView } from '../appointments/appointmentUi';
import { careScope } from '../dashboard/careDashboardData';
import { useCareAppointments } from '../dashboard/careDashboardQueries';
import { PatientQueryState } from './PatientUI';

const WEEKDAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function monthLabel(day: Date): string {
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(day);
}

function shiftMonth(month: Date, delta: number): Date {
  return new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1));
}

/**
 * Mini-agenda personal del paciente (UX-04A). Reutiliza `useCareAppointments` con el
 * mismo alcance forzado por servidor: nunca deduce identidad ni pide datos de otro paciente.
 * El mes se calcula en la zona de la clínica para no mostrar fechas con otro huso.
 */
export function PatientMiniAgenda({ timezone, now }: { timezone: string; now: number }) {
  const user = useAuthStore(state => state.user);
  const scope = careScope(user);
  const today = useMemo(() => fromLocalDateInput(localDateInput(new Date(now), timezone)), [now, timezone]);
  const [cursor, setCursor] = useState<Date>(today);
  const [selected, setSelected] = useState(() => localDateInput(today));
  const range = useMemo(() => rangeForView('month', cursor, timezone), [cursor, timezone]);
  const query = useCareAppointments(scope, {
    from: range.from.toISOString(), to: range.to.toISOString(), status: 'SCHEDULED', page: 0, size: 100,
  }, true);

  const byDay = useMemo(() => {
    const groups = new Map<string, AppointmentResponse[]>();
    for (const appointment of query.data?.content ?? []) {
      const key = localDateInput(new Date(appointment.startAt), timezone);
      const list = groups.get(key);
      if (list) list.push(appointment);
      else groups.set(key, [appointment]);
    }
    return groups;
  }, [query.data, timezone]);

  const first = range.days[0]!;
  const offset = (first.getUTCDay() + 6) % 7;
  const selectedAppointments = byDay.get(selected) ?? [];
  const label = monthLabel(first);

  return <section aria-label="Mi agenda" className="patient-section patient-agenda-section">
    <div className="patient-section-heading"><h2>Mi agenda</h2><Link className="patient-link" to="/appointments?create=1">Buscar un horario</Link></div>
    <p className="patient-muted">Tus días con citas, de un vistazo. Elige un día para ver el detalle.</p>
    <div className="patient-agenda">
      <PatientQueryState query={query} label="tu agenda">
        <div className="patient-agenda-grid">
          <div className="patient-agenda-calendar">
            <div className="patient-agenda-heading">
              <button type="button" aria-label="Mes anterior" onClick={() => setCursor(current => shiftMonth(current, -1))}>Anterior</button>
              <h3 aria-live="polite">{label}</h3>
              <button type="button" aria-label="Mes siguiente" onClick={() => setCursor(current => shiftMonth(current, 1))}>Siguiente</button>
            </div>
            <div className="patient-agenda-weekdays" aria-hidden="true">{WEEKDAY_LABELS.map((weekday, index) => <span key={index}>{weekday}</span>)}</div>
            <div role="group" aria-label={`Días de ${label}`} className="patient-agenda-days">
              {Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} aria-hidden="true" />)}
              {range.days.map(day => {
                const key = localDateInput(day);
                const count = byDay.get(key)?.length ?? 0;
                return <button type="button" key={key} aria-pressed={key === selected}
                  className={`patient-agenda-day${count > 0 ? ' is-flagged' : ''}`}
                  aria-label={`${formatDayLong(`${key}T12:00:00Z`, 'UTC')}${count > 0 ? `, ${count} ${count === 1 ? 'cita programada' : 'citas programadas'}` : ', sin citas'}`}
                  onClick={() => setSelected(key)}><span aria-hidden="true">{day.getUTCDate()}</span></button>;
              })}
            </div>
          </div>
          <div className="patient-agenda-detail">
            <h3>{formatDayLong(`${selected}T12:00:00Z`, 'UTC')}</h3>
            {selectedAppointments.length ? <ul className="patient-agenda-list">{selectedAppointments.map(appointment =>
              <li key={appointment.id} className="patient-agenda-item">
                <time dateTime={appointment.startAt}>{formatTime(appointment.startAt, timezone)}</time>
                <span aria-hidden="true">·</span>
                <strong>{appointment.service?.name ?? 'Cita dental'}</strong>
              </li>)}</ul>
              : <p className="patient-muted">No tienes citas programadas este día.</p>}
          </div>
        </div>
      </PatientQueryState>
    </div>
    <div className="patient-agenda-actions"><Link className="patient-link" to="/appointments">Ver todas mis citas</Link></div>
  </section>;
}
