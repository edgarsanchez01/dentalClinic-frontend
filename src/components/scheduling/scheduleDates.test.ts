import { afterEach, describe, expect, it, vi } from 'vitest';
import { clinicToday, readableDate } from './scheduleDates';

afterEach(() => vi.useRealTimers());

describe('fecha de consulta en la zona de la clínica', () => {
  it.each([
    ['2026-10-25T23:30:00Z', 'Europe/Madrid', '2026-10-26'],
    ['2026-10-26T00:30:00Z', 'America/Mexico_City', '2026-10-25'],
    ['2026-03-29T00:30:00Z', 'Europe/Madrid', '2026-03-29'],
    ['2026-03-29T22:30:00Z', 'Europe/Madrid', '2026-03-30'],
    ['2026-12-31T23:30:00Z', 'Pacific/Kiritimati', '2027-01-01'],
  ])('%s → %s: %s, sin depender de la zona del navegador', (instant, zone, day) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(instant));
    expect(clinicToday(zone)).toBe(day);
  });
  it.each([undefined, '', 'Zona/inexistente'])('sin zona válida (%s) no inventa una fecha local/UTC', (zone) => {
    expect(clinicToday(zone)).toBe('');
  });
  it('una LocalDate mantiene su día al presentarse', () => {
    expect(readableDate('2026-10-26')).toBe('26 de octubre de 2026');
  });
});
