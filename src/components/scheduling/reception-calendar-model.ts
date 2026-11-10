import type { ScheduleDayDto } from '../../api/scheduling';

export const CALENDAR_DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const HOUR_HEIGHT = 40;

export function clockSeconds(value?: string | null): number | null {
  if (!value || !/^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)) return null;
  const [hours = 0, minutes = 0, seconds = 0] = value.split(':').map(Number);
  return hours < 24 && minutes < 60 && seconds < 60 ? hours * 3600 + minutes * 60 + seconds : null;
}

/** Keep exact API precision, omitting only a zero seconds component. */
export const calendarTime = (value?: string | null) => value && value.length > 5 ? value.replace(/:00(?:\.0+)?$/, '') : value ?? '';
export const calendarRange = (start?: string | null, end?: string | null) => start && end
  ? `${calendarTime(start)}–${calendarTime(end)}` : 'Horario sin definir';

export interface CalendarSegment {
  kind: 'work' | 'break'; start: number; end: number; startTime: string; endTime: string;
}

/** Layout projection ONLY. Never available/bookable intervals, dates, appointments or clinic rules. */
export function projectCalendarDay(day?: ScheduleDayDto): { segments: CalendarSegment[]; issue: boolean } {
  if (!day?.open) return { segments: [], issue: false };
  const start = clockSeconds(day.startTime), end = clockSeconds(day.endTime);
  if (start === null || end === null || start >= end) return { segments: [], issue: true };
  const breaks = [...day.breaks].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const segments: CalendarSegment[] = [];
  let cursor = start, cursorTime = day.startTime!;
  for (const item of breaks) {
    const a = clockSeconds(item.startTime), b = clockSeconds(item.endTime);
    if (a === null || b === null || a < cursor || a < start || b > end || a >= b) return { segments: [], issue: true };
    if (a > cursor) segments.push({ kind: 'work', start: cursor, end: a, startTime: cursorTime, endTime: item.startTime });
    segments.push({ kind: 'break', start: a, end: b, startTime: item.startTime, endTime: item.endTime });
    cursor = b; cursorTime = item.endTime;
  }
  if (cursor < end) segments.push({ kind: 'work', start: cursor, end, startTime: cursorTime, endTime: day.endTime! });
  return { segments, issue: false };
}

export function calendarScale(days: ScheduleDayDto[]) {
  const segments = days.flatMap((day) => projectCalendarDay(day).segments);
  if (!segments.length) return null;
  // One common scale, rounded outwards with an hour of context, clamped to the local day.
  const startHour = Math.max(0, Math.floor(Math.min(...segments.map((item) => item.start)) / 3600) - 1);
  const endHour = Math.min(24, Math.ceil(Math.max(...segments.map((item) => item.end)) / 3600) + 1);
  return { startHour, endHour, height: (endHour - startHour) * HOUR_HEIGHT };
}
