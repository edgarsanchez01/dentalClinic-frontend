import type { QueryClient } from '@tanstack/react-query';
import type { AppointmentListParams, AppointmentResponse, PageDto } from '../../api/appointments';

/** Only patch existing rows. Never append a completed visit to an unrelated/partial page. */
export function reflectCompletionInAgenda(client: QueryClient, result: AppointmentResponse) {
  for (const [key, old] of client.getQueriesData<PageDto<AppointmentResponse>>({ queryKey: ['appointments'] })) {
    if (!old?.content?.some(item => item.id === result.id)) continue;
    const filter = key[1] as AppointmentListParams | undefined;
    const remove = Boolean(filter?.status && filter.status !== 'COMPLETED');
    const content = remove ? old.content.filter(item => item.id !== result.id) :
      old.content.map(item => item.id === result.id ? result : item);
    client.setQueryData(key, { ...old, content,
      totalElements: remove ? Math.max(0, old.totalElements - 1) : old.totalElements });
  }
  // Refetch remains authoritative for totals, filters and paginated membership.
  void client.invalidateQueries({ queryKey: ['appointments'] });
}
