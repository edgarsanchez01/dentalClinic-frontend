import { useAuthStore } from '../../app/authStore';
import { AppShell } from '../layout/AppShell';
import { OwnerDashboard, ReceptionistDashboard } from '../dashboard/DashboardPage';
import { PatientDashboard } from '../dashboard/CareDashboard';
import { DentistDashboard } from '../dentist/DentistDashboard';
import { useSearchParams } from 'react-router-dom';
import { OwnerViewSwitch } from './OwnerViewSwitch';

/**
 * Inicio por rol: el OWNER reutiliza Clinical Editorial sin cambiar su ámbito.
 */
export function HomePage() {
  const user = useAuthStore((state) => state.user);
  const [params] = useSearchParams();

  if (user?.role === 'OWNER') return <AppShell><div className="owner-workspace reception-shell"><OwnerViewSwitch area="home" />{params.get('scope') === 'mine'
    ? <div className="dentist-shell"><DentistDashboard /></div> : <OwnerDashboard />}</div></AppShell>;
  if (user?.role === 'RECEPTIONIST') return <AppShell><ReceptionistDashboard /></AppShell>;

  if (user?.role === 'DENTIST') return <AppShell><DentistDashboard /></AppShell>;
  if (user?.role === 'PATIENT') return <AppShell><PatientDashboard /></AppShell>;
  return null;
}
