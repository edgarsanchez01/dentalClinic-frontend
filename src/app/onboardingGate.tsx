import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { OnboardingWizard } from '../components/onboarding/OnboardingWizard';
import { useAuthStore } from './authStore';
import { RequireAuth, RestoringScreen } from './guards';
import { useOnboardingStatus } from './useOnboardingStatus';

/**
 * Puerta de entrada a la app autenticada. Si la instalación todavía no está configurada,
 * cualquier visita a `/` se desvía al wizard; en caso contrario, exige sesión como siempre.
 */
export function OnboardingEntry({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const { data, isLoading } = useOnboardingStatus();

  if (status === 'restoring' || isLoading) {
    return <RestoringScreen />;
  }
  if (data?.status === 'AWAITING_FIRST_USER') {
    return <Navigate to="/onboarding" replace />;
  }
  return <RequireAuth>{children}</RequireAuth>;
}

/** `/onboarding`: solo accesible mientras la instalación no esté configurada. */
export function OnboardingRoute() {
  const { data, isLoading } = useOnboardingStatus();

  if (isLoading) {
    return <RestoringScreen />;
  }
  if (data?.status === 'COMPLETED') {
    return <Navigate to="/login" replace />;
  }
  return <OnboardingWizard />;
}