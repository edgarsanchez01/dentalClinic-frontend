import type { Dentition, ToothCondition, ToothRecordDto, ToothSurface } from '../../api/odontogram';
import type { TreatmentDto } from '../../api/treatments';
import type { OdontogramView } from './odontogramUi';
import {
  CONDITION_ORDER,
  allowedSurfacesFor,
  archLayout,
  closingSurfaceFor,
  conditionChipClass,
  conditionLabel,
  dentitionLabel,
  dentitionOf,
  quadrantLabelOf,
  surfaceLabel,
} from './odontogramUi';
import { ToothEditor, type SurfaceSaveData, type ToothSaveData } from './ToothEditor';
import { ToothHistoryTimeline } from './ToothHistoryTimeline';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { DentalArcades } from './DentalArcades';
import type { ChartTooth } from './dentalChartModel';
export type { ChartTooth } from './dentalChartModel';

/**
 * Vista presentacional del odontograma (§14): grafico clickeable con arcadas (14.1-14.4),
 * vista de lista accesible alternativa (14.5) y detalle de la pieza seleccionada.
 *
 * No consulta datos: recibe piezas registradas, superficies y callbacks. Las piezas sin
 * registro muestran el contorno atenuado ("ausencia de registro ≠ Sano"); con `canEdit`
 * (DENTIST, F7.4.3.4) tambien son seleccionables para registrar su estado.
 */
export interface DentalChartProps {
  layout?: 'stacked' | 'expanded';
  onDirtyChange?: (dirty: boolean) => void;
  integrated?: boolean;
  historical?: boolean;
  renderDetail?: ((fdi: number) => ReactNode) | undefined;
  renderHistory?: ((enabled: boolean) => ReactNode) | undefined;
  writeBlocked?: boolean;
  dentition: Dentition;
  teeth: ChartTooth[];
  /** Superficies registradas por pieza: superficie → condición (las ausentes = sin registro). */
  surfaces: Record<number, Partial<Record<ToothSurface, ToothCondition>>>;
  canReadNotes: boolean;
  view: OdontogramView;
  onViewChange: (view: OdontogramView) => void;
  selectedFdi: number | null;
  onSelect: (fdi: number | null) => void;
  onDentitionChange: (dentition: Dentition) => void;
  /** Mientras se cargan superficies del resumen propio (PATIENT). */
  surfacesLoading: boolean;
  surfacesError?: boolean;
  onReloadSurfaces?: () => void;
  /** Modo edición clínica (OWNER/DENTIST, F7.4.3.4): habilita registrar/actualizar. */
  canEdit: boolean;
  /** Registro completo de la pieza seleccionada (staff): notas, historial y superficies. */
  selectedRecord: ToothRecordDto | undefined;
  /** Tratamientos del paciente actual para vincular a la pieza (F7.4.4). */
  treatments: TreatmentDto[];
  treatmentsLoading: boolean;
  treatmentsError: boolean;
  onReloadTreatments: () => void;
  /** Hay un guardado (pieza o superficie) en curso. */
  saving: boolean;
  onSaveTooth: ((fdi: number, data: ToothSaveData) => void) | null;
  onSaveSurface: ((fdi: number, surface: ToothSurface, data: SurfaceSaveData) => void) | null;
}

const toggle =
  'min-h-11 rounded-xs px-3 py-1.5 text-[length:var(--text-body-sm)] outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';
const toggleOn = 'bg-primary text-paper';
const toggleOff = 'bg-sunken text-ink-muted hover:text-ink';

export function DentalChart({
  layout = 'expanded',
  onDirtyChange,
  integrated = false,
  dentition,
  teeth,
  surfaces,
  canReadNotes,
  view,
  onViewChange,
  selectedFdi,
  onSelect,
  onDentitionChange,
  surfacesLoading,
  surfacesError = false,
  onReloadSurfaces,
  canEdit,
  selectedRecord,
  treatments,
  treatmentsLoading,
  treatmentsError,
  onReloadTreatments,
  saving,
  onSaveTooth,
  onSaveSurface,
  historical = false,
  renderDetail,
  renderHistory,
  writeBlocked = false,
}: DentalChartProps) {
  const detailId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const previousSelection = useRef(selectedFdi);
  function select(fdi: number | null) {
    if (fdi !== null) trigger.current = document.activeElement as HTMLElement | null;
    onSelect(fdi);
  }
  useEffect(() => {
    if (previousSelection.current === selectedFdi) return;
    previousSelection.current = selectedFdi;
    if (selectedFdi !== null) {
      const heading = root.current?.querySelector<HTMLElement>('.dc-dental-detail h3, .dc-dental-detail h4');
      heading?.focus({ preventScroll: true });
      if (heading) {
        const bounds = heading.getBoundingClientRect();
        // Keep the map/editor workspace stationary when the contextual heading is already visible.
        if (bounds.top < 88 || bounds.bottom > window.innerHeight - 88)
          heading.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
      }
    } else if (trigger.current?.isConnected) trigger.current.focus();
  }, [selectedFdi]);
  const byFdi = new Map(teeth.map((tooth) => [tooth.fdi, tooth]));
  const selected = selectedFdi !== null ? byFdi.get(selectedFdi) ?? null : null;
  const detailFdi = selectedFdi;

  return (
    <div ref={root} className="mt-4 dc-dental-chart" data-layout={layout}>
    <div className="dc-dental-layout">
      <div className="dc-chart-map">
      <Controls
        dentition={dentition}
        view={view}
        onViewChange={onViewChange}
        onDentitionChange={onDentitionChange}
      />

      {view === 'chart' ? (
        <DentalArcades dentition={dentition} teeth={teeth} selectedFdi={selectedFdi} onSelect={select} historical={historical} />
      ) : (
        <ListView
          dentition={dentition}
          byFdi={byFdi}
          surfaces={surfaces}
          canReadNotes={canReadNotes}
          selectedFdi={selectedFdi}
          onSelect={select}
          canEdit={canEdit}
          historical={historical}
        />
      )}

      <p className="dc-dental-hint">{historical ? 'Consulta el detalle: sin registro previo no significa sano. «?» indica información no reconstruible.' : 'Consulta el detalle de la pieza: sin registro no significa sano. Sano confirmado requiere una condición registrada.'} Representación esquemática.</p>
      <details><summary>Leyenda de condiciones</summary><Legend historical={historical} /></details>
      </div>

      <div className="dc-dental-detail">{detailFdi !== null ? (
        canEdit ? (
          <ToothEditor
            progressive
            onDirtyChange={onDirtyChange}
            integrated={integrated}
            key={`pieza-${detailFdi}`}
            fdi={detailFdi}
            record={selectedRecord}
            treatments={treatments}
            treatmentsLoading={treatmentsLoading}
            treatmentsError={treatmentsError}
            onReloadTreatments={onReloadTreatments}
            saving={saving}
            onSaveTooth={(data) => onSaveTooth?.(detailFdi, data)}
            onSaveSurface={(surface, data) => onSaveSurface?.(detailFdi, surface, data)}
            onClose={() => select(null)}
            renderHistory={renderHistory}
            writeBlocked={writeBlocked}
          />
        ) : renderDetail ? renderDetail(detailFdi) : (
          <ToothDetail
            tooth={selected ?? { fdi: detailFdi, condition: null, conditionText: historical ? 'No reconstruible' : 'Sin registro', notes: undefined, treatmentCount: null }}
            record={selectedRecord}
            surfaces={surfaces[detailFdi]}
            canReadNotes={canReadNotes}
            surfacesLoading={surfacesLoading}
            surfacesError={surfacesError}
            onReloadSurfaces={onReloadSurfaces}
            onClose={() => select(null)}
            detailId={detailId}
            renderHistory={renderHistory}
          />
        )
      ) : <div className="dc-tooth-empty"><h4>Selecciona una pieza</h4><p>{canEdit ? 'Consulta su condición o registra un hallazgo. Seleccionar no guarda cambios.' : 'Consulta las condiciones y superficies disponibles. Solo lectura.'}</p></div>}</div>
    </div>
    </div>
  );
}

function Controls({
  dentition,
  view,
  onViewChange,
  onDentitionChange,
}: Pick<DentalChartProps, 'dentition' | 'view' | 'onViewChange' | 'onDentitionChange'>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-control bg-sunken p-1" role="group" aria-label="Dentición">
        {(['PERMANENT', 'TEMPORARY'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={dentition === option}
            className={`${toggle} ${dentition === option ? toggleOn : toggleOff}`}
            onClick={() => {
              if (dentition !== option) onDentitionChange(option);
            }}
          >
            {dentitionLabel(option)}
          </button>
        ))}
      </div>

      <div className="flex overflow-hidden rounded-control bg-sunken p-1" role="group" aria-label="Vista del odontograma">
        {(
          [
            ['chart', 'Gráfico'],
            ['list', 'Lista'],
          ] as const
        ).map(([option, label]) => (
          <button
            key={option}
            type="button"
            aria-pressed={view === option}
            className={`${toggle} ${view === option ? toggleOn : toggleOff}`}
            onClick={() => {
              if (view !== option) onViewChange(option);
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ListView({
  dentition,
  byFdi,
  surfaces,
  canReadNotes,
  selectedFdi,
  onSelect,
  canEdit,
  historical,
}: {
  dentition: Dentition;
  byFdi: Map<number, ChartTooth>;
  surfaces: Record<number, Partial<Record<ToothSurface, ToothCondition>>>;
  canReadNotes: boolean;
  selectedFdi: number | null;
  onSelect: (fdi: number | null) => void;
  canEdit: boolean;
  historical: boolean;
}) {
  const fdis = [...archLayout(dentition).upper, ...archLayout(dentition).lower].flatMap(
    (row) => row.teeth,
  );
  return (
    <div className="overflow-x-auto rounded-control ring-1 ring-hairline">
      <table className="w-full min-w-[36rem] border-collapse text-left text-[length:var(--text-body-sm)]">
        <caption className="sr-only">
          Odontograma — dentición {dentitionLabel(dentition)}: pieza, condición y superficies
        </caption>
        <thead>
          <tr className="border-b border-hairline text-[length:var(--text-caption)] uppercase tracking-[0.05em] text-ink-muted">
            <th scope="col" className="px-3 py-2 font-medium">
              Pieza
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Condición
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Superficies
            </th>
            {canReadNotes ? (
              <th scope="col" className="px-3 py-2 font-medium">
                Observaciones
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {fdis.map((fdi) => {
            const tooth = byFdi.get(fdi);
            const recordedSurfaces = surfaces[fdi] ?? {};
            const surfaceText =
              Object.keys(recordedSurfaces).length === 0
                ? historical ? 'No reconstruible' : 'Todas sin registro'
                : allowedSurfacesFor(fdi)
                    .filter((surface) => recordedSurfaces[surface] !== undefined)
                    .map(
                      (surface) => `${surfaceLabel(surface)}: ${conditionLabel(recordedSurfaces[surface]!)}`,
                    )
                    .join(' · ') + (historical && Object.keys(recordedSurfaces).length < allowedSurfacesFor(fdi).length
                      ? ' · Restantes: no reconstruibles' : '');
            return (
              <tr
                key={fdi}
                className={`border-b border-hairline last:border-b-0 ${selectedFdi === fdi ? 'bg-primary-subtle' : ''}`}
              >
                <td className="px-3 py-2">
                  {tooth ? (
                    <button
                      type="button"
                      aria-pressed={selectedFdi === fdi}
                      onClick={() => onSelect(fdi)}
                      className="font-medium tabular-nums text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {fdi} · {quadrantLabelOf(fdi)}
                    </button>
                   ) : (
                    <button
                      type="button"
                       aria-label={historical || !canEdit ? `Consultar pieza ${fdi}` : `Registrar pieza ${fdi}`}
                      aria-pressed={selectedFdi === fdi}
                      onClick={() => onSelect(fdi)}
                      className="font-medium tabular-nums text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {fdi} · {quadrantLabelOf(fdi)} · {historical ? 'No reconstruible' : 'sin registro'}
                    </button>
                   )}
                </td>
                <td className="px-3 py-2">
                  {tooth ? (
                    <span className={`rounded-xs px-2 py-0.5 text-[length:var(--text-caption)] ${tooth.condition ? conditionChipClass(tooth.condition) : 'text-ink-muted'}`}>
                      {tooth.condition ? conditionLabel(tooth.condition) : tooth.conditionText ?? 'No reconstruible'}
                    </span>
                  ) : (
                    <span className="text-ink-muted">{historical ? 'No reconstruible' : 'Sin registro'}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-ink-secondary">{surfaceText}</td>
                {canReadNotes ? (
                  <td className="px-3 py-2 text-ink-secondary whitespace-pre-wrap break-words">{tooth?.notesText ?? tooth?.notes ?? (historical ? 'No reconstruible' : '—')}</td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Legend({ historical }: { historical: boolean }) {
  return (
    <div aria-label="Leyenda de condiciones" className="rounded-control bg-sunken p-3">
      <p className="text-[length:var(--text-caption)] font-medium uppercase tracking-[0.05em] text-ink-muted">
        Leyenda
      </p>
      <p className="mt-1 text-[length:var(--text-caption)] text-ink-muted">
        El color es decorativo: cada condición se indica siempre también con su etiqueta de texto.
        {historical ? ' Sin registro previo indica ausencia de registro demostrada; «?» indica información no reconstruible. Ninguno equivale a sano confirmado.'
          : ' Sin registro indica ausencia de una condición registrada. Consulta el detalle de cada pieza. Solo una condición Sano registrada se presenta como sano confirmado; nunca se deduce de la ausencia de datos.'}
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {CONDITION_ORDER.map((condition) => (
          <li
            key={condition}
            className={`rounded-xs px-2 py-1 text-[length:var(--text-caption)] ${conditionChipClass(condition)}`}
          >
            {condition === 'HEALTHY' ? 'Sano confirmado' : conditionLabel(condition)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ToothDetail({
  tooth,
  record,
  surfaces,
  canReadNotes,
  surfacesLoading,
  surfacesError,
  onReloadSurfaces,
  onClose,
  detailId,
  renderHistory,
}: {
  tooth: ChartTooth;
  record: ToothRecordDto | undefined;
  surfaces: Partial<Record<ToothSurface, ToothCondition>> | undefined;
  canReadNotes: boolean;
  surfacesLoading: boolean;
  surfacesError: boolean;
  onReloadSurfaces: (() => void) | undefined;
  onClose: () => void;
  detailId: string;
  renderHistory: ((enabled: boolean) => ReactNode) | undefined;
}) {
  const closing = closingSurfaceFor(tooth.fdi);
  const lateral = allowedSurfacesFor(tooth.fdi).filter((surface) => surface !== closing);

  return (
    <section
      aria-labelledby={detailId}
      className="rounded-control bg-input-fill p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={detailId} tabIndex={-1} className="text-[length:var(--text-body-app)] font-medium text-ink">
            Pieza {tooth.fdi}
          </h3>
          <p className="mt-0.5 text-[length:var(--text-caption)] text-ink-muted">
            {quadrantLabelOf(tooth.fdi)} · {dentitionLabel(dentitionOf(tooth.fdi))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-xs px-2 py-1 text-[length:var(--text-caption)] ${tooth.condition ? conditionChipClass(tooth.condition) : 'text-ink-muted'}`}>
            {tooth.condition ? conditionLabel(tooth.condition) : tooth.conditionText ?? 'No reconstruible'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-xs px-2 text-[length:var(--text-caption)] text-ink-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-primary"
          >
            Cerrar
          </button>
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[length:var(--text-caption)] font-medium uppercase tracking-[0.05em] text-ink-muted">
          Superficies
        </p>
        {surfacesLoading ? (
          <p className="mt-2 text-[length:var(--text-caption)] text-ink-muted">Cargando superficies…</p>
        ) : surfacesError ? <p role="alert">No se pudieron consultar las superficies. <button type="button" onClick={onReloadSurfaces}>Reintentar superficies</button></p> : (
          <ul className="mt-2 grid max-w-[22rem] grid-cols-3 gap-1.5">
            <li className="col-span-3">
              <SurfaceCell label={surfaceLabel(closing)} condition={surfaces?.[closing]} />
            </li>
            {lateral.map((surface) => (
              <li key={surface}>
                <SurfaceCell label={surfaceLabel(surface)} condition={surfaces?.[surface]} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {canReadNotes && record ? (
        <div className="mt-4">
          <p className="text-[length:var(--text-caption)] font-medium uppercase tracking-[0.05em] text-ink-muted">
            Historial
          </p>
          <div className="mt-2">
            {renderHistory ? renderHistory(true) : <ToothHistoryTimeline record={record} />}
          </div>
        </div>
      ) : null}

      {canReadNotes ? (
        <p className="mt-3 text-[length:var(--text-body-sm)] text-ink-secondary">
          <span className="font-medium text-ink-muted">Observaciones: </span>
          {tooth.notesText ?? (tooth.notes || 'Sin observaciones.')}
        </p>
      ) : null}

      {canReadNotes && tooth.treatmentCount !== null && tooth.treatmentCount > 0 ? (
        <p className="mt-1 text-[length:var(--text-body-sm)] text-ink-secondary">
          Tratamientos vinculados: {tooth.treatmentCount}
        </p>
      ) : null}
    </section>
  );
}

function SurfaceCell({
  label,
  condition,
}: {
  label: string;
  condition: ToothCondition | undefined;
}) {
  return (
    <div
      className={`grid place-items-center rounded-xs px-2 py-1.5 text-center text-[length:var(--text-caption)] ${
        condition ? conditionChipClass(condition) : 'border border-dashed border-hairline text-ink-muted'
      }`}
    >
      <span>{label}</span>
      <span className="font-medium">{condition ? conditionLabel(condition) : 'Sin registro'}</span>
    </div>
  );
}
