import type { AppointmentListParams, AppointmentResponse, PageDto } from '../../api/appointments';
import type { UserDto } from '../../api/auth';
import { requireDashboardPage } from './dashboardData';

export type CareScope = { role: 'DENTIST' | 'PATIENT'; id: number };

export function careScope(user: UserDto | null): CareScope | null {
  if (user?.role !== 'OWNER' && user?.role !== 'DENTIST' && user?.role !== 'PATIENT') return null;
  const role = user.role === 'OWNER' ? 'DENTIST' : user.role;
  const id = role === 'DENTIST' ? user.dentistId : user.patientId;
  return id !== undefined && Number.isSafeInteger(id) && id > 0 ? { role, id } : null;
}

/** DENTIST is filtered by SQL on the server. PATIENT ownership is forced by the server. */
export function careAppointmentParams(scope: CareScope, params: AppointmentListParams): AppointmentListParams {
  const filters = { ...params };
  delete filters.dentistId;
  delete filters.patientId;
  return scope.role === 'DENTIST' ? { ...filters, dentistId: scope.id } : filters;
}

/** Reject a broken response in full, never turn a global page into a locally filtered own list. */
export function requireCarePage(page: PageDto<AppointmentResponse>, scope: CareScope, params: AppointmentListParams) {
  requireDashboardPage(page);
  const from = params.from ? Date.parse(params.from) : -Infinity;
  const to = params.to ? Date.parse(params.to) : Infinity;
  const ids = new Set<number>();
  let previousStart = -Infinity;
  for (const appointment of page.content) {
    const start = Date.parse(appointment.startAt), end = Date.parse(appointment.endAt);
    if ((scope.role === 'DENTIST' ? appointment.dentistId : appointment.patientId) !== scope.id
        || !Number.isSafeInteger(appointment.id) || appointment.id < 1 || ids.has(appointment.id)
        || !Number.isSafeInteger(appointment.patientId) || appointment.patientId < 1
        || !Number.isSafeInteger(appointment.occurrenceVersion) || appointment.occurrenceVersion < 1
        || !Number.isFinite(start) || !Number.isFinite(end) || end <= start
        || start < from || start >= to || start < previousStart
        || !['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(appointment.status)
        || (params.status !== undefined && appointment.status !== params.status)) {
      throw new Error('No se pudo verificar el alcance de las citas recibidas.');
    }
    ids.add(appointment.id); previousStart = start;
  }
  if (page.page !== params.page || page.size > (params.size ?? 100)
      || (page.page === 0 && page.totalElements > 0 && page.content.length === 0)) {
    throw new Error('La página de citas está incompleta.');
  }
  return page;
}

export function patientRecordLink(appointment: AppointmentResponse) {
  return `/patients/${appointment.patientId}?appointmentId=${appointment.id}&occurrenceVersion=${appointment.occurrenceVersion}`;
}
