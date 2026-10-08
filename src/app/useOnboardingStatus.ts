import { useQuery } from '@tanstack/react-query';

import { onboardingApi, type OnboardingStatus } from '../api/onboarding';

/**
 * Estado de onboarding, público (la instalación aún no tiene usuarios). Se cachea de forma
 * indefinida porque solo cambia una vez, y es el propio wizard quien lo invalida tras
 * completar la configuración. No se infiere de `User`/`Clinic`.
 */
export function useOnboardingStatus() {
  return useQuery<OnboardingStatus>({
    queryKey: ['onboarding', 'status'],
    queryFn: onboardingApi.status,
    staleTime: Infinity,
    retry: false,
  });
}