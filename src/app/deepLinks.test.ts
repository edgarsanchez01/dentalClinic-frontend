import { describe, expect, it } from 'vitest';
import { calendarDate, routeId, safeReturnTo } from './deepLinks';
import { readReportLink } from './reportLinks';

describe('9A.1 límites de deep links', () => {
  it.each(['2026-02-29', '2026-13-01', '2026-04-31', 'tomorrow'])(
    'no normaliza una fecha inválida %s', (value) => expect(calendarDate(value)).toBeNull(),
  );
  it('acepta bisiesto real y rechaza IDs ambiguos o fuera de precisión', () => {
    expect(calendarDate('2028-02-29')).toBe('2028-02-29');
    for (const value of ['-1', '0', '1e2', 'NaN', '9007199254740993']) expect(routeId(value)).toBeNull();
  });
  it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/login', '/api/charges', '/patients/1\n'])(
    'no usa como retorno de login %s', (value) => expect(safeReturnTo(value)).toBe('/'),
  );
  it('conserva ruta, filtros y hash internos tras login', () => {
    const target = '/appointments?view=day&date=2026-10-13&status=SCHEDULED#new';
    expect(safeReturnTo(target)).toBe(target);
  });
  it.each([
    'from=2026-10-01', 'from=2026-02-30T00%3A00%3A00Z',
    'from=2026-11-01T00%3A00%3A00Z&to=2026-10-01T00%3A00%3A00Z',
    'status=UNKNOWN', 'patientId=-1', 'patientId=1&patientId=2',
  ])('rechaza el filtro de reporte inválido sin convertirlo en uno global: %s', (query) => {
    expect(readReportLink(new URLSearchParams(query)).error).not.toBeNull();
  });
});
