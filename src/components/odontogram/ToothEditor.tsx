import { useEffect, useId, useState, type ReactNode } from 'react';

import type { ToothCondition, ToothRecordDto, ToothSurface, ToothSurfaceDto } from '../../api/odontogram';
import { useUnsavedChanges } from '../../app/unsavedChanges';
import type { TreatmentDto } from '../../api/treatments';
import { treatmentStatusLabel } from '../patients/treatmentUi';
import {
  CONDITION_ORDER,
  allowedSurfacesFor,
  closingSurfaceFor,
  conditionChipClass,
  conditionLabel,
  dentitionLabel,
  dentitionOf,
  quadrantLabelOf,
  surfaceLabel,
} from './odontogramUi';
import { ToothHistoryTimeline } from './ToothHistoryTimeline';

/** Contenido editable que se envia al guardar una pieza (F7.4.3.4) con sus tratamientos (F7.4.4). */
export interface ToothSaveData {
  condition: ToothCondition;
  notes: string;
  treatmentIds: number[];
}

/** Contenido editable de una superficie; no incluye tratamientos (F7.4.3.4). */
export interface SurfaceSaveData {
  condition: ToothCondition;
  notes: string;
}

interface SurfaceDraft {
  condition: ToothCondition | '';
  notes: string;
}

const TABS = [
  { value: 'edit', label: 'Editar' },
  { value: 'history', label: 'Historial' },
] as const;

type ToothTab = (typeof TABS)[number]['value'];


/** Editor clinico de pieza y superficies (OWNER/DENTIST): creador/actualizador explicito. */
export function ToothEditor({
  progressive = false,
  onDirtyChange,
  integrated = false,
  fdi,
  record,
  treatments,
  treatmentsLoading,
  treatmentsError,
  onReloadTreatments,
  saving,
  onSaveTooth,
  onSaveSurface,
  onClose,
  renderHistory,
  writeBlocked = false,
}: {
  progressive?: boolean;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
  integrated?: boolean;
  fdi: number;
  record: ToothRecordDto | undefined;
  /** Tratamientos del paciente actual (F7.4.4); solo del paciente de la seccion. */
  treatments: TreatmentDto[];
  treatmentsLoading: boolean;
  treatmentsError: boolean;
  onReloadTreatments: () => void;
  saving: boolean;
  onSaveTooth: (data: ToothSaveData) => void;
  onSaveSurface: (surface: ToothSurface, data: SurfaceSaveData) => void;
  onClose: () => void;
  renderHistory?: ((enabled: boolean) => ReactNode) | undefined;
  writeBlocked?: boolean;
}) {
  const headingId = useId();
  const SurfaceContainer = integrated || progressive ? 'details' : 'div';
  const LinksContainer = progressive ? 'details' : 'div';
  const [toothCondition, setToothCondition] = useState<ToothCondition | ''>(record?.condition ?? '');
  const [toothNotes, setToothNotes] = useState(record?.notes ?? '');
  const [surfaceDrafts, setSurfaceDrafts] = useState<Record<ToothSurface, SurfaceDraft>>(() =>
    initSurfaceDrafts(fdi, record),
  );
  const [treatmentIds, setTreatmentIds] = useState<number[]>(() => dedupeIds(record?.treatmentIds ?? []));
  const [tab, setTab] = useState<ToothTab>('edit');
  const [selectedSurface, setSelectedSurface] = useState<ToothSurface>(closingSurfaceFor(fdi));

  const savedSurfaceDrafts = initSurfaceDrafts(fdi, record);

  const dirty =
    toothCondition !== (record?.condition ?? '') ||
    toothNotes !== (record?.notes ?? '') ||
    !sameIds(treatmentIds, dedupeIds(record?.treatmentIds ?? [])) ||
    Object.keys(savedSurfaceDrafts).some((key) => {
      const surface = key as ToothSurface;
      const draft = surfaceDrafts[surface];
       const baseline = savedSurfaceDrafts[surface];
      return draft.condition !== baseline.condition || draft.notes !== baseline.notes;
    });

  useUnsavedChanges(dirty);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);

  const surfacesByType = new Map(record ? record.surfaces.map((s) => [s.surface, s]) : []);
  const validSurfaces = allowedSurfacesFor(fdi);
  const closing = closingSurfaceFor(fdi);
  const surfaceOrder = [closing, ...validSurfaces.filter((surface) => surface !== closing)];

  const canSaveTooth =
    toothCondition !== '' && !saving && !writeBlocked && !treatmentsLoading && !treatmentsError;

  // No se pierden las relaciones ya existentes: mientras los tratamientos no esten cargados
  // correctamente (cargando o error) el guardado queda bloqueado y la seleccion se conserva.
  function toggleTreatment(id: number): void {
    setTreatmentIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function moveTab(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next: ToothTab = tab === 'edit' ? 'history' : 'edit';
    setTab(next);
    document.getElementById(`tooth-tab-${next}`)?.focus();
  }

  return (
    <section aria-labelledby={headingId} className="rounded-control bg-paper p-4 ring-1 ring-hairline dc-piece-editor">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={headingId} tabIndex={-1} className="text-[length:var(--text-body-app)] font-medium text-ink">
            Pieza {fdi}
          </h3>
          <p className="mt-0.5 text-[length:var(--text-caption)] text-ink-muted">
            {quadrantLabelOf(fdi)} · {dentitionLabel(dentitionOf(fdi))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {record ? (
            <span className={`rounded-xs px-2 py-1 text-[length:var(--text-caption)] ${conditionChipClass(record.condition)}`}>
              {conditionLabel(record.condition)}
            </span>
          ) : (
            <span className="rounded-xs border border-dashed border-hairline px-2 py-1 text-[length:var(--text-caption)] text-ink-muted">
              Sin registro
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={`Cerrar edición de la pieza ${fdi}`}
            className="min-h-10 rounded-xs px-2 text-[length:var(--text-caption)] text-ink-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-primary"
          >
            Cerrar
          </button>
        </div>
      </div>

      {!progressive ? <div
        role="tablist"
        aria-label={`Panel de la pieza ${fdi}`}
        onKeyDown={moveTab}
        className="mt-4 flex gap-1 border-b border-hairline"
      >
        {TABS.map((option) => {
          const selected = tab === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              id={`tooth-tab-${option.value}`}
              aria-selected={selected}
              aria-controls={`tooth-tabpanel-${option.value}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(option.value)}
              className={`-mb-px min-h-10 px-3 text-[length:var(--text-body-sm)] outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                selected
                  ? 'border-b-2 border-primary font-medium text-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div> : null}

      <div
        role={progressive ? undefined : 'tabpanel'}
        id="tooth-tabpanel-edit"
        aria-labelledby={progressive ? undefined : 'tooth-tab-edit'}
        hidden={tab !== 'edit'}
        className="mt-3"
      >
        <form
          className="grid gap-3"
          onSubmit={(event) => {
          event.preventDefault();
          if (canSaveTooth) {
            onSaveTooth({
              condition: toothCondition as ToothCondition,
              notes: toothNotes,
              treatmentIds: dedupeIds(treatmentIds),
            });
          }
        }}
      >
        <div>
          <label
            htmlFor="odontogram-tooth-condition"
            className="block text-[length:var(--text-body-sm)] font-medium text-ink"
          >
            Condición de la pieza
          </label>
          <ConditionSelect
            id="odontogram-tooth-condition"
            value={toothCondition}
            onChange={setToothCondition}
          />
          {record ? (
            <p className="mt-1 text-[length:var(--text-caption)] text-ink-muted">
              Condición actual: {conditionLabel(record.condition)}. Guardar aquí actualiza la pieza.
            </p>
          ) : (
            <p className="mt-1 text-[length:var(--text-caption)] text-ink-muted">
              Sin registro en esta pieza: guardar registrará la condición elegida.
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="odontogram-tooth-notes"
            className="block text-[length:var(--text-body-sm)] font-medium text-ink"
          >
            Observaciones (opcional)
          </label>
          <textarea
            id="odontogram-tooth-notes"
            value={toothNotes}
            rows={2}
            maxLength={4000}
            onChange={(event) => setToothNotes(event.target.value)}
            className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>

        <LinksContainer className="dc-treatment-links">{progressive ? <summary>Tratamientos relacionados</summary> : null}
        <fieldset className="rounded-xs bg-input-fill p-3">
          <legend className="text-[length:var(--text-body-sm)] font-medium text-ink">
            Tratamientos relacionados
          </legend>
          <p className="mt-1 text-[length:var(--text-caption)] text-ink-muted">
            Marca los tratamientos del paciente que trata esta pieza. Desmarcar solo quita la
            relación; el tratamiento clínico no se elimina.
          </p>

          {treatmentsLoading ? (
            <p role="status" className="mt-2 text-[length:var(--text-body-sm)] text-ink-muted">
              Cargando tratamientos…
            </p>
          ) : treatmentsError ? (
            <div className="mt-2 grid justify-items-start gap-2">
              <p className="text-[length:var(--text-body-sm)] text-danger-ink">
                No se pudieron cargar los tratamientos.
              </p>
              <button
                type="button"
                onClick={onReloadTreatments}
                className="min-h-10 rounded-xs bg-paper px-3 py-1.5 text-[length:var(--text-caption)] text-ink ring-1 ring-hairline outline-none hover:ring-hairline-strong focus-visible:ring-2 focus-visible:ring-primary"
              >
                Reintentar tratamientos
              </button>
            </div>
          ) : treatments.length === 0 ? (
            <p className="mt-2 text-[length:var(--text-body-sm)] text-ink-muted">
              Este paciente todavía no tiene tratamientos registrados. Créalos en la sección
              «Tratamientos» y vuelve a esta pieza.
            </p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {treatments.map((treatment) => (
                <li key={treatment.id}>
                  <label className="flex items-start gap-2 text-[length:var(--text-body-sm)] text-ink">
                    <input
                      type="checkbox"
                      checked={treatmentIds.includes(treatment.id)}
                      onChange={() => toggleTreatment(treatment.id)}
                      className="mt-0.5 size-4 rounded-xs accent-primary outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    />
                    <span>
                      <span className="font-medium">{treatment.description}</span>
                      <span className="text-ink-muted">
                        {' · '}
                        {treatmentStatusLabel(treatment.status)}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        </LinksContainer>

        <button
          type="submit"
          disabled={!canSaveTooth}
          className="min-h-11 justify-self-start rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-paper outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Guardando…' : progressive ? 'Guardar pieza' : record ? 'Actualizar pieza' : 'Registrar pieza'}
        </button>
      </form>

      {record ? (
        <SurfaceContainer className="mt-5">
          {integrated || progressive ? <summary className="cursor-pointer py-2 font-medium text-ink">{progressive ? 'Superficies de la pieza' : 'Registrar superficies de la pieza'}</summary> : <p className="text-[length:var(--text-caption)] font-medium uppercase tracking-[0.05em] text-ink-muted">
            Superficies · {dentitionLabel(dentitionOf(fdi))}
          </p>}
          {progressive ? <label className="dc-surface-selector">Superficie a editar<select aria-label="Superficie a editar" value={selectedSurface} onChange={event => setSelectedSurface(event.target.value as ToothSurface)}>{surfaceOrder.map(surface => <option key={surface} value={surface}>{surfaceLabel(surface)} · {surfacesByType.has(surface) ? conditionLabel(surfacesByType.get(surface)!.condition) : 'Sin registro'}{surfaceDrafts[surface].condition !== savedSurfaceDrafts[surface].condition || surfaceDrafts[surface].notes !== savedSurfaceDrafts[surface].notes ? ' · Sin guardar' : ''}</option>)}</select></label> : null}
          <ul className="mt-2 grid gap-3">
            {surfaceOrder.map((surface) => (
              <li key={surface} hidden={progressive && selectedSurface !== surface}>
                <SurfaceEditor
                  fdi={fdi}
                  naturalCopy={progressive}
                  surface={surface}
                  existing={surfacesByType.get(surface)}
                  draft={surfaceDrafts[surface]}
                  saving={saving}
                  writeBlocked={writeBlocked}
                  onDraftChange={(next) => setSurfaceDrafts((prev) => ({ ...prev, [surface]: next }))}
                  onSave={(data) => onSaveSurface(surface, data)}
                />
              </li>
            ))}
          </ul>
        </SurfaceContainer>
      ) : (
        <p className="mt-3 text-[length:var(--text-caption)] text-ink-muted">
          Registra primero la condición de la pieza para poder registrar sus superficies.
        </p>
      )}
      </div>

      {progressive ? <details className="dc-tooth-history"><summary>Historial de esta pieza</summary>{renderHistory ? renderHistory(true) : <ToothHistoryTimeline record={record} />}</details> : <div
        role="tabpanel"
        id="tooth-tabpanel-history"
        aria-labelledby="tooth-tab-history"
        hidden={tab !== 'history'}
        className="mt-3"
      >
        {renderHistory ? renderHistory(tab === 'history') : <ToothHistoryTimeline record={record} />}
      </div>}
    </section>
  );
}

function SurfaceEditor({
  naturalCopy = false,
  fdi,
  surface,
  existing,
  draft,
  saving,
  onDraftChange,
  onSave,
  writeBlocked,
}: {
  naturalCopy?: boolean;
  fdi: number;
  surface: ToothSurface;
  existing: ToothSurfaceDto | undefined;
  draft: SurfaceDraft;
  saving: boolean;
  onDraftChange: (draft: SurfaceDraft) => void;
  onSave: (data: SurfaceSaveData) => void;
  writeBlocked: boolean;
}) {
  const label = surfaceLabel(surface);
  const canSave = draft.condition !== '' && !saving && !writeBlocked;

  return (
    <div className="rounded-xs bg-input-fill p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[length:var(--text-body-app)] font-medium text-ink">{label}</p>
        {existing ? (
          <span className={`rounded-xs px-2 py-0.5 text-[length:var(--text-caption)] ${conditionChipClass(existing.condition)}`}>
            Actual: {conditionLabel(existing.condition)}
          </span>
        ) : (
          <span className="rounded-xs border border-dashed border-hairline px-2 py-0.5 text-[length:var(--text-caption)] text-ink-muted">
            Sin registro
          </span>
        )}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,12rem)_1fr_auto] dc-surface-fields">
        <label htmlFor={`${fdi}-${surface}-condition`} className="sr-only">
          Condición de la superficie {label}
        </label>
        <div>
          <ConditionSelect
            id={`${fdi}-${surface}-condition`}
            value={draft.condition}
            onChange={(condition) => onDraftChange({ ...draft, condition })}
          />
        </div>
        {naturalCopy ? <label htmlFor={`${fdi}-${surface}-notes`}>Observaciones de la superficie (opcional)</label> : null}<input
          id={`${fdi}-${surface}-notes`}
          aria-label={`Observaciones de ${label}`}
          value={draft.notes}
          maxLength={4000}
          onChange={(event) => onDraftChange({ ...draft, notes: event.target.value })}
          placeholder="Observaciones (opcional)"
          className="min-w-0 rounded-control bg-paper px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <button
          type="button"
          onClick={() => onSave({ condition: draft.condition as ToothCondition, notes: draft.notes })}
          disabled={!canSave}
          className="min-h-11 rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-sm)] font-medium text-paper outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Guardando…' : naturalCopy ? `Guardar superficie ${label.toLowerCase()}` : existing ? `Actualizar ${label}` : `Registrar ${label}`}
        </button>
      </div>
    </div>
  );
}

function ConditionSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: ToothCondition | '';
  onChange: (value: ToothCondition | '') => void;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value as ToothCondition | '')}
      className="mt-1 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <option value="">Selecciona una condición…</option>
      {CONDITION_ORDER.map((condition) => (
        <option key={condition} value={condition}>
          {conditionLabel(condition)}
        </option>
      ))}
    </select>
  );
}

function initSurfaceDrafts(fdi: number, record: ToothRecordDto | undefined): Record<ToothSurface, SurfaceDraft> {
  const drafts = {} as Record<ToothSurface, SurfaceDraft>;
  for (const surface of allowedSurfacesFor(fdi)) {
    drafts[surface] = { condition: '', notes: '' };
  }
  if (!record) return drafts;
  for (const surface of record.surfaces) {
    if (drafts[surface.surface]) {
      drafts[surface.surface] = { condition: surface.condition, notes: surface.notes ?? '' };
    }
  }
  return drafts;
}

/** Evita asociaciones duplicadas al precargar o enviar los tratamientos vinculados (F7.4.4). */
function dedupeIds(ids: number[]): number[] {
  return Array.from(new Set(ids));
}

/** Compara dos listas de ids sin depender del orden. */
function sameIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}
