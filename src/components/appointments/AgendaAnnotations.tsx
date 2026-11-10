import { useQuery } from '@tanstack/react-query';

import { schedulingApi, type PublicScheduleDto, type ScheduleDayDto } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { clockLabel, dayKey, isoWeekDay, parseClock } from './appointmentUi';

export function ClinicExceptionLabel({ exception }: { exception: PublicScheduleDto['exceptions'][number] | undefined }) {
  if (!exception) return null;
  return <p className="mt-1 text-[length:var(--text-caption)] text-ink-secondary">
    {exception.closed ? 'Clínica cerrada' : `Apertura especial: ${exception.startTime?.slice(0, 5)}–${exception.endTime?.slice(0, 5)}`}
  </p>;
}

/** Read-only context. These bands never generate, subtract or authorize bookable slots. */
export function AgendaAnnotations({ dentistId, day, clinicDay, windowStart, windowEnd, pxPerMinute }: {
  dentistId: number; day: Date; clinicDay: {
    startTime?: string | null | undefined; endTime?: string | null | undefined; breaks: ScheduleDayDto['breaks'];
  };
  windowStart: number; windowEnd: number; pxPerMinute: number;
}) {
  const user = useAuthStore((state) => state.user);
  const canRead = user?.role === 'OWNER' || user?.role === 'RECEPTIONIST'
    || (user?.role === 'DENTIST' && user.dentistId === dentistId);
  const query = useQuery({
    queryKey: ['agenda-context', dentistId],
    queryFn: async () => {
      const [week, exceptions, timeOff] = await Promise.all([
        schedulingApi.getDentistSchedule(dentistId),
        schedulingApi.listDentistExceptions(dentistId),
        schedulingApi.listTimeOff(dentistId),
      ]);
      return { week, exceptions, timeOff };
    },
    enabled: canRead,
  });
  const context = canRead && query.isSuccess ? query.data : undefined;
  const date = dayKey(day);
  const bands: Array<{ label: string; start: number; end: number }> = [];
  const band = (label: string, start: number, end: number) => {
    // Clip annotation geometry to the displayed axis, not the availability response.
    const clippedStart = Math.max(start, windowStart);
    const clippedEnd = Math.min(end, windowEnd);
    if (clippedEnd > clippedStart) bands.push({ label, start: clippedStart, end: clippedEnd });
  };
  const breaks = (entries: ScheduleDayDto['breaks'], label: string) => {
    for (const entry of entries) band(`${label}: ${entry.startTime.slice(0, 5)}–${entry.endTime.slice(0, 5)}`,
      parseClock(entry.startTime), parseClock(entry.endTime));
  };
  if (clinicDay.startTime && clinicDay.endTime) {
    band('Fuera de horario de clínica', windowStart, parseClock(clinicDay.startTime));
    band('Fuera de horario de clínica', parseClock(clinicDay.endTime), windowEnd);
  }
  breaks(clinicDay.breaks, 'Descanso de clínica');
  if (context) {
    const weekday = context.week.days.find((entry) => entry.dayOfWeek === isoWeekDay(day));
    const exception = context.exceptions.find((entry) => entry.date === date);
    const dentistDay = exception ? { ...exception, open: !exception.closed } : weekday;
    if (!dentistDay?.open) band(exception?.closed ? 'Cierre del odontólogo' : 'Fuera de horario del odontólogo', windowStart, windowEnd);
    else if (dentistDay.startTime && dentistDay.endTime) {
      band('Fuera de horario del odontólogo', windowStart, parseClock(dentistDay.startTime));
      band('Fuera de horario del odontólogo', parseClock(dentistDay.endTime), windowEnd);
    }
    // Weekly breaks still apply on exception dates (AvailabilityService.freeSegmentsForDate).
    breaks(weekday?.breaks ?? [], 'Descanso del odontólogo');
    for (const off of context.timeOff) {
      if (off.startDate > date || off.endDate < date) continue;
      if (off.allDay) band('Ausencia (todo el día)', windowStart, windowEnd);
      else if (off.startTime && off.endTime) band(`Ausencia: ${off.startTime.slice(0, 5)}–${off.endTime.slice(0, 5)}`,
        parseClock(off.startTime), parseClock(off.endTime));
    }
  }
  const groups = new Map<string, { start: number; end: number; labels: string[] }>();
  for (const entry of bands) {
    const key = `${entry.start}-${entry.end}`;
    const group = groups.get(key) ?? { start: entry.start, end: entry.end, labels: [] };
    group.labels.push(entry.label);
    groups.set(key, group);
  }
  return <>
    {[...groups.values()].map((entry) => (
      <div
        key={`${entry.start}-${entry.end}`}
        role="note"
        aria-label={entry.labels.join('; ')}
        className="pointer-events-none absolute inset-x-0 bg-sunken text-[length:var(--text-caption)] text-ink-secondary ring-1 ring-hairline"
        style={{
          top: (entry.start - windowStart) * pxPerMinute,
          height: (entry.end - entry.start) * pxPerMinute,
          backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 7px, var(--color-hairline) 7px, var(--color-hairline) 8px)',
        }}
      >
        <div className="absolute inset-x-1 bottom-1 grid bg-sunken px-1">
          {entry.labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
        </div>
      </div>
    ))}
    {canRead && (query.isPending || query.isError) ? (
      <p role="status" aria-label="Contexto horario" className="absolute inset-x-1 bottom-1 text-[length:var(--text-caption)] text-ink-muted">
        {query.isError ? 'No se pudo consultar el contexto horario.' : 'Cargando contexto horario…'}
      </p>
    ) : null}
    <span className="sr-only">Las franjas informativas no son reservables. Eje: {clockLabel(windowStart)}–{clockLabel(windowEnd)}.</span>
  </>;
}
