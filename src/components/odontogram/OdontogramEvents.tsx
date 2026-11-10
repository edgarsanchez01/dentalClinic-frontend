import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { odontogramApi, type OdontogramEventDto, type OdontogramHistoryFilters } from '../../api/odontogram';
import type { PageDto } from '../../api/appointments';
import { FormAlert } from '../auth/ui';
import { ToothHistoryTimeline } from './ToothHistoryTimeline';

export function OdontogramEvents({ patientId, filters = {}, enabled = true, timeZone = 'UTC' }: {
  patientId: number; filters?: OdontogramHistoryFilters; enabled?: boolean; timeZone?: string | undefined;
}) {
  const [page, setPage] = useState(0);
  const query = useQuery({ queryKey: ['odontogram-history', patientId, { ...filters, page, size: 20 }],
    queryFn: () => odontogramApi.history(patientId, { ...filters, page, size: 20 }), enabled, retry: false });
  if (!enabled) return null;
  return <div className="grid gap-3">
    {query.isPending ? <p role="status" className="text-ink-muted">Cargando historial dental…</p> : null}
    {query.isError ? <><FormAlert>{query.error instanceof Error ? query.error.message : 'No se pudo cargar el historial dental.'}</FormAlert>
      <button type="button" onClick={() => void query.refetch()} className="min-h-11 justify-self-start underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary">Reintentar historial dental</button></> : null}
    {query.data ? <HistoryEventPage data={query.data} onPageChange={setPage} timeZone={timeZone} /> : null}
  </div>;
}

export function HistoryEventPage({ data, onPageChange, timeZone }: {
  data: PageDto<OdontogramEventDto>; onPageChange: (page: number) => void; timeZone?: string | undefined;
}) {
  return <div className="grid gap-3">
    <ToothHistoryTimeline entries={data.content} timeZone={timeZone} />
    {data.totalPages > 1 ? <nav aria-label="Páginas del historial dental" className="flex flex-wrap items-center gap-3 text-[length:var(--text-body-sm)]">
      <button type="button" disabled={data.page === 0} onClick={() => onPageChange(data.page - 1)}
        className="min-h-11 rounded-control px-3 py-2 text-ink ring-1 ring-hairline outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60">Eventos más recientes</button>
      <p role="status">Página {data.page + 1} de {data.totalPages} · {data.totalElements} eventos</p>
      <button type="button" disabled={data.page + 1 >= data.totalPages} onClick={() => onPageChange(data.page + 1)}
        className="min-h-11 rounded-control px-3 py-2 text-ink ring-1 ring-hairline outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60">Eventos anteriores</button>
    </nav> : null}
  </div>;
}
