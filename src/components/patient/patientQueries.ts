import { useQuery } from '@tanstack/react-query';
import { schedulingApi } from '../../api/scheduling';

export function usePatientZone() {
  return useQuery({ queryKey: ['booking-policy'], queryFn: async () => {
    const policy = await schedulingApi.getPolicy();
    if (!policy.timezone) throw new Error('No se pudo comprobar la hora de la clínica. No mostraremos fechas con una zona distinta.');
    try { new Intl.DateTimeFormat('es-MX', { timeZone: policy.timezone }).format(); }
    catch { throw new Error('No se pudo comprobar la hora de la clínica. No mostraremos fechas con una zona distinta.'); }
    return policy;
  }, retry: false });
}
