import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { odontogramApi, type Dentition, type ToothCondition, type ToothSurface } from '../../api/odontogram';
import { useAuthStore } from '../../app/authStore';
import { DentalChart } from './DentalChart';
import type { OdontogramView } from './odontogramUi';

/** Data adapter only. Reception never mounts a clinical query, editor or history reader. */
export function ReceptionOdontogramSection({ patientId }: { patientId: number }) {
  const user = useAuthStore(state => state.user);
  const id = useId();
  const [chosenDentition, setDentition] = useState<Dentition | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<OdontogramView>('chart');
  const query = useQuery({ queryKey: ['odontogram-reception-summary', user?.id, patientId],
    queryFn: () => odontogramApi.listReceptionSummary(patientId), enabled: user?.role === 'RECEPTIONIST', retry: false });
  const rows = query.data ?? [];
  const dentition = chosenDentition ?? (rows.length > 0 && rows.every(row => row.dentition === 'TEMPORARY') ? 'TEMPORARY' : 'PERMANENT');
  const surfaces: Record<number, Partial<Record<ToothSurface, ToothCondition>>> = Object.fromEntries(rows.map(row =>
    [row.toothFdi, Object.fromEntries(row.surfaces.map(surface => [surface.surface, surface.condition]))]));
  if (user?.role !== 'RECEPTIONIST') return null;
  return <section aria-labelledby={id} className="rounded-card bg-paper p-5 ring-1 ring-hairline">
    <h3 id={id}>Odontograma</h3><p className="dc-dental-hint">Resumen dental autorizado para recepción · Solo lectura. Sin observaciones privadas ni historial clínico.</p>
    {query.isPending ? <p role="status">Consultando resumen dental…</p> : null}
    {query.isError ? <p role="alert">No se pudo consultar el resumen dental. <button type="button" className="min-h-11 underline" onClick={() => void query.refetch()}>Reintentar resumen dental</button></p> : null}
    {query.data ? <DentalChart dentition={dentition} teeth={rows.map(row => ({ fdi: row.toothFdi, condition: row.condition, notes: undefined, treatmentCount: null }))}
      surfaces={surfaces} view={view} onViewChange={setView} selectedFdi={selected} onSelect={setSelected}
      onDentitionChange={next => { setDentition(next); setSelected(null); }} canReadNotes={false} canEdit={false}
      surfacesLoading={false} selectedRecord={undefined} treatments={[]} treatmentsLoading={false} treatmentsError={false}
      onReloadTreatments={() => {}} saving={false} onSaveTooth={null} onSaveSurface={null} /> : null}
  </section>;
}
