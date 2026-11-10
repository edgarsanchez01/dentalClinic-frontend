import type { AppointmentResponse } from '../../api/appointments';
import type { ReactNode } from 'react';
import { schedulingApi, type PublicScheduleDto, type ScheduleDayDto } from '../../api/scheduling';
import { useQuery } from '@tanstack/react-query';
import { dayKey, formatTime, isoWeekDay, statusLabel } from '../appointments/appointmentUi';
import { ReceptionVisit } from '../reception/ReceptionVisit';
import { ReceptionDayAgenda } from '../reception/ReceptionDayAgenda';
import { ReceptionWeekAgenda } from '../reception/ReceptionWeekAgenda';
import { StaffMonthBoard } from '../appointments/AppointmentSummary';

function Visit({ appointment: a, zone, onOpen }: {
  appointment: AppointmentResponse; zone: string; onOpen: (id: number) => void;
}) {
  const name = `${a.patientFirstName} ${a.patientLastName}`;
  const time = `${formatTime(a.startAt, zone)}–${formatTime(a.endAt, zone)}`;
  return <ReceptionVisit appointment={a} timezone={zone} onOpen={onOpen} serviceFallback="Sin servicio asociado"
    title={`${name} · ${time} · ${a.service?.name ?? 'Sin servicio asociado'}`}
    ariaLabel={`Abrir cita de ${name}, ${time} · ${statusLabel(a.status)} · ${a.service?.name ?? 'Sin servicio asociado'} · ${a.dentistFirstName} ${a.dentistLastName}`} />;
}

/** Chronological rows never overlap; blank space does not claim bookable availability. */
export function DentistDayAgenda({ appointments, zone, scheduleLabel, onOpen, dentistId, date, breaks, children }: {
  appointments: AppointmentResponse[]; zone: string; scheduleLabel: string; onOpen: (id: number) => void;
  dentistId: number; date: Date; breaks: ScheduleDayDto['breaks'];
  children?: ReactNode;
}) {
  return <ReceptionDayAgenda appointments={appointments} timezone={zone} onOpen={onOpen} clinicConfigured clinicOpen hasWindow
    context={<><p className="reception-operation-caption">{scheduleLabel} Los espacios sin citas no indican disponibilidad.</p><ScheduleContext dentistId={dentistId} date={date} breaks={breaks} /></>}
    renderAppointment={a => <Visit appointment={a} zone={zone} onOpen={onOpen} />} >{children}</ReceptionDayAgenda>;
}

function ScheduleContext({ dentistId, date, breaks }: { dentistId: number; date: Date; breaks: ScheduleDayDto['breaks'] }) {
  const query = useQuery({ queryKey: ['agenda-context', dentistId], queryFn: async () => {
    const [week, exceptions, timeOff] = await Promise.all([schedulingApi.getDentistSchedule(dentistId), schedulingApi.listDentistExceptions(dentistId), schedulingApi.listTimeOff(dentistId)]);
    return { week, exceptions, timeOff };
  } });
  const weekly = query.data?.week.days.find(d => d.dayOfWeek === isoWeekDay(date));
  const exception = query.data?.exceptions.find(e => e.date === dayKey(date));
  const off = query.data?.timeOff.filter(e => e.startDate <= dayKey(date) && e.endDate >= dayKey(date)) ?? [];
  return <details className="dc-schedule-context"><summary>Horario y pausas de la jornada</summary>
    {query.isPending ? <p role="status">Consultando tu horario…</p> : query.isError ? <p role="alert">No se pudo consultar tu horario. <button type="button" className="dc-link" onClick={() => void query.refetch()}>Reintentar horario</button></p> : <ul>
      <li>{exception?.closed ? 'Cierre del odontólogo' : exception ? `Horario especial: ${exception.startTime?.slice(0, 5)}–${exception.endTime?.slice(0, 5)}` : weekly?.open ? `Tu horario: ${weekly.startTime?.slice(0, 5)}–${weekly.endTime?.slice(0, 5)}` : 'Sin horario profesional abierto para este día.'}</li>
      {breaks.map((b, i) => <li key={`clinic-${i}`}>Descanso de clínica: {b.startTime.slice(0, 5)}–{b.endTime.slice(0, 5)}</li>)}
      {weekly?.breaks.map((b, i) => <li key={`dentist-${i}`}>Descanso del odontólogo: {b.startTime.slice(0, 5)}–{b.endTime.slice(0, 5)}</li>)}
      {off.map(o => <li key={o.id}>Ausencia: {o.allDay ? 'todo el día' : `${o.startTime?.slice(0, 5)}–${o.endTime?.slice(0, 5)}`}</li>)}
    </ul>}
  </details>;
}

export function DentistCalendar({ mode, days, appointments, zone, today, exceptions, onOpen, onDay, title }: {
  mode: 'week' | 'month'; days: Date[]; appointments: AppointmentResponse[]; zone: string; today: string;
  exceptions: PublicScheduleDto['exceptions']; onOpen: (id: number) => void; onDay: (date: Date) => void;
  title?: string;
}) {
  return mode === 'week' ? <ReceptionWeekAgenda days={days} appointments={appointments} timezone={zone} today={today} exceptions={exceptions} onSelectDay={onDay} onOpen={onOpen} initialCount={appointments.length} {...(title ? { title } : {})} />
    : <section className="min-w-0" aria-label="Agenda mensual"><StaffMonthBoard days={days} appointments={appointments} timeZone={zone} exceptions={exceptions} onOpen={onOpen} onOpenDay={onDay} isReception /></section>;
}
