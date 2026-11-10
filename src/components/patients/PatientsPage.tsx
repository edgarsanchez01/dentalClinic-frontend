import { Navigate } from 'react-router-dom';

import { useAuthStore } from '../../app/authStore';
import { ReceptionPatientsWorkspace } from './ReceptionPatients';
import './patient-record.css';

/** Un único listado administrativo; las acciones respetan el rol autenticado. */
export function PatientsPage() {
  const user = useAuthStore((state) => state.user);
  if (user?.role === 'PATIENT') {
    if (!user.patientId || !Number.isSafeInteger(user.patientId) || user.patientId < 1) {
      return (
        <div className="mx-auto w-full max-w-[64rem] px-5 py-8 md:px-8">
          <h1 className="text-[length:var(--text-h3)] tracking-[-0.025em] text-ink">Mis datos</h1>
          <p role="status" className="mt-4 text-[length:var(--text-body-app)] text-ink-secondary">
            No tienes una ficha de paciente vinculada a tu cuenta. Contacta con la clínica.
          </p>
        </div>
      );
    }
    return <Navigate to={`/patients/${user.patientId}`} replace />;
  }
  return user?.role === 'OWNER'
    ? <div className="owner-chrome owner-patients"><ReceptionPatientsWorkspace /></div>
    : <ReceptionPatientsWorkspace />;
}
