import { Route, Routes } from 'react-router-dom';
import { AppointmentsPage } from '../components/appointments/AppointmentsPage';
import { RequireAuth } from './guards';
import { AppShell } from '../components/layout/AppShell';

export function AppointmentsRoutes() {
  return (
    <Routes>
      <Route
        path="*"
        element={
          <RequireAuth>
            <AppShell>
              <AppointmentsPage />
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
