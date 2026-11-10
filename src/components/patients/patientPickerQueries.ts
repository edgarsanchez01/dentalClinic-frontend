import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { patientsApi } from '../../api/patients';

/** Wrappers choose compatibility; never reuse a paginated PageDto key for InfiniteData. */
export function usePatientPickerSearch(search: string, enabled: boolean, profile: 'r23' | 'shared' = 'r23') {
  return useInfiniteQuery({ queryKey: profile === 'r23'
    ? ['reception-financial-patient-search', search] : ['patients', 'combobox', 'search', search],
    queryFn: ({ pageParam }) => patientsApi.list({ search, page: pageParam, size: 10 }),
    initialPageParam: 0,
    getNextPageParam: last => last.page + 1 < last.totalPages ? last.page + 1 : undefined,
    retry: false, enabled });
}

/** Shared with existing financial callers; list results never seed this detail query. */
export function usePatientPickerSelection(id: number | null) {
  return useQuery({ queryKey: ['financial-patient', id], queryFn: () => patientsApi.get(id!), enabled: id !== null, retry: false });
}
