import { describe, expect, it } from 'vitest';
import type { StaffUserDto } from '../../api/users';
import { dashboardPeriod, pendingStaff, requireDashboardPage } from './dashboardData';

describe('Períodos de dashboard en la zona clínica', () => {
  it('proyecta el día y el mes sin usar UTC o la zona del navegador', () => {
    expect(dashboardPeriod(Date.parse('2026-11-01T01:00:00Z'), 'America/Mexico_City')).toEqual({
      date: '2026-10-31', day: { from: '2026-10-31T06:00:00.000Z', to: '2026-11-01T06:00:00.000Z' },
      month: { from: '2026-10-01T06:00:00.000Z', to: '2026-11-01T06:00:00.000Z' },
    });
  });
  it.each([
    ['2026-03-08T12:00:00Z', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z', 23],
    ['2026-11-01T12:00:00Z', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z', 25],
  ])('respeta DST: %s', (now, from, to, hours) => {
    const result = dashboardPeriod(Date.parse(now), 'America/New_York')!;
    expect(result.day).toEqual({ from, to });
    expect(Date.parse(to) - Date.parse(from)).toBe(hours * 3600000);
  });
  it('maneja año, mes bisiesto y zonas con cambio a medianoche', () => {
    expect(dashboardPeriod(Date.parse('2027-01-01T01:00:00Z'), 'America/Mexico_City')?.month.to).toBe('2027-01-01T06:00:00.000Z');
    const leap = dashboardPeriod(Date.parse('2024-02-29T12:00:00Z'), 'Asia/Tokyo')!;
    expect(leap.month).toEqual({ from: '2024-01-31T15:00:00.000Z', to: '2024-02-29T15:00:00.000Z' });
    expect(dashboardPeriod(Date.parse('2026-09-06T12:00:00Z'), 'America/Santiago')?.day.from).toBe('2026-09-06T04:00:00.000Z');
  });
  it.each([undefined, '', 'invalid/timezone'])('no sustituye una zona ausente o inválida: %s', timezone => {
    expect(dashboardPeriod(Date.parse('2026-10-16T12:00:00Z'), timezone)).toBeNull();
  });
});

describe('Contratos parciales y totales', () => {
  it('conserva el total del servidor aunque solo se pida una fila', () => {
    const page = { content: [{ id: 1 }], page: 0, size: 1, totalElements: 207, totalPages: 207 };
    expect(requireDashboardPage(page).totalElements).toBe(207);
  });
  it('rechaza metadata incompleta, sin inventar un cero', () => {
    expect(() => requireDashboardPage({ content: [] } as never)).toThrow('incompleta');
  });
  it('no infiere una invitación pendiente de active=false', () => {
    const staff = (role: string, status: string | undefined) => ({ role, active: false, status }) as StaffUserDto;
    expect(pendingStaff([staff('DENTIST', 'PENDING'), staff('RECEPTIONIST', 'INACTIVE'), staff('PATIENT', 'PENDING')])).toBe(1);
    expect(pendingStaff([staff('RECEPTIONIST', undefined)])).toBeNull();
  });
});
