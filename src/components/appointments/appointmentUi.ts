import { useEffect, useState } from 'react';

import type {
  AppointmentEventView,
  AppointmentResponse,
  AppointmentStatus,
} from '../../api/appointments';
import { ApiError } from '../../api/http';

export type ViewMode = 'day' | 'week' | 'month';

/** Etiqueta del período de agenda; no altera URL, rango ni zona de los datos. */
export function agendaPeriodLabel(view: ViewMode, days: Date[], cursor: Date): string {
  return view === 'week'
    ? `${formatDayShort(days[0])} – ${formatDayShort(days[6])}`
    : view === 'month'
      ? cursor.toLocaleDateString('es-MX', { timeZone: 'UTC', month: 'long', year: 'numeric' })
      : formatDayLong(cursor.toISOString(), 'UTC');
}

let nowAnchor = Date.now();

/**
 * Reloj "ahora" que se refresca cada minuto y al recuperar el foco. Evita llamar a
 * `Date.now()` durante el render (regla de pureza de React) y hace que se recalcule
 * automáticamente el momento en que una cita pasa a estar "comenzada".
 */
export function useNow(): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const update = () => {
      nowAnchor = Date.now();
      setTick((tick) => tick + 1);
    };
    const interval = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', update);
    };
  }, []);
  return nowAnchor;
}

export const EVENT_LABELS: Record<AppointmentEventView['eventType'], string> = {
  APPOINTMENT_CREATED: 'Cita creada',
  APPOINTMENT_RESCHEDULED: 'Cita reprogramada',
  APPOINTMENT_CANCELLED: 'Cita cancelada',
  APPOINTMENT_COMPLETED: 'Cita completada',
  APPOINTMENT_NO_SHOW: 'No asistió',
  PATIENT_ARRIVED: 'Llegada registrada',
  APPOINTMENT_STARTED: 'Cita iniciada',
  REMINDER_SENT: 'Recordatorio enviado',
  REMINDER_FAILED: 'Fallo del recordatorio',
  FEEDBACK_REQUESTED: 'Valoración solicitada',
};

export const STATUS_OPTIONS: { value: AppointmentStatus; label: string }[] = [
  { value: 'SCHEDULED', label: 'Programada' },
  { value: 'COMPLETED', label: 'Completada' },
  { value: 'CANCELLED', label: 'Cancelada' },
  { value: 'NO_SHOW', label: 'No asistió' },
];

export function statusLabel(status: AppointmentStatus): string {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/** §13.3: color Y tratamiento (tachado/opacidad), nunca solo color. */
export function statusChipClass(status: AppointmentStatus): string {
  switch (status) {
    case 'SCHEDULED':
      return 'bg-primary-subtle text-primary-ink';
    case 'COMPLETED':
      return 'bg-success-subtle text-success-ink';
    case 'CANCELLED':
      return 'bg-sunken text-ink-muted line-through opacity-70';
    case 'NO_SHOW':
      return 'bg-danger-subtle text-danger-ink';
  }
}

export function formatTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', { timeZone, hour: '2-digit', minute: '2-digit' });
}

export function formatDayLong(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString('es-ES', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatDayShort(date: Date): string {
  return date.toLocaleDateString('es-ES', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
}

export function fullName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  return `${firstName ?? ''} ${lastName ?? ''}`.trim();
}

/** Mensaje accionable por código de estado; primero el del backend (que ya es en español). */
export function apiErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) {
    if (cause.body?.message) {
      return cause.body.message;
    }
    switch (cause.status) {
      case 400:
        return 'Revisa los datos del formulario: hay un campo no válido.';
      case 401:
        return 'Tu sesión ha caducado. Vuelve a iniciar sesión.';
      case 403:
        return 'No tienes permisos para realizar esta acción.';
      case 404:
        return 'No encontramos el recurso solicitado.';
      case 409:
        return 'La operación entra en conflicto con el estado actual de la cita.';
      default:
        return fallback;
    }
  }
  if (cause instanceof Error && cause.message.trim() !== '') {
    return cause.message;
  }
  return fallback;
}

/** Calendar-only dates use UTC fields as a carrier, NOT as appointment instants. */
export function startOfCalendarDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function addDays(value: Date, days: number): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + days));
}

export function startOfWeek(value: Date): Date {
  const day = startOfCalendarDay(value);
  return addDays(day, -((day.getUTCDay() + 6) % 7));
}

export function startOfMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

export function endOfMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
}

function datePartsKey(parts: Intl.DateTimeFormatPart[]): string {
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** With a zone, project an instant; without one, serialize a calendar-only date. */
export function localDateInput(value: Date, timeZone?: string): string {
  if (timeZone !== undefined) {
    return datePartsKey(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(value));
  }
  return value.toISOString().slice(0, 10);
}

export function fromLocalDateInput(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    throw new RangeError('Fecha de calendario inválida');
  }
  return new Date(Date.UTC(year, month - 1, day));
}

/** Día ISO de la semana: 1 = lunes … 7 = domingo (contrato del backend). */
export function isoWeekDay(value: Date): number {
  return ((value.getUTCDay() + 6) % 7) + 1;
}

export function minutesOfDay(value: Date, timeZone: string): number {
  return parseClock(formatTime(value.toISOString(), timeZone));
}

/** `HH:mm:ss` o `HH:mm` → minutos desde medianoche. */
export function parseClock(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const [hours, minutes] = value.split(':');
  return Number(hours) * 60 + Number(minutes ?? 0);
}

export function clockLabel(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  const rest = String(minutes % 60).padStart(2, '0');
  return `${hours}:${rest}`;
}

export function dayKey(value: Date, timeZone?: string): string {
  return localDateInput(value, timeZone);
}

/** First instant of a clinical calendar day, including midnight DST gaps/overlaps.
 * This only translates query boundaries; it never calculates bookable slots.
 */
function clinicalDayStart(day: Date, timeZone: string): Date {
  const key = dayKey(day);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  // All IANA UTC offsets fit inside this window. Search at millisecond precision.
  let low = day.getTime() - 36 * 3_600_000;
  let high = day.getTime() + 36 * 3_600_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (datePartsKey(formatter.formatToParts(new Date(middle))) < key) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
}

export function rangeForView(
  view: ViewMode,
  cursor: Date,
  timeZone: string,
): { from: Date; to: Date; days: Date[] } {
  const day = startOfCalendarDay(cursor);
  if (view === 'day') {
    return { from: clinicalDayStart(day, timeZone), to: clinicalDayStart(addDays(day, 1), timeZone), days: [day] };
  }
  if (view === 'week') {
    const from = startOfWeek(day);
    const days = Array.from({ length: 7 }, (_, index) => addDays(from, index));
    return { from: clinicalDayStart(from, timeZone), to: clinicalDayStart(addDays(from, 7), timeZone), days };
  }
  const from = startOfMonth(day);
  const to = endOfMonth(day);
  const days: Date[] = [];
  for (let current = from; current < to; current = addDays(current, 1)) {
    days.push(current);
  }
  return { from: clinicalDayStart(from, timeZone), to: clinicalDayStart(to, timeZone), days };
}

export function sortAppointments(appointments: AppointmentResponse[]): AppointmentResponse[] {
  return [...appointments].sort(
    (left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime(),
  );
}
