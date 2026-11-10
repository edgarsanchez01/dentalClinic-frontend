import type { Role } from '../../api/auth';
import type { ChargeStatus, PaymentMethod } from '../../api/financial';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../app/authStore';

export const FINANCIAL_ROLES: Role[] = ['OWNER', 'RECEPTIONIST', 'DENTIST'];
export const FINANCIAL_WRITE_ROLES: Role[] = ['OWNER', 'RECEPTIONIST'];
/** Reportes administrativos globales: DENTIST solo ve sus cargos, no la cartera completa. */
export const FINANCIAL_REPORT_ROLES: Role[] = ['OWNER', 'RECEPTIONIST'];
export type FinancialPermission = 'read' | 'write' | 'owner' | 'reports';
export function hasFinancialAccess(role: Role | undefined): boolean { return role !== undefined && FINANCIAL_ROLES.includes(role); }
/** DENTIST solo consulta: no crea cargos, no registra pagos, no anula ni reversa. */
export function canManageCharges(role: Role | undefined): boolean { return role !== undefined && FINANCIAL_WRITE_ROLES.includes(role); }
/** Reportes financieros globales (cartera/cobros): solo OWNER y RECEPTIONIST. */
export function canViewReports(role: Role | undefined): boolean { return role !== undefined && FINANCIAL_REPORT_ROLES.includes(role); }
/** Presentación de Recepción: el shell `.reception-shell` solo se aplica a RECEPTIONIST. */
export function useIsReception(): boolean { return useAuthStore((state) => state.user?.role) === 'RECEPTIONIST'; }
export function requireFinancialAccess(required: FinancialPermission = 'read'): void {
  const role = useAuthStore.getState().user?.role;
  const allowed = required === 'owner' ? role === 'OWNER'
    : required === 'write' ? canManageCharges(role)
    : required === 'reports' ? canViewReports(role) : hasFinancialAccess(role);
  if (!allowed) {
    throw new ApiError(403, null, 'Tu cuenta no tiene permiso para esta operacion financiera.');
  }
}
export const STATUS_LABELS: Record<ChargeStatus, string> = { PENDIENTE: 'Pendiente', PARCIAL: 'Parcial', PAGADO: 'Pagado', ANULADO: 'Anulado' };
export const METHOD_LABELS: Record<PaymentMethod, string> = { CASH: 'Efectivo', CARD: 'Tarjeta (terminal externa)', TRANSFER: 'Transferencia', OTHER: 'Otro' };
export const primary = 'min-h-11 rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-app)] font-medium text-paper outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';
export const secondary = 'min-h-11 rounded-control bg-paper px-4 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none hover:ring-hairline-strong focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';
export const control = 'mt-1.5 min-h-11 w-full min-w-0 rounded-control bg-input-fill px-3 py-2 text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';
export const danger = 'min-h-11 rounded-control bg-danger-subtle px-4 py-2 text-danger-ink ring-1 ring-danger outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';

export function financialError(cause: unknown): string {
  if (cause instanceof ApiError) return cause.body?.message || ({
    400: 'Revisa los datos de la solicitud.', 401: 'La sesion ya no es valida. Vuelve a iniciar sesion.',
    403: 'No tienes permiso para esta operacion.', 404: 'El cargo no existe o no es visible para tu cuenta.',
    409: 'La operacion entra en conflicto con los datos actuales. Consulta el saldo y el historial.',
  }[cause.status] ?? 'No se pudo completar la solicitud financiera.');
  return 'No se pudo confirmar la respuesta del servidor.';
}
export function financialDate(value: string): string { return new Date(value).toLocaleString('es-MX'); }
export { patientLabel } from '../patients/patientLabel';
