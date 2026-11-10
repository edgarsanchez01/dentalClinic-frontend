import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { schedulingApi } from '../../api/scheduling';
import { clinicToday } from './scheduleDates';

interface AvailabilityRequest { dentistId: number; from: string; duration: number }

/** Existing consultation state, shared independently of private schedules and editors. */
export function useScheduleAvailability(dentistId: number | undefined, timezone?: string) {
  const [date, setDate] = useState<string | null>(null);
  const [duration, setDuration] = useState('30'); // Consultation draft, never a generated slot.
  const [request, setRequest] = useState<AvailabilityRequest | null>(null);
  const [needsSearch, setNeedsSearch] = useState(false);
  const from = date ?? clinicToday(timezone);
  const availability = useQuery({
    queryKey: ['availability', request],
    queryFn: () => schedulingApi.availability(request!),
    enabled: request !== null && request.dentistId === dentistId,
  });
  // A changed draft never relabels old results, including late responses.
  const currentRequest = request && request.dentistId === dentistId && request.from === from && request.duration === Number(duration) ? request : null;
  const result = currentRequest && !availability.isFetching && !availability.isError && availability.data?.dentistId === currentRequest.dentistId ? availability.data : null;
  const slotsByDate = new Map<string, NonNullable<typeof result>['slots']>();
  for (const slot of [...(result?.slots ?? [])].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))) {
    const group = slotsByDate.get(slot.startDate) ?? [];
    group.push(slot);
    slotsByDate.set(slot.startDate, group);
  }
  return {
    from, duration, currentRequest, result, slotsByDate, availability, needsSearch,
    changeDate(value: string) { setDate(value); setRequest(null); },
    changeDuration(value: string) { setDuration(value); setRequest(null); },
    changeProfessional() { setRequest(null); setNeedsSearch(request !== null || needsSearch); },
    search() {
      if (dentistId === undefined || !from || !Number.isFinite(Number(duration)) || Number(duration) < 5 || availability.isFetching) return;
      if (currentRequest) void availability.refetch();
      else setRequest({ dentistId, from, duration: Number(duration) });
      setNeedsSearch(false);
    },
  };
}
