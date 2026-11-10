import { useState, type ReactNode } from 'react';
import type { AppointmentResponse } from '../../api/appointments';
import type { PublicScheduleDto } from '../../api/scheduling';
import { ClinicExceptionLabel } from '../appointments/AgendaAnnotations';
import { dayKey, formatDayLong, formatDayShort, formatTime } from '../appointments/appointmentUi';
import { ReceptionVisit } from '../reception/ReceptionVisit';
import { sortAppointments } from '../appointments/appointmentUi';
import { AgendaMonthGrid, AgendaVisitList } from '../appointments/AgendaPresentation';
import { ReceptionDayAgenda } from '../reception/ReceptionDayAgenda';
import { ReceptionWeekAgenda } from '../reception/ReceptionWeekAgenda';
import { ReceptionMonthCell } from '../reception/ReceptionMonthCell';

type Visits = { appointments: AppointmentResponse[]; zone: string; onOpen: (id: number) => void };

function OwnerPreview({ appointments, zone, onOpen, count, returnTo, label = 'Vista previa de citas' }: Visits & { count: number; returnTo?: string; label?: string }) {
  return <AgendaVisitList appointments={sortAppointments(appointments).slice(0, count)} timezone={zone} {...(returnTo ? { returnTo } : { onOpen })} label={label} showDuration />;
}

export function OwnerDayAgenda({ appointments, zone, onOpen, scheduleLabel }: Visits & { scheduleLabel: string }) {
  return <ReceptionDayAgenda appointments={appointments} timezone={zone} onOpen={onOpen} clinicConfigured clinicOpen hasWindow
    context={<p className="reception-operation-caption">{scheduleLabel} Los espacios sin citas no indican disponibilidad.</p>}>
    {appointments.length ? <OwnerStartGroups appointments={appointments} zone={zone} onOpen={onOpen} initialCount={appointments.length} /> : null}
  </ReceptionDayAgenda>;
}

/** Group by actual instant, not clock label (DST may repeat a local time).
 * Interval overlap is presentation context only, never availability or a conflict. */
export function OwnerStartGroups({ appointments, zone, onOpen, initialCount = 6 }: Visits & { initialCount?: number }) {
  const groups: { start: number; visits: AppointmentResponse[]; overlap: boolean }[] = [];
  let previousEnd = -Infinity;
  for (const appointment of sortAppointments(appointments)) {
    const start = Date.parse(appointment.startAt), last = groups.at(-1);
    if (last?.start === start) last.visits.push(appointment);
    else groups.push({ start, visits: [appointment], overlap: previousEnd > start });
    previousEnd = Math.max(previousEnd, Date.parse(appointment.endAt));
  }
  let shown = 0;
  const boundary = groups.findIndex(group => {
    if (shown >= initialCount) return true;
    shown += group.visits.length;
    return false;
  });
  const first = boundary < 0 ? groups : groups.slice(0, boundary);
  const rest = boundary < 0 ? [] : groups.slice(boundary);
  const remaining = rest.reduce((total, group) => total + group.visits.length, 0);
  const labels = groups.map(group => formatTime(new Date(group.start).toISOString(), zone));
  const labelCounts = new Map<string, number>();
  for (const label of labels) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  const block = (group: typeof groups[number]) => {
    const startAt = new Date(group.start).toISOString(), label = formatTime(startAt, zone);
    const offset = (labelCounts.get(label) ?? 0) > 1 ? new Intl.DateTimeFormat('es-MX', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(new Date(group.start)).find(part => part.type === 'timeZoneName')?.value : undefined;
    return <li key={group.start} className="owner-start-block">
      <section className="reception-hour-group" aria-label={`Citas con inicio a las ${label}${offset ? ` ${offset}` : ''}`}>
        <h3><time dateTime={startAt}>{label}</time>{offset ? <small>{offset}</small> : null}</h3>
        <p className="reception-operation-caption">{group.visits.length} {group.visits.length === 1 ? 'cita' : 'citas · Mismo inicio'}</p>
        <div className="owner-start-content">
          <AgendaVisitList appointments={group.visits} timezone={zone} onOpen={onOpen} showDuration />
          {group.overlap ? <p className="reception-operation-caption">Coincidencia horaria con citas de un bloque anterior; no indica un conflicto ni disponibilidad.</p> : null}
        </div>
      </section>
    </li>;
  };
  return <div className="owner-start-groups">
    <ol aria-label="Bloques de inicio del día">{first.map(block)}</ol>
    {remaining ? <details className="owner-start-more"><summary className="reception-link">Ver {remaining} {remaining === 1 ? 'cita' : 'citas'} más</summary>
      <ol aria-label="Más bloques de inicio del día" start={first.length + 1}>{rest.map(block)}</ol></details> : null}
  </div>;
}

export function OwnerColumnComparison({ children }: { children: ReactNode }) {
  return <details className="owner-column-comparison"><summary className="reception-link">Comparar dentistas en columnas</summary>{children}</details>;
}

export function OwnerDayDetails({ appointments, zone, onOpen }: Visits) {
  return <details className="owner-day-details"><summary className="reception-link">Detalle completo de las citas del día · {appointments.length}</summary>
    <p className="reception-operation-caption">Incluye las citas breves y simultáneas de la cuadrícula, sin recortar nombres o servicios.</p>
    <ol className="reception-day-visits">{appointments.map(a => <li key={a.id}><ReceptionVisit appointment={a} timezone={zone} onOpen={onOpen} /></li>)}</ol>
  </details>;
}

export function OwnerWeekAgenda({ days, appointments, zone, today, date, exceptions, onOpen, onDay, onSelectDate, personal, returnTo }: Visits & {
  days: Date[]; today: string; exceptions: PublicScheduleDto['exceptions']; onDay: (day: Date) => void; personal: boolean; returnTo: string;
  date: string; onSelectDate: (day: Date) => void;
}) {
  return <ReceptionWeekAgenda days={days} appointments={appointments} timezone={zone} today={today} exceptions={exceptions}
    onSelectDay={onDay} selection={{ date, onSelect: onSelectDate }} showAllDays initialCount={appointments.length}
    {...(personal ? { onOpen } : { returnTo })} />;
}

export function OwnerMonthCalendar({ days, appointments, zone, today, date, exceptions, onOpen, onDay, onSelectDate }: Visits & {
  days: Date[]; today: string; date: string; exceptions: PublicScheduleDto['exceptions']; onDay: (day: Date) => void; personal: boolean;
  onSelectDate?: (day: Date) => void;
}) {
  const [localSelected, setSelected] = useState(date);
  const lead = (days[0].getUTCDay() + 6) % 7;
  const cells: (Date | null)[] = [...Array.from({ length: lead }, () => null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const selectedDay = days.find(d => dayKey(d) === (onSelectDate ? date : localSelected)) ?? days[0];
  const entries = days.map(day => ({ day, key: dayKey(day), visits: sortAppointments(appointments.filter(a => dayKey(new Date(a.startAt), zone) === dayKey(day))) }));
  const selectedVisits = entries.find(entry => entry.key === dayKey(selectedDay))?.visits ?? [];
  return <section className="owner-month min-w-0" aria-label="Agenda mensual">
    <div className="reception-register-heading"><h2>El mes, de un vistazo</h2><span className="reception-operation-caption">{appointments.length} citas en el período</span></div>
    <p className="reception-operation-caption">Selecciona una fecha para consultar su agenda. Los conteos no indican disponibilidad.</p>
    <AgendaMonthGrid>{weeks.flat().map((d, index) => {
      if (!d) return <div className="owner-month-blank" key={`blank-${index}`} aria-hidden="true" />;
      const key = dayKey(d);
      return <div key={key} className="appointment-month-overview"><ReceptionMonthCell date={d} appointments={appointments} timeZone={zone} clinicException={exceptions.find(e => e.date === key)} onSelectDay={() => onDay(d)}
        overview={{ selected: key === dayKey(selectedDay), today: key === today, onDetail: () => onSelectDate ? onSelectDate(d) : setSelected(key) }} /></div>;
    })}</AgendaMonthGrid>
    <aside role="region" id="owner-month-day-detail" className="reception-register-day appointment-day-detail" data-today={dayKey(selectedDay) === today ? 'true' : undefined} aria-label="Citas del día seleccionado">
      <header className="reception-register-date"><h3 className="sr-only">{formatDayLong(selectedDay.toISOString(), 'UTC')}</h3>
        <button type="button" aria-label={`Ver día ${formatDayShort(selectedDay)}`} onClick={() => onDay(selectedDay)}><span>{selectedDay.toLocaleDateString('es-MX', { timeZone: 'UTC', weekday: 'long' })}</span><strong>{selectedDay.getUTCDate()} <small>{selectedDay.toLocaleDateString('es-MX', { timeZone: 'UTC', month: 'short' })}</small></strong></button>
        <ClinicExceptionLabel exception={exceptions.find(e => e.date === dayKey(selectedDay))} />
      </header>
      <div>
        <p className="reception-operation-caption" role="status" aria-live="polite" aria-atomic="true"><span className="sr-only">{formatDayLong(selectedDay.toISOString(), 'UTC')} · </span>{selectedVisits.length} {selectedVisits.length === 1 ? 'cita' : 'citas'} con los filtros actuales · Hora de la clínica</p>
        <button type="button" className="reception-link" onClick={() => onDay(selectedDay)}>Ver agenda completa · {selectedVisits.length} {selectedVisits.length === 1 ? 'cita' : 'citas'}</button>
      <div className="owner-month-agenda-list">
        {selectedVisits.length ? <OwnerPreview appointments={selectedVisits} zone={zone} onOpen={onOpen} count={selectedVisits.length} label="Citas del día" /> : <p className="owner-month-empty">No hay citas para esta fecha</p>}
      </div>
      </div>
    </aside>
  </section>;
}
