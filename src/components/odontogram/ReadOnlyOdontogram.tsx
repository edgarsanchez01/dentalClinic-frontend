import { useId, useState } from 'react';
import type { HistoricalSnapshotDto, HistoricalToothDto, ToothRecordDto } from '../../api/odontogram';
import { DentalChart, type ChartTooth } from './DentalChart';
import { OdontogramEvents } from './OdontogramEvents';
import { allowedSurfacesFor, conditionLabel, historyTimestamp, surfaceLabel, type OdontogramView } from './odontogramUi';

/** No editable record is synthesized from an incomplete historical DTO. */
export function ReadOnlyOdontogram({ snapshot, records, patientId, timeZone = 'UTC' }: {
  snapshot?: HistoricalSnapshotDto | undefined;
  records?: ToothRecordDto[] | undefined;
  patientId: number;
  timeZone?: string | undefined;
}) {
  const [dentition, setDentition] = useState<'PERMANENT' | 'TEMPORARY'>('PERMANENT');
  const [view, setView] = useState<OdontogramView>('chart');
  const [selected, setSelected] = useState<number | null>(null);
  const teeth: ChartTooth[] = snapshot ? snapshot.teeth.map((tooth) => ({
    fdi: tooth.toothFdi,
    condition: tooth.condition.knowledge === 'KNOWN' ? tooth.condition.value : null,
    conditionText: tooth.registration === 'NOT_REGISTERED' ? 'Sin registro previo' : 'No reconstruible',
    notes: tooth.notes.knowledge === 'KNOWN' ? tooth.notes.value ?? undefined : undefined,
    notesText: tooth.notes.knowledge === 'KNOWN' ? tooth.notes.value ?? 'Sin observaciones registradas' : 'No reconstruible',
    treatmentCount: tooth.treatments.knowledge === 'KNOWN' ? tooth.treatments.treatmentIds?.length ?? null : null,
  })) : (records ?? []).map((tooth) => ({ fdi: tooth.toothFdi, condition: tooth.condition,
    notes: tooth.notes, treatmentCount: tooth.treatmentIds.length }));
  const surfaces = Object.fromEntries(snapshot ? snapshot.teeth.map((tooth) => [tooth.toothFdi,
    Object.fromEntries(tooth.surfaces.filter((s) => s.condition.knowledge === 'KNOWN' && s.condition.value !== null)
      .map((s) => [s.surface, s.condition.value!]))]) : (records ?? []).map((tooth) => [tooth.toothFdi,
      Object.fromEntries(tooth.surfaces.map((s) => [s.surface, s.condition]))]));

  return <div className="min-w-0">
    {snapshot ? <p className="mt-2 text-[length:var(--text-body-sm)] text-ink-secondary" data-completeness={snapshot.completeness.status}>
      {snapshot.completeness.status === 'COMPLETE' ? 'Reconstrucción completa según los registros disponibles.'
        : snapshot.completeness.status === 'PARTIAL' ? 'Reconstrucción parcial: los datos faltantes no se completan con el estado actual.'
          : 'No reconstruible: no hay evidencia suficiente para establecer el estado.'}
    </p> : null}
    {teeth.length === 0 ? <p className="mt-3 text-ink-secondary">Sin registros de piezas en esta consulta. No implica piezas sanas ni permite reconstruir datos ausentes.</p> : null}
    <DentalChart dentition={dentition} teeth={teeth} surfaces={surfaces} canReadNotes view={view}
      onViewChange={setView} selectedFdi={selected} onSelect={setSelected}
      onDentitionChange={(next) => { setDentition(next); setSelected(null); }} surfacesLoading={false}
      canEdit={false} selectedRecord={snapshot ? undefined : records?.find((tooth) => tooth.toothFdi === selected)}
      treatments={[]} treatmentsLoading={false} treatmentsError={false} onReloadTreatments={() => {}}
      saving={false} onSaveTooth={null} onSaveSurface={null} historical={snapshot !== undefined}
      renderDetail={snapshot ? (fdi) => <HistoricalToothDetail fdi={fdi}
        tooth={snapshot.teeth.find((tooth) => tooth.toothFdi === fdi)} onClose={() => setSelected(null)} timeZone={timeZone} /> : undefined}
      renderHistory={snapshot ? undefined : (enabled) => selected !== null
        ? <OdontogramEvents key={selected} patientId={patientId} filters={{ toothFdi: selected }} enabled={enabled} timeZone={timeZone} /> : null} />
  </div>;
}

function HistoricalToothDetail({ fdi, tooth, onClose, timeZone }: {
  fdi: number; tooth: HistoricalToothDto | undefined; onClose: () => void; timeZone: string;
}) {
  const id = useId();
  return <section aria-labelledby={id} className="border-t border-hairline pt-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h4 id={id} tabIndex={-1} className="font-medium text-ink">Pieza {fdi} · consulta histórica</h4>
      <button type="button" onClick={onClose} className="min-h-11 px-2 text-ink-secondary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary">Cerrar detalle histórico</button>
    </div>
    {tooth?.registration === 'NOT_REGISTERED' ? <p className="mt-2 text-ink-secondary">Sin registro previo: no constaba un registro de esta pieza en ese instante.</p> : null}
    <dl className="mt-3 grid gap-3 text-[length:var(--text-body-sm)]">
      <div><dt className="font-medium text-ink">Condición</dt><dd className="text-ink-secondary" data-knowledge={tooth?.condition.knowledge ?? 'UNKNOWN'}>
        {tooth?.condition.knowledge === 'KNOWN' && tooth.condition.value !== null ? `${conditionLabel(tooth.condition.value)} · Conocido` : 'No reconstruible'}
      </dd></div>
      <div><dt className="font-medium text-ink">Observaciones históricas</dt><dd className="whitespace-pre-wrap break-words text-ink-secondary" data-knowledge={tooth?.notes.knowledge ?? 'UNKNOWN'}>
        {tooth?.notes.knowledge === 'KNOWN' ? tooth.notes.value ?? 'Sin observaciones registradas (valor vacío conocido).' : 'No reconstruible'}
      </dd>{tooth?.notes.knownFrom ? <dd className="mt-1 text-ink-muted">Conocido desde {historyTimestamp(tooth.notes.knownFrom, timeZone)}</dd> : null}</div>
      <div><dt className="font-medium text-ink">Vínculos históricos con tratamientos</dt><dd className="text-ink-secondary" data-knowledge={tooth?.treatments.knowledge ?? 'UNKNOWN'}>
        {tooth?.treatments.knowledge === 'KNOWN' && tooth.treatments.treatmentIds !== null
          ? tooth.treatments.treatmentIds.length ? `Conocidos: ${tooth.treatments.treatmentIds.map((item) => `#${item}`).join(', ')}` : 'Sin vínculos (conjunto vacío conocido).'
          : tooth?.treatments.knowledge === 'PARTIAL' ? 'Parcial: el conjunto completo no es reconstruible.' : 'No reconstruible'}
      </dd>{tooth?.treatments.knowledge === 'PARTIAL' ? <>
        {tooth.treatments.knownLinkedIds.length ? <dd className="mt-1 text-ink-secondary">Vínculos conocidos: {tooth.treatments.knownLinkedIds.map((item) => `#${item}`).join(', ')}.</dd> : null}
        {tooth.treatments.knownUnlinkedIds.length ? <dd className="mt-1 text-ink-secondary">Desvinculaciones conocidas: {tooth.treatments.knownUnlinkedIds.map((item) => `#${item}`).join(', ')}.</dd> : null}
        <dd className="mt-1 text-ink-muted">La ausencia de otros eventos no demuestra que no existan otros vínculos.</dd>
      </> : null}</div>
    </dl>
    <h5 className="mt-5 font-medium text-ink">Superficies históricas</h5>
    <ul className="mt-2 grid gap-2 sm:grid-cols-2">
      {allowedSurfacesFor(fdi).map((surface) => {
        const data = tooth?.surfaces.find((item) => item.surface === surface);
        return <li key={surface} className="border-t border-hairline py-2 text-[length:var(--text-body-sm)]">
          <span className="font-medium text-ink">{surfaceLabel(surface)}</span>
          <p className="text-ink-secondary">{data?.registration === 'NOT_REGISTERED' ? 'Sin registro previo'
            : data?.condition.knowledge === 'KNOWN' && data.condition.value !== null ? conditionLabel(data.condition.value) : 'No reconstruible'}</p>
          <p className="whitespace-pre-wrap break-words text-ink-secondary">Observaciones: {data?.notes.knowledge === 'KNOWN'
            ? data.notes.value ?? 'Sin observaciones registradas (valor vacío conocido).' : 'No reconstruible'}</p>
        </li>;
      })}
    </ul>
  </section>;
}
