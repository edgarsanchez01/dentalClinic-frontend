import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { ActivatePage } from '../components/auth/ActivatePage';
import { ChangePasswordPage } from '../components/auth/ChangePasswordPage';
import { ForgotPasswordPage } from '../components/auth/ForgotPasswordPage';
import { LoginPage } from '../components/auth/LoginPage';
import { RegisterPage } from '../components/auth/RegisterPage';
import { ResetPasswordPage } from '../components/auth/ResetPasswordPage';
import { HomePage } from '../components/app/HomePage';
import { ClinicSettingsPage } from '../components/clinic/ClinicSettingsPage';
import { AppShell } from '../components/layout/AppShell';
import { PatientDetailPage } from '../components/patients/PatientDetailPage';
import { PatientsPage } from '../components/patients/PatientsPage';
import { AppointmentsPage } from '../components/appointments/AppointmentsPage';
import { AppointmentDetailPage } from '../components/appointments/AppointmentDetailPage';
import { PublicSchedulePage } from '../components/scheduling/PublicSchedulePage';
import { SchedulingPage } from '../components/scheduling/SchedulingPage';
import { TeamPage } from '../components/users/TeamPage';
import { useAuthStore } from './authStore';
import { RequireAuth, RequireGuest, RequireRole } from './guards';
import { OnboardingEntry, OnboardingRoute } from './onboardingGate';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Restaura la sesion una sola vez al montar la app. Mientras corre, los guards
 * muestran el estado `restoring` en lugar de redirigir a /login.
 */
function SessionHydrator() {
  const hydrate = useAuthStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionHydrator />
        <Routes>
          <Route
            path="/login"
            element={
              <RequireGuest>
                <LoginPage />
              </RequireGuest>
            }
          />
          <Route path="/activate" element={<ActivatePage />} />
          <Route
            path="/register"
            element={
              <RequireGuest>
                <RegisterPage />
              </RequireGuest>
            }
          />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/schedule" element={<PublicSchedulePage />} />
          <Route path="/onboarding" element={<OnboardingRoute />} />
          <Route
            path="/patients"
            element={
              <RequireAuth>
                <AppShell>
                  <PatientsPage />
                </AppShell>
              </RequireAuth>
            }
          />
          <Route
            path="/patients/:id"
            element={
              <RequireAuth>
                <AppShell>
                  <PatientDetailPage />
                </AppShell>
              </RequireAuth>
            }
          />
          <Route
            path="/appointments/:id"
            element={
              <RequireAuth>
                <AppShell>
                  <AppointmentDetailPage />
                </AppShell>
              </RequireAuth>
            }
          />
          <Route
            path="/appointments"
            element={
              <RequireAuth>
                <AppShell>
                  <AppointmentsPage />
                </AppShell>
              </RequireAuth>
            }
          />
          <Route
            path="/"
            element={
              <OnboardingEntry>
                <HomePage />
              </OnboardingEntry>
            }
          />
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                <ChangePasswordPage />
              </RequireAuth>
            }
          />
          <Route
            path="/clinic"
            element={
              <RequireAuth>
                <RequireRole role="OWNER">
                  <AppShell>
                    <ClinicSettingsPage />
                  </AppShell>
                </RequireRole>
              </RequireAuth>
            }
          />
          <Route
            path="/users"
            element={
              <RequireAuth>
                <RequireRole role="OWNER">
                  <AppShell>
                    <TeamPage />
                  </AppShell>
                </RequireRole>
              </RequireAuth>
            }
          />
          <Route
            path="/scheduling"
            element={
              <RequireAuth>
                <RequireRole role={['OWNER', 'DENTIST', 'RECEPTIONIST']}>
                  <AppShell>
                    <SchedulingPage />
                  </AppShell>
                </RequireRole>
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}