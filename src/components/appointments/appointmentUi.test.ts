import { describe, expect, it } from 'vitest';

import { dayKey, formatTime, fromLocalDateInput, minutesOfDay, rangeForView } from './appointmentUi';

describe('Fechas de citas en la zona de la clínica', () => {
  it('mantiene el día clínico y la hora de un instante cercano a medianoche', () => {
    const instant = new Date('2026-03-28T23:30:00Z');
    expect(dayKey(instant, 'Europe/Madrid')).toBe('2026-03-29');
    expect(formatTime(instant.toISOString(), 'Europe/Madrid')).toBe('00:30');
    expect(minutesOfDay(instant, 'Europe/Madrid')).toBe(30);
  });

  it.each([
    ['2026-03-29', '2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z', 23],
    ['2026-10-25', '2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z', 25],
  ])('el rango del día %s respeta DST', (day, from, to, hours) => {
    const range = rangeForView('day', fromLocalDateInput(day), 'Europe/Madrid');
    expect(range.from.toISOString()).toBe(from);
    expect(range.to.toISOString()).toBe(to);
    expect((range.to.getTime() - range.from.getTime()) / 3_600_000).toBe(hours);
    expect(dayKey(range.days[0])).toBe(day);
  });

  it('formatea las dos ocurrencias de una hora repetida sin desplazar los instantes', () => {
    expect(formatTime('2026-10-25T00:30:00Z', 'Europe/Madrid')).toBe('02:30');
    expect(formatTime('2026-10-25T01:30:00Z', 'Europe/Madrid')).toBe('02:30');
    expect(formatTime('2026-03-29T00:30:00Z', 'Europe/Madrid')).toBe('01:30');
    expect(formatTime('2026-03-29T01:30:00Z', 'Europe/Madrid')).toBe('03:30');
  });

  it.each([
    ['Asia/Kathmandu', '2026-03-29', '2026-03-28T18:15:00.000Z', '2026-03-29T18:15:00.000Z'],
    ['America/New_York', '2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
    ['America/Sao_Paulo', '2018-11-04', '2018-11-04T03:00:00.000Z', '2018-11-05T02:00:00.000Z'],
  ])('resuelve límites en %s incluyendo offsets fraccionarios y cambios en medianoche', (zone, day, from, to) => {
    const range = rangeForView('day', fromLocalDateInput(day), zone);
    expect(range.from.toISOString()).toBe(from);
    expect(range.to.toISOString()).toBe(to);
  });

  it.each([
    ['week', '2026-03-22T23:00:00.000Z', '2026-03-29T22:00:00.000Z'],
    ['month', '2026-02-28T23:00:00.000Z', '2026-03-31T22:00:00.000Z'],
  ] as const)('los límites de %s usan el offset de cada extremo', (view, from, to) => {
    const range = rangeForView(view, fromLocalDateInput('2026-03-29'), 'Europe/Madrid');
    expect(range.from.toISOString()).toBe(from);
    expect(range.to.toISOString()).toBe(to);
  });
});
