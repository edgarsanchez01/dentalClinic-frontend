import type { UseQueryResult } from '@tanstack/react-query';

import type { AppointmentResponse } from '../../api/appointments';
import type { AvailabilityDto, AvailabilitySlotDto, PublicScheduleDto, ScheduleDayDto } from '../../api/scheduling';
import { FormAlert } from '../auth/ui';
import { ownerDayLanes } from '../owner/ownerAgendaLayout';
import { ReceptionCalendarEvent } from '../reception/ReceptionCalendarEvent';
import { ReceptionMonthCell } from '../reception/ReceptionMonthCell';
import { AgendaAnnotations, ClinicExceptionLabel } from './AgendaAnnotations';
import { AgendaMonthGrid } from './AgendaPresentation';
import {
  apiErrorMessage,
  clockLabel,
  dayKey,
  formatDayLong,
  formatDayShort,
  formatTime,
  fullName,
  isoWeekDay,
  minutesOfDay,
  parseClock,
  statusChipClass,
  statusLabel,
} from './appointmentUi';

/** Resumen de cita reutilizado por agendas; conserva el DOM/clases de cada variante. */
export function AppointmentSummary({
  appointment,
  onOpen,
  timeZone,
  operational = false,
  ownerGrid = false,
}: {
  appointment: AppointmentResponse;
  onOpen: (id: number) => void;
  timeZone: string;
  operational?: boolean;
  ownerGrid?: boolean;
}) {
  const start = formatTime(appointment.startAt, timeZone);
  const name = `${appointment.patientFirstName} ${appointment.patientLastName}`.trim();
  if (operational) return <ReceptionCalendarEvent appointment={appointment} timeZone={timeZone} onOpen={onOpen} temporal={ownerGrid} />;
  return (
    <button
      type="button"
      title={statusLabel(appointment.status)}
      aria-label={`Cita con ${name} a las ${start} ${statusLabel(appointment.status)}`}
      onClick={() => onOpen(appointment.id)}
      className={`block w-full rounded-xs px-2 py-1 text-left text-[length:var(--text-body-sm)] ${statusChipClass(
        appointment.status,
      )} focus-visible:ring-2 focus-visible:ring-primary`}
    >
      <span className="block truncate">
        {start} · {appointment.patientFirstName} {appointment.patientLastName}
      </span>
      <span className="block text-[length:var(--text-caption)]">{fullName(appointment.dentistFirstName, appointment.dentistLastName)} · {statusLabel(appointment.status)}</span>
    </button>
  );
}

/** Lista diaria PATIENT: mantiene sus tarjetas y su selección por día. */
export function PatientDayGroups({
  days,
  appointments,
  timeZone,
  onOpen,
}: {
  days: Date[];
  appointments: AppointmentResponse[];
  timeZone: string;
  onOpen: (id: number) => void;
}) {
  return (
    <div className="grid gap-4">
      {days.map((d) => {
        const dayAppts = appointments.filter((a) => dayKey(new Date(a.startAt), timeZone) === dayKey(d));
        if (dayAppts.length === 0) return null;
        return (
          <section key={dayKey(d)} className="rounded-card bg-paper p-4 ring-1 ring-hairline">
            <h2 className="text-[length:var(--text-h5)] capitalize text-ink">{formatDayLong(d.toISOString(), 'UTC')}</h2>
            <ul className="mt-2 grid gap-1">
              {dayAppts.map((a) => (
                <li key={a.id}>
                  <AppointmentSummary appointment={a} onOpen={onOpen} timeZone={timeZone} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Panel de citas existentes fuera del horario configurado. */
export function ExistingAppointmentsPanel({
  appointments,
  timeZone,
  onOpen,
  operational,
}: {
  appointments: AppointmentResponse[];
  timeZone: string;
  onOpen: (id: number) => void;
  operational: boolean;
}) {
  return (
    <section className="rounded-card bg-paper p-4 ring-1 ring-hairline">
      <h2 className="text-[length:var(--text-h5)] text-ink">Citas existentes</h2>
      <ul className="mt-3 grid gap-2">
        {appointments.map((appointment) => <li key={appointment.id}>
          <AppointmentSummary appointment={appointment} onOpen={onOpen} timeZone={timeZone} operational={operational} />
        </li>)}
      </ul>
    </section>
  );
}

/** Semana de personal no operativo; conserva siete columnas y sus enlaces. */
export function StaffWeekBoard({
  days,
  appointments,
  timeZone,
  exceptions,
  onOpen,
  onOpenDay,
}: {
  days: Date[];
  appointments: AppointmentResponse[];
  timeZone: string;
  exceptions: PublicScheduleDto['exceptions'];
  onOpen: (id: number) => void;
  onOpenDay: (day: Date) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[700px] grid-cols-7 gap-2">
        {days.map((d) => {
          const dayAppts = appointments.filter((a) => dayKey(new Date(a.startAt), timeZone) === dayKey(d));
          return (
            <div key={dayKey(d)} className="rounded-card bg-paper p-2 ring-1 ring-hairline">
              <button
                type="button"
                onClick={() => onOpenDay(d)}
                aria-label={`Ver día ${formatDayShort(d)}`}
                className="text-[length:var(--text-body-sm)] font-medium text-ink hover:underline"
              >
                {formatDayShort(d)}
              </button>
              <ClinicExceptionLabel exception={exceptions.find((entry) => entry.date === dayKey(d))} />
              <ul className="mt-2 grid gap-1">
                {dayAppts.map((a) => (
                  <li key={a.id}>
                    <AppointmentSummary appointment={a} onOpen={onOpen} timeZone={timeZone} />
                  </li>
                ))}
              </ul>
              {dayAppts.length === 0 ? (
                <p className="mt-2 text-[length:var(--text-caption)] text-ink-muted">Sin citas</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Mes de personal no operativo: conserva la composición vigente y el renderizador de celda. */
export function StaffMonthBoard({
  days,
  appointments,
  timeZone,
  exceptions,
  onOpen,
  onOpenDay,
  isReception,
}: {
  days: Date[];
  appointments: AppointmentResponse[];
  timeZone: string;
  exceptions: PublicScheduleDto['exceptions'];
  onOpen: (id: number) => void;
  onOpenDay: (day: Date) => void;
  isReception: boolean;
}) {
  const leadCells = isoWeekDay(days[0]) - 1;
  const monthCells: (Date | null)[] = Array.from({ length: leadCells }, () => null);
  for (const d of days) monthCells.push(d);
  while (monthCells.length % 7 !== 0) monthCells.push(null);
  return (
    <AgendaMonthGrid reception={isReception}>
        {monthCells.map((cell, index) =>
          cell ? (
            <div key={dayKey(cell)}>
              <ReceptionMonthCell
                date={cell}
                appointments={appointments}
                renderAppointment={a => <AppointmentSummary appointment={a} onOpen={onOpen} timeZone={timeZone} />}
                timeZone={timeZone}
                clinicException={exceptions.find((entry) => entry.date === dayKey(cell))}
                onSelectDay={() => onOpenDay(cell)}
              />
            </div>
          ) : (
            <div key={`blank-${index}`} />
          ),
        )}
    </AgendaMonthGrid>
  );
}

/** Columnas temporales por profesional. OWNER conserva su región y su cuadrícula. */
export function DayColumns({
  columns,
  appointments,
  day,
  timeZone,
  role,
  isOperational,
  createDuration,
  serviceReady,
  dayAvail,
  windowStart,
  windowEnd,
  windowHeight,
  hourStops,
  pxPerMinute,
  clinicDay,
  onOpen,
  onBookSlot,
}: {
  columns: PublicScheduleDto['dentists'];
  appointments: AppointmentResponse[];
  day: Date;
  timeZone: string;
  role: string | undefined;
  isOperational: boolean;
  createDuration: number | undefined;
  serviceReady: boolean;
  dayAvail: UseQueryResult<AvailabilityDto>[];
  windowStart: number;
  windowEnd: number;
  windowHeight: number;
  hourStops: number[];
  pxPerMinute: number;
  clinicDay: { startTime?: string | null | undefined; endTime?: string | null | undefined; breaks: ScheduleDayDto['breaks'] };
  onOpen: (id: number) => void;
  onBookSlot: (dentistId: number, slot: AvailabilitySlotDto) => void;
}) {
  const owner = role === 'OWNER';
  return (
    <div className={owner ? 'owner-day-grid overflow-x-auto' : 'overflow-x-auto'} role={owner ? 'region' : undefined} aria-label={owner ? 'Cuadrícula temporal por dentista' : undefined} tabIndex={owner ? 0 : undefined}>
      {owner ? <p className="reception-operation-caption">Comparación temporal por profesional. Desplazamiento horizontal solo dentro de las columnas; la agenda cronológica está arriba.</p> : null}
      <div className="flex min-w-[680px] gap-2">
        <div className="relative w-11 shrink-0" style={{ height: windowHeight + (owner ? 48 : 0) }}>
          {hourStops.map((hour) => (
            <div
              key={hour}
              className="absolute right-0 text-[length:var(--text-caption)] text-ink-muted"
              style={{ top: (hour * 60 - windowStart) * pxPerMinute - 8 + (owner ? 48 : 0) }}
            >
              {clockLabel(hour * 60)}
            </div>
          ))}
        </div>
        {columns.map((dentist, index) => {
          const colAppts = appointments.filter((a) => a.dentistId === dentist.dentistId &&
            dayKey(new Date(a.startAt), timeZone) === dayKey(day));
          const lanes = owner ? ownerDayLanes(colAppts) : null;
          const availability = dayAvail[index];
          const loading = serviceReady && (!availability || availability.isPending || availability.isFetching);
          const slots = serviceReady && availability?.isSuccess && !loading && availability.data.durationMinutes === createDuration
            ? availability.data.slots.filter((slot) => slot.startDate === dayKey(day)) : [];
          return (
            <div
              key={dentist.dentistId}
              role="region"
              aria-label={`Agenda de ${fullName(dentist.firstName, dentist.lastName)}`}
              className="min-w-0 flex-1"
              style={lanes ? { minWidth: Math.max(260, lanes.count * 180) } : undefined}
            >
              <h3 className="truncate text-[length:var(--text-body-sm)] font-medium text-ink">
                {fullName(dentist.firstName, dentist.lastName)}
              </h3>
              <div className="relative mt-1 ring-1 ring-hairline" style={{ height: windowHeight }}>
                <AgendaAnnotations dentistId={dentist.dentistId} day={day} clinicDay={clinicDay}
                  windowStart={windowStart} windowEnd={windowEnd} pxPerMinute={pxPerMinute} />
                {colAppts.map((a) => (
                  <div
                    key={a.id}
                    className="absolute left-1 right-1 z-10"
                    style={{
                      top: (minutesOfDay(new Date(a.startAt), timeZone) - windowStart) * pxPerMinute,
                      height: Math.max(a.durationMinutes * pxPerMinute, 24),
                      ...(lanes ? { left: `calc(${(lanes.positions[a.id] ?? 0) * 100 / lanes.count}% + 4px)`, right: 'auto', width: `calc(${100 / lanes.count}% - 8px)` } : {}),
                    }}
                  >
                    <AppointmentSummary appointment={a} onOpen={onOpen} timeZone={timeZone} operational={isOperational} ownerGrid={owner} />
                  </div>
                ))}
                {slots.map((slot) => (
                  <button
                    key={`${slot.start}-${slot.end}`}
                    type="button"
                    aria-label={`Reservar ${clockLabel(parseClock(slot.startTime))}-${clockLabel(parseClock(slot.endTime))}`}
                    onClick={() => onBookSlot(dentist.dentistId, slot)}
                    className="absolute left-1 right-1 z-10 rounded-xs border border-dashed border-hairline text-[length:var(--text-caption)] text-primary-ink hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-primary"
                    style={{
                      top: (parseClock(slot.startTime) - windowStart) * pxPerMinute,
                      height: Math.max((parseClock(slot.endTime) - parseClock(slot.startTime)) * pxPerMinute, 24),
                    }}
                  >
                    +
                  </button>
                ))}
              </div>
              <div className="mt-2" aria-live="polite">
                {!serviceReady ? <p className="text-[length:var(--text-body-sm)] text-ink-secondary">Selecciona un servicio activo para consultar huecos.</p> : loading ? (
                  <p role="status" aria-label="Disponibilidad" className="text-[length:var(--text-body-sm)] text-ink-muted">
                    Cargando disponibilidad…
                  </p>
                ) : availability?.isError ? (
                  <FormAlert>{apiErrorMessage(availability.error, 'No se pudo consultar la disponibilidad.')}</FormAlert>
                ) : availability?.isSuccess && slots.length === 0 ? (
                  <p className="text-[length:var(--text-body-sm)] text-ink-secondary">
                    Sin huecos disponibles para este día.
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
