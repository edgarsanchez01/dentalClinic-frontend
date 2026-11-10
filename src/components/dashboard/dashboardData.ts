import type { PageDto } from '../../api/appointments';
import type { StaffUserDto } from '../../api/users';
import { fromLocalDateInput, localDateInput, rangeForView } from '../appointments/appointmentUi';

/** Calendar projections only: no availability or financial rules are calculated here. */
export function dashboardPeriod(now: number, timezone: string | undefined) {
  if (!timezone?.trim()) return null;
  try {
    const cursor = fromLocalDateInput(localDateInput(new Date(now), timezone));
    const day = rangeForView('day', cursor, timezone);
    const month = rangeForView('month', cursor, timezone);
    return { date: localDateInput(cursor), day: { from: day.from.toISOString(), to: day.to.toISOString() },
      month: { from: month.from.toISOString(), to: month.to.toISOString() } };
  } catch {
    return null; // Never substitute UTC or the browser's zone for missing configuration.
  }
}

/** A partial page is valid; its length must never replace the server's total. */
export function requireDashboardPage<T>(page: PageDto<T>): PageDto<T> {
  if (!page || !Array.isArray(page.content) || !Number.isSafeInteger(page.totalElements) || page.totalElements < 0
      || !Number.isSafeInteger(page.totalPages) || page.totalPages < 0
      || !Number.isSafeInteger(page.page) || page.page < 0 || !Number.isSafeInteger(page.size) || page.size < 1
      || page.content.length > page.size || page.content.length > page.totalElements
      || (page.totalElements > 0 && page.totalPages === 0)) {
    throw new Error('La respuesta está incompleta. Vuelve a consultar este bloque.');
  }
  return page;
}

export function pendingStaff(users: StaffUserDto[]): number | null {
  if (!Array.isArray(users)) return null;
  const staff = users.filter(user => user.role === 'DENTIST' || user.role === 'RECEPTIONIST');
  if (staff.some(user => !['ACTIVE', 'INACTIVE', 'PENDING'].includes(user.status))) return null;
  // active=false alone cannot distinguish a disabled account from an unused invitation.
  return staff.filter(user => user.status === 'PENDING').length;
}
