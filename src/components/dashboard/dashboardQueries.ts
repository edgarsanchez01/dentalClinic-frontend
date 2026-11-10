import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { appointmentsApi, type AppointmentListParams } from '../../api/appointments';
import { requireDashboardPage } from './dashboardData';

export function useDashboardClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, []);
  return now;
}

export function useDashboardAppointments(params: AppointmentListParams, enabled: boolean) {
  return useQuery({
    // Shares the appointments invalidation prefix, but not the agenda's all-pages result shape.
    queryKey: ['appointments', 'dashboard', params],
    queryFn: async () => requireDashboardPage(await appointmentsApi.list(params)),
    enabled, retry: false, refetchInterval: 60_000,
  });
}
