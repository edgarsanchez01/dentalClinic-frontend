import { describe, expect, it } from 'vitest';
import type { ScheduleDayDto } from '../../api/scheduling';
import { calendarRange, calendarScale, calendarTime, clockSeconds, projectCalendarDay } from './reception-calendar-model';

const day: ScheduleDayDto = { dayOfWeek: 1, open: true, startTime: '09:00:00', endTime: '18:00:00', breaks: [] };

describe('UX-04G.4 proyección visual de semana habitual', () => {
  it('una jornada continua no recibe descansos automáticos', () => {
    expect(projectCalendarDay(day).segments).toEqual([{ kind: 'work', start: 32400, end: 64800, startTime: '09:00:00', endTime: '18:00:00' }]);
    expect(calendarScale([day])).toEqual({ startHour: 8, endHour: 19, height: 440 });
  });
  it('divide solo visualmente por todos los descansos recibidos, sin mutar el API', () => {
    const input = { ...day, breaks: [{ startTime: '16:00:00', endTime: '16:15:00' }, { startTime: '13:00:00', endTime: '14:00:00' }] };
    const original = JSON.stringify(input);
    expect(projectCalendarDay(input).segments.map((item) => [item.kind, calendarRange(item.startTime, item.endTime)])).toEqual([
      ['work', '09:00–13:00'], ['break', '13:00–14:00'], ['work', '14:00–16:00'], ['break', '16:00–16:15'], ['work', '16:15–18:00'],
    ]);
    expect(JSON.stringify(input)).toBe(original);
  });
  it('usa una escala común para jornadas de2 y8 horas y conserva madrugada/final del día', () => {
    const early = { ...day, startTime: '00:15:00', endTime: '08:15:00' };
    const late = { ...day, dayOfWeek: 2, startTime: '21:59:59.5', endTime: '23:59:59.5' };
    const scale = calendarScale([early, late])!;
    expect(scale).toEqual({ startHour: 0, endHour: 24, height: 960 });
    const a = projectCalendarDay(early).segments[0]!, b = projectCalendarDay(late).segments[0]!;
    expect((a.end - a.start) / (b.end - b.start)).toBe(4);
    expect(calendarTime(late.endTime)).toBe('23:59:59.5');
  });
  it('respeta descansos contiguos y en los extremos sin generar bloques de altura cero', () => {
    const input = { ...day, breaks: [{ startTime: '09:00:00', endTime: '10:00:00' }, { startTime: '10:00:00', endTime: '11:00:00' }, { startTime: '17:00:00', endTime: '18:00:00' }] };
    const result = projectCalendarDay(input);
    expect(result.issue).toBe(false); expect(result.segments).toHaveLength(4);
    expect(result.segments.every((item) => item.end > item.start)).toBe(true);
  });
  it('sin jornada o días cerrados no devuelve bloques ni una escala de disponibilidad aparente', () => {
    expect(calendarScale([])).toBeNull(); expect(projectCalendarDay().segments).toEqual([]);
    expect(calendarScale([{ ...day, open: false }])).toBeNull();
  });
  it.each([
    { ...day, startTime: null }, { ...day, startTime: '25:00:00' }, { ...day, startTime: '20:00:00', endTime: '08:00:00' },
    { ...day, breaks: [{ startTime: '08:00:00', endTime: '10:00:00' }] },
    { ...day, breaks: [{ startTime: '15:00:00', endTime: '14:00:00' }] },
    { ...day, breaks: [{ startTime: '12:00:00', endTime: '14:00:00' }, { startTime: '13:00:00', endTime: '15:00:00' }] },
  ])('no inventa ni solapa bloques para datos no representables: %j', (input) => {
    expect(projectCalendarDay(input)).toEqual({ segments: [], issue: true });
  });
  it('conserva horas en formato HH:mm y precisión de segundos sin redondear etiquetas', () => {
    expect(calendarTime('09:00')).toBe('09:00'); expect(calendarTime('09:00:00')).toBe('09:00');
    expect(calendarRange('09:00:30.125', '10:00:45')).toBe('09:00:30.125–10:00:45');
    expect(clockSeconds('09:00:30.125')).toBe(32430.125);
  });
});
