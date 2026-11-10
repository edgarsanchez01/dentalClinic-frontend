import { Fragment, type ReactNode } from 'react';
import type { AppointmentResponse } from '../../api/appointments';
import type { PublicScheduleDto } from '../../api/scheduling';
import { ClinicExceptionLabel } from '../appointments/AgendaAnnotations';
import { dayKey, formatDayLong, formatDayShort } from '../appointments/appointmentUi';

/** Original reception month cell; overview adds OWNER's local detail, not another calendar. */
export function ReceptionMonthCell({ date, appointments, onSelectDay, timeZone, clinicException, renderAppointment, overview }: {
  date: Date; appointments: AppointmentResponse[]; onSelectDay: () => void; timeZone: string;
  clinicException: PublicScheduleDto['exceptions'][number] | undefined;
  renderAppointment?: (appointment: AppointmentResponse) => ReactNode;
  overview?: { selected: boolean; today: boolean; onDetail: () => void };
}) {
  const dayAppts = appointments.filter(a => dayKey(new Date(a.startAt), timeZone) === dayKey(date));
  const exceptionLabel = clinicException ? clinicException.closed ? 'Clínica cerrada'
    : `Apertura especial: ${clinicException.startTime?.slice(0, 5)}–${clinicException.endTime?.slice(0, 5)}` : '';
  const countLabel = `${dayAppts.length} ${dayAppts.length === 1 ? 'cita' : 'citas'}`;
  if (overview) return <div className="min-h-[88px] rounded-xs bg-paper ring-1 ring-hairline owner-month-cell"
    data-today={overview.today || undefined} data-selected={overview.selected || undefined}>
    <button type="button" className="owner-month-select" onClick={overview.onDetail}
      aria-label={`Ver ${countLabel} del ${formatDayLong(date.toISOString(), 'UTC')}${exceptionLabel ? ` · ${exceptionLabel}` : ''}`}
      aria-pressed={overview.selected} aria-current={overview.today ? 'date' : undefined}
      aria-controls="owner-month-day-detail" title={exceptionLabel || undefined}>
      <span className="owner-month-date-row"><strong>{date.getUTCDate()}</strong>
        {overview.today ? <span>Hoy</span> : <span className="owner-month-weekday">{date.toLocaleDateString('es-MX', { timeZone: 'UTC', weekday: 'short' })}</span>}</span>
      <span className="owner-month-count">{dayAppts.length > 0 ? <span className="owner-month-dot" aria-hidden="true" /> : null}{countLabel}</span>
      {clinicException ? <span className="owner-month-exception">{clinicException.closed ? 'Cierre' : 'Especial'}</span> : null}
    </button>
  </div>;
  const extra = dayAppts.length - 3;
  return <div className="min-h-[88px] rounded-xs bg-paper p-1.5 ring-1 ring-hairline">
    <button type="button" onClick={onSelectDay} aria-label={`Ver día ${formatDayShort(date)}`}
      className="text-[length:var(--text-caption)] font-medium text-ink hover:underline">
      {date.getUTCDate()}
    </button>
    <ClinicExceptionLabel exception={clinicException} />
    <div className="mt-1 grid gap-0.5">
      {dayAppts.slice(0, 3).map(a => <Fragment key={a.id}>{renderAppointment?.(a)}</Fragment>)}
      {extra > 0 ? <button type="button" onClick={onSelectDay} className="min-h-11 text-[length:var(--text-caption)] text-primary-ink underline" aria-label={`Ver ${extra} citas más del ${formatDayShort(date)}`}>+{extra} más</button> : null}
    </div>
  </div>;
}
