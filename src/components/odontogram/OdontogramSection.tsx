import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { useAuthStore } from '../../app/authStore';
import { useUnsavedChanges } from '../../app/unsavedChanges';
import type { AppointmentSelection, ClinicalDestination } from '../../api/clinicalTrace';
import { destinationSelection } from '../../api/clinicalTrace';
import { ClinicalDestinationPicker } from '../patients/ClinicalDestinationPicker';
import { OdontogramHistoryPanel } from './OdontogramHistoryPanel';
import { OdontogramEvents } from './OdontogramEvents';

import { ApiError } from '../../api/http';
import {
  odontogramApi,
  type Dentition,
  type OdontogramSummaryDto,
  type ToothCondition,
  type ToothRecordDto,
  type ToothSurface,
  type ToothSurfaceDto,
} from '../../api/odontogram';
import { treatmentsApi } from '../../api/treatments';
import { FormAlert } from '../auth/ui';
import { DentalChart, type ChartTooth } from './DentalChart';
import type { SurfaceSaveData, ToothSaveData } from './ToothEditor';
import { odontogramWriteErrorMessage } from './errorMessage';
import { dentitionLabel, dentitionOf, surfaceLabel, type OdontogramView } from './odontogramUi';
import { ClinicalDiscardDialog } from '../patients/ClinicalDiscardDialog';
import { ReceptionOdontogramSection } from './ReceptionOdontogramSection';

const trimOrNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/**
 * Seccion «Odontograma» del expediente clinico (F7.4.3.3 consulta + F7.4.3.4 edicion).
 *
 * - OWNER y DENTIST (`editable`): consulta y escribe. Registra una pieza nueva (POST) o la
 *   actualiza (PUT) y hace lo propio con superficies; tras guardar, la vista se refresca desde
 *   la misma respuesta (sin recargar la pagina). El backend autoriza 403 a cualquier otro rol.
 * - PATIENT (`summary`): resumen reducido propio; las superficies se cargan al seleccionar
 *   una pieza. Nunca ve observaciones, tratamientos ni historial.
 */
interface SectionProps {
  consoleMode?: boolean;
  focused?: boolean;
  onFocusChange?: (focused: boolean) => void;
  patientId: number;
  summary?: boolean;
  editable?: boolean;
  appointment?: ClinicalDestination | undefined;
  initialHistorySelection?: AppointmentSelection | undefined;
  timeZone?: string | undefined;
  contextualWriteBlocked?: boolean;
  integrated?: boolean;
}

/** Changing patient destroys only that patient's in-memory drafts; no PHI is persisted. */
export function OdontogramSection(props: SectionProps) {
  const user = useAuthStore((state) => state.user);
  if (user?.role === 'RECEPTIONIST') return <ReceptionOdontogramSection key={`${user.id}-${props.patientId}`} patientId={props.patientId} />;
  return <PatientOdontogramSection key={`${props.patientId}-${user?.id ?? 'anonymous'}-${user?.role ?? 'standalone'}-${props.summary ?? false}`}
    {...props} summary={props.summary || user?.role === 'PATIENT'} />;
}

function PatientOdontogramSection({
  consoleMode = false,
  focused = false,
  onFocusChange,
  patientId,
  summary = false,
  editable = false,
  appointment,
  initialHistorySelection,
  contextualWriteBlocked = false,
  integrated = false,
  timeZone = appointment?.timeZone ?? 'UTC',
}: SectionProps) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const role = useAuthStore((state) => state.user?.role);
  const canHistory = !summary && (role === 'OWNER' || role === 'DENTIST');
  const [panel, setPanel] = useState<'current' | 'history'>(() => !integrated && appointment && canHistory ? 'history' : 'current');
  const [historyVisited, setHistoryVisited] = useState(!integrated && Boolean(appointment));
  const [destination, setDestination] = useState<ClinicalDestination | null>(() => appointment ?? null);
  const submitting = useRef(false);
  const [chosenDentition, setDentition] = useState<Dentition | null>(null);
  const [view, setView] = useState<OdontogramView>('chart');
  const [selectedFdi, setSelectedFdi] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [pendingChange, setPendingChange] = useState<(() => void) | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const expandButton = useRef<HTMLButtonElement>(null);
  const returnPosition = useRef({ window: 0, main: 0 });
  useUnsavedChanges(uncertain);
  function focusMode(next: boolean) {
    const main = expandButton.current?.closest('main');
    if (next) returnPosition.current = { window: window.scrollY, main: main?.scrollTop ?? 0 };
    onFocusChange?.(next);
    if (!next) setPanel('current');
    requestAnimationFrame(() => {
      if (next) { document.getElementById(headingId)?.focus(); document.getElementById(headingId)?.scrollIntoView?.({ block: 'start' }); }
      else { window.scrollTo?.(0, returnPosition.current.window); main?.scrollTo?.(0, returnPosition.current.main); expandButton.current?.focus({ preventScroll: true }); }
    });
  }
  function changeEditor(change: () => void) {
    if (saving || uncertain) return;
    if (editorDirty) setPendingChange(() => change);
    else change();
  }
  function selectPiece(next: number | null) {
    if (next === selectedFdi) return;
    changeEditor(() => setSelectedFdi(next));
  }

  const canEdit = editable && !summary && (role === 'OWNER' || role === 'DENTIST' || role === undefined);
  const contextSupport = useQuery({ queryKey: ['odontogram-at', patientId, 'write-validation', destination?.appointmentId, destination?.occurrenceVersion],
    queryFn: () => odontogramApi.atAttention(patientId, destination!), enabled: canEdit && canHistory && destination !== null, retry: false });
  const context = contextSupport.data?.reference.occurrence;
  const contextualBlocked = destination !== null && (contextualWriteBlocked || !canHistory || contextSupport.isPending || contextSupport.isError
    || context?.currentStatus === 'CANCELLED' || context?.currentStatus === 'NO_SHOW'
    || context?.currentOccurrenceVersion !== destination.occurrenceVersion);

  const staffQuery = useQuery({
    queryKey: ['odontogram', patientId],
    queryFn: () => odontogramApi.list(patientId),
    enabled: !summary,
  });
  const summaryQuery = useQuery({
    queryKey: ['odontogram-summary', patientId],
    queryFn: () => odontogramApi.listSummary(patientId),
    enabled: summary,
  });
  const surfacesQuery = useQuery({
    queryKey: ['odontogram-summary-surfaces', patientId, selectedFdi],
    queryFn: () => odontogramApi.listSurfaceSummaries(patientId, selectedFdi as number),
    enabled: summary && selectedFdi !== null && (summaryQuery.data ?? []).some(row => row.toothFdi === selectedFdi),
  });
  const treatmentsQuery = useQuery({
    queryKey: ['treatments', patientId],
    queryFn: () => treatmentsApi.list(patientId),
    enabled: canEdit,
  });

  const staffRecords = (staffQuery.data ?? []) as ToothRecordDto[];
  // Prefer the recorded dentition, not an age-based clinical assumption. Mixed/empty stays selectable.
  const dentition = chosenDentition ?? (integrated && staffRecords.length > 0 && staffRecords.every(r => dentitionOf(r.toothFdi) === 'TEMPORARY') ? 'TEMPORARY' : 'PERMANENT');
  const selectedRecord = !summary
    ? staffRecords.find((record) => record.toothFdi === selectedFdi)
    : undefined;

  const saveTooth = useMutation({
    retry: false,
    mutationFn: ({ fdi, data, selection }: { fdi: number; data: ToothSaveData; selection: AppointmentSelection | null | undefined }) => {
      const existing = staffRecords.find((record) => record.toothFdi === fdi);
      const notes = trimOrNull(data.notes);
      const treatmentIds = Array.from(new Set(data.treatmentIds));
      const attribution = selection === undefined ? {} : { appointmentContext: selection };
      if (existing) {
        return odontogramApi.updateTooth(patientId, fdi, {
          condition: data.condition,
          notes,
          treatmentIds,
          ...attribution,
        });
      }
      return odontogramApi.createTooth(patientId, {
        toothFdi: fdi,
        condition: data.condition,
        notes,
        treatmentIds,
        ...attribution,
      });
    },
    onSuccess: (updated) => {
      setNotice(`Pieza ${updated.toothFdi} guardada.`);
      setFormError(null);
      applyTooth(updated);
      // Guardar una pieza puede cambiar sus vínculos con tratamientos: refresca la sección clínica.
      void queryClient.invalidateQueries({ queryKey: ['treatments', patientId] });
      invalidateHistory();
    },
    onError: (cause) => {
      setNotice(null);
      if (cause instanceof ApiError && cause.status === 409) {
        void staffQuery.refetch();
        refreshContext();
      }
      setFormError(odontogramWriteErrorMessage(cause, 'No se pudo guardar la pieza.'));
      if (!(cause instanceof ApiError) || cause.status >= 500) { setUncertain(true); setReviewed(false); }
    },
    onSettled: () => { submitting.current = false; },
  });

  const saveSurface = useMutation({
    retry: false,
    mutationFn: ({ fdi, surface, data, selection }: { fdi: number; surface: ToothSurface; data: SurfaceSaveData; selection: AppointmentSelection | null | undefined }) => {
      const existing = staffRecords
        .find((record) => record.toothFdi === fdi)
        ?.surfaces.find((item) => item.surface === surface);
      const notes = trimOrNull(data.notes);
      const attribution = selection === undefined ? {} : { appointmentContext: selection };
      return existing
        ? odontogramApi.updateSurface(patientId, fdi, surface, { condition: data.condition, notes, ...attribution })
        : odontogramApi.createSurface(patientId, fdi, {
            surface,
            condition: data.condition,
            notes,
            ...attribution,
          });
    },
    onSuccess: (updated, variables) => {
      setNotice(`Superficie ${surfaceLabel(updated.surface)} guardada.`);
      setFormError(null);
      applySurface(variables.fdi, updated);
      invalidateHistory();
    },
    onError: (cause) => {
      setNotice(null);
      if (cause instanceof ApiError && cause.status === 409) {
        void staffQuery.refetch();
        refreshContext();
      }
      setFormError(odontogramWriteErrorMessage(cause, 'No se pudo guardar la superficie.'));
      if (!(cause instanceof ApiError) || cause.status >= 500) { setUncertain(true); setReviewed(false); }
    },
    onSettled: () => { submitting.current = false; },
  });

  function invalidateHistory() {
    void queryClient.invalidateQueries({ queryKey: ['odontogram-history', patientId] });
    void queryClient.invalidateQueries({ queryKey: ['odontogram-at', patientId] });
  }
  function refreshContext() {
    if (destination) void queryClient.invalidateQueries({ queryKey: ['appointment', destination.appointmentId] });
    void queryClient.invalidateQueries({ queryKey: ['odontogram-at', patientId] });
  }
  function selectionForWrite() {
    return appointment || destination ? destinationSelection(destination) : undefined;
  }

  function applyTooth(updated: ToothRecordDto): void {
    queryClient.setQueryData<ToothRecordDto[]>(['odontogram', patientId], (old) => {
      const list = old ?? [];
      return list.some((record) => record.toothFdi === updated.toothFdi)
        ? list.map((record) => (record.toothFdi === updated.toothFdi ? updated : record))
        : [...list, updated];
    });
  }

  function applySurface(fdi: number, updated: ToothSurfaceDto): void {
    queryClient.setQueryData<ToothRecordDto[]>(['odontogram', patientId], (old) => {
      const list = old ?? [];
      return list.map((record) =>
        record.toothFdi === fdi
          ? {
              ...record,
              surfaces: mergeSurface(record.surfaces, updated),
            }
          : record,
      );
    });
  }

  function mergeSurface(list: ToothSurfaceDto[], updated: ToothSurfaceDto): ToothSurfaceDto[] {
    return list.some((item) => item.surface === updated.surface)
      ? list.map((item) => (item.surface === updated.surface ? updated : item))
      : [...list, updated];
  }

  const isLoading = summary ? summaryQuery.isLoading : staffQuery.isLoading;
  const isError = summary ? summaryQuery.isError : staffQuery.isError;
  const refetch = summary ? summaryQuery.refetch : staffQuery.refetch;
  const rawRecords = summary ? summaryQuery.data : staffQuery.data;
  const saving = saveTooth.isPending || saveSurface.isPending;

  const teeth: ChartTooth[] = (rawRecords ?? []).map((record) =>
    summary
      ? {
          fdi: (record as OdontogramSummaryDto).toothFdi,
          condition: (record as OdontogramSummaryDto).condition,
          notes: undefined,
          treatmentCount: 0,
        }
      : {
          fdi: (record as ToothRecordDto).toothFdi,
          condition: (record as ToothRecordDto).condition,
          notes: (record as ToothRecordDto).notes,
          treatmentCount: (record as ToothRecordDto).treatmentIds.length,
        },
  );

  const surfaces: Record<number, Partial<Record<ToothSurface, ToothCondition>>> = {};
  if (!summary) {
    for (const record of staffRecords) {
      const recorded: Partial<Record<ToothSurface, ToothCondition>> = {};
      for (const surface of record.surfaces) {
        recorded[surface.surface] = surface.condition;
      }
      if (Object.keys(recorded).length > 0) surfaces[record.toothFdi] = recorded;
    }
  } else if (surfacesQuery.data && selectedFdi !== null) {
    const recorded: Partial<Record<ToothSurface, ToothCondition>> = {};
    for (const surface of surfacesQuery.data) {
      recorded[surface.surface] = surface.condition;
    }
    if (Object.keys(recorded).length > 0) surfaces[selectedFdi] = recorded;
  }

  const recordedInDentition = teeth.filter((tooth) => dentitionOf(tooth.fdi) === dentition);
  const empty = rawRecords !== undefined && recordedInDentition.length === 0;

  return (
    <section aria-labelledby={headingId} className={`rounded-card bg-paper p-6 ring-1 ring-hairline${consoleMode ? ' dc-console-odontogram' : ''}`} data-focused={focused || undefined}>
      <div className="dc-dental-heading">
        <h3 id={headingId} tabIndex={-1} className="text-[length:var(--text-body-app)] font-medium text-ink">
          Odontograma
        </h3>
        {!consoleMode ? <p className="mt-1 text-[length:var(--text-caption)] text-ink-muted">
          {canEdit
            ? 'Registro clínico: las piezas se seleccionan para registrar o actualizar condiciones y superficies.'
            : 'Estado de piezas y superficies. Consulta de solo lectura.'}
        </p> : <span className="dc-caption">Estado actual · {dentitionLabel(dentition)}</span>}
        {consoleMode ? <button ref={expandButton} type="button" className="dc-link" onClick={() => focusMode(!focused)}>{focused ? 'Volver a consulta' : 'Explorar odontograma'}</button> : null}
      </div>

      {canHistory && !consoleMode ? <div role="group" aria-label="Consulta del odontograma" className="mt-4 flex flex-wrap gap-2">
        <button type="button" aria-pressed={panel === 'current'} onClick={() => setPanel('current')}
          className={`min-h-11 rounded-control px-4 py-2 text-ink ring-1 ring-hairline outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-primary ${panel === 'current' ? 'bg-primary-subtle font-medium' : 'bg-paper'}`}>Estado actual</button>
        <button type="button" aria-pressed={panel === 'history'} onClick={() => { setHistoryVisited(true); setPanel('history'); }}
          className={`min-h-11 rounded-control px-4 py-2 text-ink ring-1 ring-hairline outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-primary ${panel === 'history' ? 'bg-primary-subtle font-medium' : 'bg-paper'}`}>Consulta histórica</button>
      </div> : null}
      {consoleMode && focused ? <button type="button" className="dc-link" onClick={() => { setHistoryVisited(true); setPanel(panel === 'history' ? 'current' : 'history'); }}>{panel === 'history' ? 'Volver al estado actual' : 'Consultar historia dental'}</button> : null}

      <div hidden={panel !== 'current'}>
      {canEdit ? <div className="mt-4 grid gap-2">
        <ClinicalDestinationPicker current={appointment} destination={destination} onChange={setDestination} disabled={saving || uncertain} editorial={integrated} compact={consoleMode} />
        {destination && contextSupport.isPending ? <p role="status" className="text-ink-muted">Comprobando contexto dental antes de guardar…</p> : null}
        {destination && contextSupport.isError ? <FormAlert>No se pudo comprobar el contexto dental E2. El borrador se conserva; reintenta o elige explícitamente registro general.</FormAlert> : null}
        {destination && (contextSupport.isError || contextualBlocked && !contextSupport.isPending) ? <button type="button" className="min-h-11 justify-self-start underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onClick={refreshContext}>Actualizar contexto dental</button> : null}
        {destination && context?.currentOccurrenceVersion !== undefined && context.currentOccurrenceVersion !== destination.occurrenceVersion
          ? <p role="status" className="text-ink-secondary">El borrador apunta a una ocurrencia anterior. Confirma la actual o selecciona registro general antes de guardar.</p> : null}
        {destination && (contextualWriteBlocked || context?.currentStatus === 'CANCELLED' || context?.currentStatus === 'NO_SHOW')
          ? <p role="status" className="text-ink-secondary">Esta cita no permite nuevas escrituras contextuales. Puedes consultar lo anterior o elegir registro general explícitamente.</p> : null}
      </div> : null}

      {isLoading ? <ChartSkeleton /> : null}

      {isError ? (
        <div className="mt-3 grid justify-items-start gap-3">
          <div className="w-full">
            <FormAlert>No se pudo cargar el odontograma.</FormAlert>
          </div>
          <button
            type="button"
            className="min-h-11 rounded-control bg-paper px-4 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none hover:ring-hairline-strong focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => void refetch()}
          >
            Reintentar
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="mt-3">
          <FormAlert tone="success">{notice}</FormAlert>
        </div>
      ) : null}
      {formError ? (
        <div className="mt-3">
          <FormAlert>{formError}</FormAlert>
        </div>
      ) : null}

      {empty && !consoleMode ? (
        <div className="mt-3 rounded-xs bg-info-subtle px-3 py-2 text-[length:var(--text-body-sm)] text-info-ink">
          <p className="font-medium">Sin condiciones registradas</p>
          <p className="mt-0.5">
            Todavía no hay hallazgos anotados en la dentición {dentitionLabel(dentition).toLowerCase()}.
            {canEdit
              ? ' Selecciona una pieza, incluidas las que estén sin registro, para registrar su estado.'
              : ' Esta consulta es de solo lectura; el registro queda a cargo del personal clínico autorizado.'}
          </p>
        </div>
      ) : null}

      {uncertain ? <div role="alert" className="dc-draft-warning"><p>No sabemos si el cambio dental se guardó. No se repetirá automáticamente. Revisa el estado y el historial antes de otro envío; esta lectura no es un recibo de la solicitud.</p><button type="button" className="dc-link" onClick={async () => { const result = await staffQuery.refetch(); await queryClient.invalidateQueries({ queryKey: ['odontogram-history', patientId] }); setReviewed(!result.isError); }}>Consultar estado dental antes de repetir</button>{reviewed ? <button type="button" className="dc-link" onClick={() => { setUncertain(false); setReviewed(false); }}>He revisado el estado; permitir otro envío</button> : null}</div> : null}

      {rawRecords !== undefined ? (
        <DentalChart
          layout="expanded"
          onDirtyChange={setEditorDirty}
          integrated={integrated}
          dentition={dentition}
          teeth={teeth}
          surfaces={surfaces}
          canReadNotes={!summary}
          view={view}
          onViewChange={setView}
          selectedFdi={selectedFdi}
          onSelect={selectPiece}
          onDentitionChange={(next) => {
            if (saving) return;
            const change = () => { setDentition(next); setSelectedFdi(null); };
            changeEditor(change);
          }}
          surfacesLoading={summary && selectedFdi !== null && surfacesQuery.isLoading}
          surfacesError={summary && selectedFdi !== null && surfacesQuery.isError}
          onReloadSurfaces={() => void surfacesQuery.refetch()}
          canEdit={canEdit}
          selectedRecord={selectedRecord}
          treatments={treatmentsQuery.data ?? []}
          treatmentsLoading={canEdit && treatmentsQuery.isLoading}
          treatmentsError={canEdit && treatmentsQuery.isError}
          onReloadTreatments={() => void treatmentsQuery.refetch()}
          saving={saving}
          writeBlocked={contextualBlocked || uncertain}
          renderHistory={canHistory && selectedFdi !== null ? (enabled) => <OdontogramEvents key={selectedFdi} patientId={patientId}
            filters={{ toothFdi: selectedFdi }} enabled={enabled && panel === 'current'} timeZone={timeZone} /> : undefined}
          onSaveTooth={(fdi, data) => { if (submitting.current || contextualBlocked || uncertain) return; submitting.current = true; saveTooth.mutate({ fdi, data, selection: selectionForWrite() }); }}
          onSaveSurface={(fdi, surface, data) => { if (submitting.current || contextualBlocked || uncertain) return; submitting.current = true; saveSurface.mutate({ fdi, surface, data, selection: selectionForWrite() }); }}
        />
      ) : null}
      </div>
      {canHistory && historyVisited ? <div hidden={panel !== 'history'}>
        <OdontogramHistoryPanel key={initialHistorySelection ? `${initialHistorySelection.appointmentId}-${initialHistorySelection.occurrenceVersion}` : 'manual'}
          patientId={patientId} initialSelection={initialHistorySelection} timeZone={timeZone} enabled={panel === 'history'} />
      </div> : null}
      {pendingChange ? <ClinicalDiscardDialog label={`la pieza ${selectedFdi}`} onStay={() => setPendingChange(null)} onDiscard={() => { const proceed = pendingChange; setPendingChange(null); proceed(); }} /> : null}
    </section>
  );
}

/** Esqueleto que imita la forma del grafico (16.1), no un spinner generico. */
function ChartSkeleton() {
  return (
    <div aria-label="Cargando odontograma" role="status" className="mt-4 grid gap-5">
      <div className="grid grid-cols-2 gap-2">
        <SkeletonRow teeth={8} />
        <SkeletonRow teeth={8} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SkeletonRow teeth={8} />
        <SkeletonRow teeth={8} />
      </div>
    </div>
  );
}

function SkeletonRow({ teeth }: { teeth: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(2.5rem,1fr))] gap-1.5">
      {Array.from({ length: teeth }, (_, index) => (
        <div key={index} className="size-10 animate-pulse rounded-xs bg-sunken" />
      ))}
    </div>
  );
}
