import { useEffect, useState } from 'react';

import type {
  AppointmentEventView,
  AppointmentResponse,
  AppointmentStatus,
} from '../../api/appointments';
import { ApiError } from '../../api/http';

export type ViewMode = 'day' | 'week' | 'month';

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

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export function formatDayLong(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatDayShort(date: Date): string {
  return date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
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

export function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function addDays(value: Date, days: number): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
}

export function startOfWeek(value: Date): Date {
  const day = startOfLocalDay(value);
  return addDays(day, -((day.getDay() + 6) % 7));
}

export function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

export function endOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth() + 1, 1);
}

export function localDateInput(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

export function fromLocalDateInput(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return startOfLocalDay(new Date());
  }
  return new Date(year, month - 1, day);
}

/** Día ISO de la semana: 1 = lunes … 7 = domingo (contrato del backend). */
export function isoWeekDay(value: Date): number {
  return ((value.getDay() + 6) % 7) + 1;
}

export function minutesOfDay(value: Date): number {
  return value.getHours() * 60 + value.getMinutes();
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

export function dayKey(value: Date): string {
  return localDateInput(value);
}

export function rangeForView(
  view: ViewMode,
  cursor: Date,
): { from: Date; to: Date; days: Date[] } {
  const day = startOfLocalDay(cursor);
  if (view === 'day') {
    return { from: day, to: addDays(day, 1), days: [day] };
  }
  if (view === 'week') {
    const from = startOfWeek(day);
    const days = Array.from({ length: 7 }, (_, index) => addDays(from, index));
    return { from, to: addDays(from, 7), days };
  }
  const from = startOfMonth(day);
  const to = endOfMonth(day);
  const days: Date[] = [];
  for (let current = from; current < to; current = addDays(current, 1)) {
    days.push(current);
  }
  return { from, to, days };
}

export function sortAppointments(appointments: AppointmentResponse[]): AppointmentResponse[] {
  return [...appointments].sort(
    (left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime(),
  );
}
