import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { createBrowserRouter, createRoutesFromElements, Navigate, Outlet, Route, RouterProvider } from 'react-router-dom';

import { ActivatePage } from '../components/auth/ActivatePage';
import { ChangePasswordPage } from '../components/auth/ChangePasswordPage';
import { ForgotPasswordPage } from '../components/auth/ForgotPasswordPage';
import { LoginPage } from '../components/auth/LoginPage';
import { RegisterPage } from '../components/auth/RegisterPage';
import { ResetPasswordPage } from '../components/auth/ResetPasswordPage';
import { HomePage } from '../components/app/HomePage';
import { ClinicSettingsPage } from '../components/clinic/ClinicSettingsPage';
import { AppShell } from '../components/layout/AppShell';
import { NotificationsPage } from '../components/notifications/NotificationsPage';
import { ServicesPage } from '../components/catalog/ServicesPage';
import { PatientDetailPage } from '../components/patients/PatientDetailPage';
import { PatientsPage } from '../components/patients/PatientsPage';
import { AppointmentsPage } from '../components/appointments/AppointmentsPage';
import { AppointmentDetailPage } from '../components/appointments/AppointmentDetailPage';
import { PublicSchedulePage } from '../components/scheduling/PublicSchedulePage';
import { SchedulingPage } from '../components/scheduling/SchedulingPage';
import { TeamPage } from '../components/users/TeamPage';
import { FinancesPage } from '../components/financial/FinancesPage';
import { CreateChargePage } from '../components/financial/CreateChargePage';
import { ChargeDetailPage } from '../components/financial/ChargeDetailPage';
import { CollectionQueuePage } from '../components/financial/CollectionQueuePage';
import { AppointmentCollectionPage } from '../components/financial/AppointmentCollectionPage';
import { ReportsPage } from '../components/financial/ReportsPage';
import { FINANCIAL_ROLES, FINANCIAL_WRITE_ROLES, FINANCIAL_REPORT_ROLES } from '../components/financial/financialUi';
import { useAuthStore } from './authStore';
import { RequireAuth, RequireGuest, RequireRole } from './guards';
import { OnboardingEntry, OnboardingRoute } from './onboardingGate';
import { UnsavedChangesProvider } from './UnsavedChangesProvider';
import { FeedbackPage } from '../components/feedback/FeedbackPage';
import { ReviewsPage } from '../components/feedback/ReviewsPage';
import { LandingPage } from '../components/public/LandingPage';
import { PatientIntakePage } from '../components/medical-intake/PatientIntakePage';
import { PatientIntakeProfile } from '../components/medical-intake/PatientIntakeProfile';

/** La entrada pública no espera contenido ni estado de instalación de una API. */
function PublicEntry() {
  const status = useAuthStore((state) => state.status);
  if (status !== 'authenticated') return <LandingPage />;
  return <OnboardingEntry><HomePage /></OnboardingEntry>;
}

/**
 * Restaura la sesion una sola vez al montar la app. Mientras corre, los guards
 * muestran el estado `restoring` en lugar de redirigir a /login.
 */
function SessionHydrator() {
  const hydrate = useAuthStore((state) => state.hydrate);
  const started = useRef(false);

  useEffect(() => {
    // StrictMode repite los efectos de montaje en desarrollo. Un refresh rotativo no puede
    // enviarse dos veces: abortar el primero no deshace un consumo ya confirmado en servidor.
    if (started.current) return;
    started.current = true;
    void hydrate();
  }, [hydrate]);

  return null;
}

function AppSession() {
  const queryClient = useAuthStore((state) => state.queryClient);
  const sessionVersion = useAuthStore((state) => state.sessionVersion);
  return (
    <>
      <SessionHydrator />
      <QueryClientProvider key={sessionVersion} client={queryClient}>
        <UnsavedChangesProvider>
          <Outlet />
        </UnsavedChangesProvider>
      </QueryClientProvider>
    </>
  );
}

// Data router: conserva las rutas y guards, y permite bloquear PUSH/REPLACE/POP sin trucos de historial.
// eslint-disable-next-line react-refresh/only-export-components -- Configuración compartida por entrada browser y routers aislados de tests.
export const appRoutes = createRoutesFromElements(
  <Route element={<AppSession />} errorElement={<RouteFailure />}>
          <Route path="/feedback/:token" element={<FeedbackPage />} />
          <Route path="/reviews" element={<RequireAuth><RequireRole role={['OWNER', 'DENTIST']}><AppShell><ReviewsPage /></AppShell></RequireRole></RequireAuth>} />
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
          <Route path="/patient-onboarding" element={<RequireAuth><PatientIntakePage /></RequireAuth>} />
          <Route path="/patient-profile" element={<RequireAuth><RequireRole role="PATIENT"><AppShell><PatientIntakeProfile /></AppShell></RequireRole></RequireAuth>} />
          <Route path="/patient-profile/edit" element={<RequireAuth><RequireRole role="PATIENT"><PatientIntakePage revision /></RequireRole></RequireAuth>} />
          <Route
            path="/notifications"
            element={
              <RequireAuth>
                <AppShell>
                  <NotificationsPage />
                </AppShell>
              </RequireAuth>
            }
          />
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
              <PublicEntry />
            }
          />
          <Route
            path="/change-password"
            element={
              <RequireAuth>
                <AppShell><ChangePasswordPage /></AppShell>
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
          <Route path="/services" element={
            <RequireAuth>
              <RequireRole role={['OWNER', 'DENTIST', 'RECEPTIONIST']}>
                <AppShell><ServicesPage /></AppShell>
              </RequireRole>
            </RequireAuth>
          } />
          <Route path="/collections" element={<RequireAuth><RequireRole role={FINANCIAL_WRITE_ROLES}><AppShell><CollectionQueuePage /></AppShell></RequireRole></RequireAuth>} />
          <Route path="/collections/:id" element={<RequireAuth><RequireRole role={FINANCIAL_WRITE_ROLES}><AppShell><AppointmentCollectionPage /></AppShell></RequireRole></RequireAuth>} />
          <Route path="/finances" element={<RequireAuth><RequireRole role={FINANCIAL_ROLES}><AppShell><FinancesPage /></AppShell></RequireRole></RequireAuth>} />
          <Route path="/finances/new" element={<RequireAuth><RequireRole role={FINANCIAL_WRITE_ROLES}><AppShell><CreateChargePage /></AppShell></RequireRole></RequireAuth>} />
          <Route path="/finances/reports" element={<RequireAuth><RequireRole role={FINANCIAL_REPORT_ROLES}><AppShell><ReportsPage /></AppShell></RequireRole></RequireAuth>} />
          <Route path="/finances/:id" element={<RequireAuth><RequireRole role={FINANCIAL_ROLES}><AppShell><ChargeDetailPage /></AppShell></RequireRole></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
  </Route>,
);

function RouteFailure() {
  return <div className="grid min-h-dvh place-items-center bg-canvas p-5 text-ink">
    <div role="alert" className="max-w-prose">
      <h1 className="text-[length:var(--text-h4)]">No se pudo abrir esta vista</h1>
      <p className="mt-3 text-ink-secondary">Se produjo un problema inesperado. Vuelve al inicio o recarga la página para intentarlo de nuevo.</p>
      <a href="/" className="mt-4 inline-flex min-h-11 items-center rounded-control px-3 underline outline-none focus-visible:ring-2 focus-visible:ring-primary">Volver al inicio</a>
    </div>
  </div>;
}

export function App({ router }: { router: ReturnType<typeof createBrowserRouter> }) {
  return <RouterProvider router={router} />;
}
