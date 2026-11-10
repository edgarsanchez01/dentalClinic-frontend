import { describe, expect, it } from 'vitest';
import type { UserDto } from '../../api/auth';
import type { AppointmentResponse } from '../../api/appointments';
import { careAppointmentParams, careScope, patientRecordLink, requireCarePage } from './careDashboardData';
import { dashboardPeriod } from './dashboardData';

const scope = { role: 'DENTIST', id: 3 } as const;
const appointment = { id: 7, patientId: 4, dentistId: 3, occurrenceVersion: 2, status: 'SCHEDULED',
  startAt: '2026-11-01T02:00:00Z', endAt: '2026-11-01T03:00:00Z' } as AppointmentResponse;
const params = { from: '2026-11-01T01:00:00Z', status: 'SCHEDULED', page: 0, size: 5 } as const;
const page = { content: [appointment], page: 0, size: 5, totalElements: 107, totalPages: 22 };

describe('Contratos de presentación 9B', () => {
  it.each(['RECEPTIONIST'])('no construye alcance clínico para %s', role => {
    expect(careScope({ role, dentistId: 3 } as UserDto)).toBeNull();
  });
  it('OWNER utiliza su perfil existente sin cambiar el rol autenticado', () => {
    const user = { role: 'OWNER', dentistId: 3 } as UserDto;
    expect(careScope(user)).toEqual(scope);
    expect(user.role).toBe('OWNER');
  });
  it.each([undefined, 0, -1, NaN, 1.5])('no permite fallback global si falta el perfil (%s)', dentistId => {
    expect(careScope({ role: 'DENTIST', dentistId } as UserDto)).toBeNull();
    expect(careScope({ role: 'OWNER', dentistId } as UserDto)).toBeNull();
  });
  it('la identidad proviene de /me, nunca de filtros arbitrarios', () => {
    expect(careAppointmentParams(scope, { ...params, dentistId: 900, patientId: 900 })).toEqual({ ...params, dentistId: 3 });
    expect(careAppointmentParams({ role: 'PATIENT', id: 4 }, { ...params, dentistId: 900, patientId: 900 })).toEqual(params);
  });
  it('conserva el total paginado del servidor y el enlace contextual real', () => {
    expect(requireCarePage(page, scope, params).totalElements).toBe(107);
    expect(patientRecordLink(appointment)).toBe('/patients/4?appointmentId=7&occurrenceVersion=2');
  });
  it.each([
    { dentistId: 900 }, { patientId: 0 }, { occurrenceVersion: 0 }, { status: 'COMPLETED' },
    { status: 'CANCELLED' }, { status: 'NO_SHOW' }, { startAt: '2026-10-31T01:00:00Z' },
    { startAt: 'invalid' }, { endAt: '2026-11-01T01:00:00Z' },
  ])('rechaza la página completa si incumple alcance/futuro/estado: %j', change => {
    expect(() => requireCarePage({ ...page, content: [{ ...appointment, ...change } as AppointmentResponse] }, scope, params)).toThrow();
  });
  it('rechaza citas de otro paciente, duplicados y orden no contractual', () => {
    expect(() => requireCarePage(page, { role: 'PATIENT', id: 900 }, params)).toThrow();
    expect(() => requireCarePage({ ...page, content: [appointment, appointment] }, scope, params)).toThrow();
    expect(() => requireCarePage({ ...page, content: [{ ...appointment, id: 8, startAt: '2026-11-01T02:30:00Z' }, appointment] }, scope, params)).toThrow();
  });
  it.each([{ page: 1 }, { size: 101 }, { content: [] }, { totalPages: 0 }])('no acepta páginas incompletas ni límites ignorados: %j', change => {
    expect(() => requireCarePage({ ...page, ...change }, scope, params)).toThrow();
  });
  it('calendario clínico cubre DST y no cambia silenciosamente a UTC', () => {
    const period = dashboardPeriod(Date.parse('2026-11-01T07:00:00Z'), 'America/New_York');
    expect(period?.day).toEqual({ from: '2026-11-01T04:00:00.000Z', to: '2026-11-02T05:00:00.000Z' });
    expect(dashboardPeriod(Date.now(), '')).toBeNull();
    expect(dashboardPeriod(Date.now(), 'bad/zone')).toBeNull();
  });
});
