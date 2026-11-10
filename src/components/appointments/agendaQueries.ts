import { useQuery } from '@tanstack/react-query';

import {
  appointmentsApi,
  type AppointmentListParams,
  type AppointmentResponse,
  type PageDto,
} from '../../api/appointments';
import { sortAppointments } from './appointmentUi';

/**
 * El backend limita cada página a 100 citas. Para que la agenda de un rango no omita citas cuando
 * hay más de una página, se recorren todas las páginas y se deduplica por `id` (la paginación
 * puede repetir o saltar filas si la agenda cambia entre peticiones). No es un snapshot de BD;
 * el aviso de conteo parcial permite acotar y volver a consultar. El resultado es la unión ordenada.
 */
const MAX_PAGES = 100;

export function useAgendaAppointments(params: Omit<AppointmentListParams, 'page'>) {
  return useQuery({
    queryKey: ['appointments', params],
    queryFn: async ({ signal }): Promise<PageDto<AppointmentResponse>> => {
      const first = await appointmentsApi.list({ ...params, page: 0 }, signal);
      const pages: PageDto<AppointmentResponse>[] = [first];
      const limit = Math.min(first.totalPages, MAX_PAGES);
      for (let page = 1; page < limit; page += 1) {
        pages.push(await appointmentsApi.list({ ...params, page }, signal));
      }
      const byId = new Map<number, AppointmentResponse>();
      for (const page of pages) {
        for (const appointment of page.content) {
          byId.set(appointment.id, appointment);
        }
      }
      return {
        content: sortAppointments([...byId.values()]),
        page: 0,
        size: first.size,
        totalElements: first.totalElements,
        totalPages: first.totalPages,
      };
    },
  });
}
