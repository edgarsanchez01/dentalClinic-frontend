import { useQuery } from '@tanstack/react-query';
import { catalogApi } from '../../api/catalog';

export type ServiceFilterValue = 'all' | 'active' | 'inactive';

export function useServiceList(filter: ServiceFilterValue) {
  return useQuery({ queryKey: ['services', 'list', filter],
    queryFn: () => catalogApi.list(filter === 'all' ? undefined : filter === 'active') });
}
