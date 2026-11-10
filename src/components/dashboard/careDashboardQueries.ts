import { useQuery } from '@tanstack/react-query';
import { appointmentsApi, type AppointmentListParams } from '../../api/appointments';
import { careAppointmentParams, requireCarePage, type CareScope } from './careDashboardData';

export function useCareAppointments(scope: CareScope | null, filters: AppointmentListParams, enabled: boolean) {
  const params = scope ? careAppointmentParams(scope, filters) : filters;
  return useQuery({
    queryKey: ['appointments', 'dashboard', 'care', scope, params],
    queryFn: async () => {
      if (!scope) throw new Error('Falta el perfil vinculado.');
      return requireCarePage(await appointmentsApi.list(params), scope, params);
    },
    enabled: enabled && scope !== null, retry: false, refetchInterval: 60_000,
  });
}
