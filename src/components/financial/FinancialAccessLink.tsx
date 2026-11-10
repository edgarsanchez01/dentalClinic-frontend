import { Link } from 'react-router-dom';
import { useAuthStore } from '../../app/authStore';
import { canManageCharges, hasFinancialAccess, secondary } from './financialUi';

/** Solo enlaces administrativos: no consulta finanzas ni cambia el flujo de la cita/expediente. */
export function FinancialAccessLink({ patientId, appointmentId, dentistId }: {
  patientId: number; appointmentId?: number; dentistId?: number;
}) {
  const user = useAuthStore((state) => state.user);
  if (!hasFinancialAccess(user?.role)) return null;
  if (appointmentId && user?.role === 'DENTIST' && (user.dentistId === undefined || user.dentistId !== dentistId)) return null;
  const context = `patientId=${patientId}${appointmentId ? `&appointmentId=${appointmentId}` : ''}`;
  return <div className="mt-4 flex flex-wrap gap-3" aria-label="Accesos financieros administrativos">
    <Link className={secondary} to={`/finances?${context}`}>{appointmentId ? 'Ver cargos de esta cita' : 'Ver cargos de este paciente'}</Link>
    {appointmentId && canManageCharges(user?.role) ? <Link className={secondary} to={`/finances/new?${context}`}>Crear cargo de esta cita</Link> : null}
  </div>;
}
