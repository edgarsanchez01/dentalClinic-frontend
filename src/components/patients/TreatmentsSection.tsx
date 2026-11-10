import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { appointmentsApi } from '../../api/appointments';
import { formatReferencePrice, normalizeReferencePrice } from '../../api/catalog';
import { ApiError } from '../../api/http';
import {
  treatmentsApi,
  type CreateTreatmentInput,
  type TreatmentDto,
  type TreatmentStatus,
  type UpdateTreatmentInput,
} from '../../api/treatments';
import { FormAlert } from '../auth/ui';
import { useUnsavedChanges, useGuardedNavigate } from '../../app/unsavedChanges';
import { ClinicalContextLabel, ClinicalDestinationPicker } from './ClinicalDestinationPicker';
import { ClinicalEntryChain } from './ClinicalCorrection';
import { ClinicalWriteReview } from './ClinicalWriteReview';
import { ClinicalDiscardDialog } from './ClinicalDiscardDialog';
import { groupChains } from './clinicalChain';
import { clinicalTraceApi, destinationSelection, type ClinicalDestination } from '../../api/clinicalTrace';
import {
  TREATMENT_STATUS_OPTIONS,
  treatmentStatusChipClass,
  treatmentStatusLabel,
} from './treatmentUi';

/**
 * Seccion «Tratamientos» del expediente clinico. Reutiliza el bloque clinico del paciente
 * (§7.4): OWNER y DENTIST consultan, crean y editan datos y estado. No
 * muestra ni solicita nada a RECEPTIONIST ni PATIENT porque el propio expediente no se
 * renderiza para ellos.
 */
const secondary =
  'min-h-11 rounded-control bg-paper px-4 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none hover:ring-hairline-strong focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';
const primary =
  'min-h-11 rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-app)] font-medium text-paper outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60';

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) return cause.body?.message ?? fallback;
  if (cause instanceof Error && cause.message.trim() !== '') return cause.message;
  return fallback;
}

type AppointmentContext = { id: number; startAt: string; timeZone: string; occurrenceVersion?: number };

export function TreatmentsSection({ patientId, editable, appointment, editorial = false, contextualWriteBlocked = false, integrated = false, compact = false }: { patientId: number; editable: boolean; appointment?: AppointmentContext; editorial?: boolean; contextualWriteBlocked?: boolean; integrated?: boolean; compact?: boolean }) {
  const queryClient = useQueryClient();
  const guarded = useGuardedNavigate();
  const [showAll, setShowAll] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const [pendingChange, setPendingChange] = useState<(() => void) | null>(null);
  function changeEditor(proceed: () => void) {
    if (compact) { if (editorDirty) setPendingChange(() => proceed); else proceed(); }
    else if (editorial) guarded(proceed); else proceed();
  }
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; treatment: TreatmentDto } | null>(
    null,
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['treatments', patientId],
    queryFn: () => treatmentsApi.list(patientId),
  });

  return (
    <div className={`rounded-card bg-paper p-6 ring-1 ring-hairline${compact ? ' dc-compact-treatments' : ''}`} data-expanded={showAll || undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
           <h3 className="text-[length:var(--text-body-app)] font-medium text-ink">{compact ? 'Tratamientos del paciente' : 'Tratamientos'}</h3>
          <p className="mt-1 text-[length:var(--text-caption)] text-ink-muted">
            {compact ? 'Planificación y seguimiento; no acredita lo realizado en esta cita.' : 'Planificación y seguimiento de tratamientos clínicos.'}
          </p>
        </div>
        {editable ? (
          <button
            type="button"
            className={secondary}
            onClick={() =>
              changeEditor(() => setEditor((prev) => (prev?.mode === 'create' ? null : { mode: 'create' })))
            }
          >
            {editor?.mode === 'create' ? 'Cancelar' : 'Nuevo tratamiento'}
          </button>
        ) : null}
      </div>

      {isLoading ? <p className="mt-3 text-ink-muted">Cargando tratamientos…</p> : null}
      {isError ? (
        <div className="mt-3 grid justify-items-start gap-3">
          <p className="text-danger-ink">No se pudieron cargar los tratamientos.</p>
          <button type="button" className={secondary} onClick={() => void refetch()}>
            Reintentar
          </button>
        </div>
      ) : null}
      {data && data.length === 0 ? (
        <p className="mt-3 text-ink-secondary">Todavía no hay tratamientos registrados.</p>
      ) : null}

      {data && data.length > 0 ? (
        <ol className="mt-4 grid gap-3">
          {data.map((treatment, index) => (
            <li key={treatment.id} hidden={compact && !showAll && index >= 2} className="rounded-control bg-input-fill p-4">
              <TreatmentCard
                treatment={treatment}
                compact={compact}
                editable={editable}
                onEdit={() => changeEditor(() => setEditor({ mode: 'edit', treatment }))}
                timeZone={appointment?.timeZone}
                appointment={appointment}
                editorial={editorial}
                contextualWriteBlocked={contextualWriteBlocked}
              />
            </li>
          ))}
        </ol>
      ) : null}
      {compact && data && data.length > 2 ? <button type="button" className="dc-link" data-show-treatment-list aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? 'Mostrar resumen de tratamientos' : `Ver todos los tratamientos (${data.length})`}</button> : null}

      {editable && editor ? (
        <TreatmentForm
          key={editor.mode === 'edit' ? editor.treatment.id : 'new'}
          patientId={patientId}
          treatment={editor.mode === 'edit' ? editor.treatment : undefined}
          onClose={() => changeEditor(() => setEditor(null))}
          onDirtyChange={setEditorDirty}
          onSaved={() => {
            setEditor(null);
            void queryClient.invalidateQueries({ queryKey: ['treatments', patientId] });
          }}
          appointment={appointment}
          integrated={integrated}
        />
      ) : null}
      {pendingChange ? <ClinicalDiscardDialog label="el tratamiento" onStay={() => setPendingChange(null)} onDiscard={() => { const proceed = pendingChange; setPendingChange(null); proceed(); }} /> : null}
    </div>
  );
}

function TreatmentCard({
  compact = false,
  treatment,
  editable,
  onEdit,
  timeZone,
  appointment,
  editorial,
  contextualWriteBlocked,
}: {
  compact?: boolean;
  treatment: TreatmentDto;
  editable: boolean;
  onEdit: () => void;
  timeZone?: string | undefined;
  appointment?: AppointmentContext | undefined;
  editorial: boolean;
  contextualWriteBlocked: boolean;
}) {
  // El contrato backend siempre envía `toothFdis`; el valor por defecto cubre cachés antiguas.
  const toothFdis = treatment.toothFdis ?? [];
  const [detailsOpen, setDetailsOpen] = useState(!compact);
  return (
    <article aria-label={`Tratamiento ${treatment.description}`} className="grid gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="min-w-0 break-words text-[length:var(--text-body-app)] font-medium text-ink">
              {treatment.description}
            </h4>
            <span
              className={`rounded-xs px-2 py-1 text-[length:var(--text-caption)] ${treatmentStatusChipClass(treatment.status)}`}
            >
              {treatmentStatusLabel(treatment.status)}
            </span>
          </div>
          {compact ? <p className="dc-caption">{toothFdis.length ? `Piezas ${toothFdis.join(', ')}` : 'Sin piezas relacionadas'} · {treatment.appointmentId ? `Cita #${treatment.appointmentId}` : 'Sin cita vinculada'}</p> : null}
          {compact ? <button type="button" className="dc-link" data-toggle-treatment-detail aria-expanded={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)}>{detailsOpen ? 'Ocultar detalle' : 'Ver detalle y evolución'}</button> : null}
          <div hidden={!detailsOpen}>
          {treatment.diagnosis ? (
            <p className="mt-2 max-w-[65ch] whitespace-pre-wrap break-words text-[length:var(--text-body-sm)] text-ink-secondary">
              <span className="font-medium text-ink-muted">Diagnóstico: </span>
              {treatment.diagnosis}
            </p>
          ) : null}
          {treatment.notes ? (
            <p className="mt-1 max-w-[65ch] whitespace-pre-wrap break-words text-[length:var(--text-body-sm)] text-ink-secondary">
              <span className="font-medium text-ink-muted">Notas: </span>
              {treatment.notes}
            </p>
          ) : null}
          </div>
        </div>
        {editable && detailsOpen ? (
          <button type="button" className={secondary} onClick={onEdit}>
            Editar <span className="sr-only">{treatment.description}</span>
          </button>
        ) : null}
      </div>
      <div hidden={!detailsOpen}><dl className="flex flex-wrap gap-x-8 gap-y-2 text-[length:var(--text-body-sm)]">
        <div>
          <dt className="text-ink-muted">Precio de referencia</dt>
          <dd className="tabular-nums break-all text-ink">
            {typeof treatment.price === 'string' ? formatReferencePrice(treatment.price) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Cita vinculada</dt>
          <dd className="text-ink">
            {treatment.appointmentId !== undefined ? (
              <Link
                to={`/appointments/${treatment.appointmentId}`}
                className="text-primary underline underline-offset-2"
              >
                Cita #{treatment.appointmentId}
              </Link>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Piezas relacionadas</dt>
          <dd className="text-ink">
            {toothFdis.length === 0 ? (
              <span className="text-ink-muted">Sin piezas relacionadas</span>
            ) : (
              <ul className="flex flex-wrap gap-1">
                {toothFdis.map((toothFdi) => (
                  <li
                    key={toothFdi}
                    className="rounded-xs bg-paper px-2 py-1 text-[length:var(--text-caption)] tabular-nums text-ink ring-1 ring-hairline"
                  >
                    {toothFdi}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      <TreatmentEvolution treatment={treatment} editable={editable} timeZone={timeZone} appointment={appointment} editorial={editorial} contextualWriteBlocked={contextualWriteBlocked} />
      </div>
    </article>
  );
}

/** Evolucion del tratamiento listado; solo se renderiza cada tarjeta con su propio panel. */
function TreatmentEvolution({
  treatment,
  editable,
  timeZone,
  appointment,
  editorial,
  contextualWriteBlocked,
}: {
  treatment: TreatmentDto;
  editable: boolean;
  timeZone?: string | undefined;
  appointment?: AppointmentContext | undefined;
  editorial: boolean;
  contextualWriteBlocked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  return (
    <div className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        data-toggle-evolution
        aria-controls={`treatment-${treatment.id}-evolution-list`}
        onClick={() => { setVisited(true); setOpen((previous) => !previous); }}
        className="inline-flex items-center gap-2 rounded-control bg-paper px-3 py-2 text-[length:var(--text-body-sm)] font-medium text-ink ring-1 ring-hairline outline-none hover:ring-hairline-strong focus-visible:ring-2 focus-visible:ring-primary"
      >
        Evolución
        <span aria-hidden className={open ? 'rotate-180 transition-transform' : 'transition-transform'}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      <div hidden={!open}>
        {visited ? <TreatmentEvolutionPanel
          patientId={treatment.patientId}
          treatmentId={treatment.id}
          editable={editable}
          listId={`treatment-${treatment.id}-evolution-list`}
          timeZone={timeZone}
          editorial={editorial}
          contextualWriteBlocked={contextualWriteBlocked}
          appointment={appointment?.occurrenceVersion === undefined ? undefined : { appointmentId: appointment.id,
            occurrenceVersion: appointment.occurrenceVersion, startAt: appointment.startAt, timeZone: appointment.timeZone }}
        /> : null}
      </div>
    </div>
  );
}

function TreatmentEvolutionPanel({
  patientId,
  treatmentId,
  editable,
  listId,
  timeZone,
  appointment,
  editorial,
  contextualWriteBlocked,
}: {
  patientId: number;
  treatmentId: number;
  editable: boolean;
  listId: string;
  timeZone?: string | undefined;
  appointment?: ClinicalDestination | undefined;
  editorial: boolean;
  contextualWriteBlocked: boolean;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['treatments', patientId, 'evolution', treatmentId],
    queryFn: () => treatmentsApi.listEvolution(patientId, treatmentId),
  });
  const [content, setContent] = useState('');
  const [destination, setDestination] = useState<ClinicalDestination | null>(() => appointment ?? null);
  const [uncertain, setUncertain] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const offered = appointment ?? destination;
  const support = useQuery({
    queryKey: ['clinical-trace', patientId, offered?.appointmentId, offered?.occurrenceVersion, 'EVOLUTIONS', 0],
    queryFn: () => clinicalTraceApi.evolutions(patientId, offered!),
    enabled: destination !== null && offered !== null,
  });
  const contextualBlocked = destination !== null && (contextualWriteBlocked || support.isPending || support.isError
    || (offered !== null && (destination.appointmentId !== offered.appointmentId || destination.occurrenceVersion !== offered.occurrenceVersion))
    || support.data?.context.currentOccurrenceVersion !== destination.occurrenceVersion
    || support.data?.context.currentStatus === 'CANCELLED' || support.data?.context.currentStatus === 'NO_SHOW');
  const submitting = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [correctingId, setCorrectingId] = useState<number | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [uncertainCorrection, setUncertainCorrection] = useState(false);
  const correctingLock = useRef(false);

  useUnsavedChanges(editable && (content.trim() !== '' || uncertain || uncertainCorrection));

  const addEntry = useMutation({
    retry: false,
    mutationFn: () =>
      treatmentsApi.addEvolution(patientId, treatmentId, { content: content.trim(),
        ...(appointment || destination ? { appointmentContext: destinationSelection(destination) } : {}) }),
    onSuccess: () => {
      setContent('');
      setErrors({});
      setError(null);
      setUncertain(false);
      setReviewed(false);
      setDestination(appointment ?? null);
      void queryClient.invalidateQueries({
        queryKey: ['treatments', patientId, 'evolution', treatmentId],
      });
      void queryClient.invalidateQueries({ queryKey: ['clinical-trace', patientId] });
    },
    onError: (cause) => {
      setErrors(cause instanceof ApiError ? cause.fieldErrors : {});
      setError(errorMessage(cause, 'No se pudo guardar la evolución.'));
      setUncertain(!(cause instanceof ApiError) || cause.status >= 500);
      setReviewed(false);
      if (cause instanceof ApiError && cause.status === 409 && destination) {
        void queryClient.invalidateQueries({ queryKey: ['appointment', destination.appointmentId] });
        void queryClient.invalidateQueries({ queryKey: ['clinical-trace', patientId] });
      }
    },
    onSettled: () => { submitting.current = false; },
  });

  const correctEntry = useMutation({
    retry: false,
    mutationFn: ({ evolutionId, content: corrected, reason }: { evolutionId: number; content: string; reason: string }) =>
      treatmentsApi.correctEvolution(patientId, treatmentId, evolutionId, { content: corrected, correctionReason: reason }),
    onSuccess: () => {
      setCorrectingId(null);
      setCorrectionError(null);
      void queryClient.invalidateQueries({ queryKey: ['treatments', patientId, 'evolution', treatmentId] });
      void queryClient.invalidateQueries({ queryKey: ['clinical-trace', patientId] });
    },
    onError: (cause) => { setCorrectionError(errorMessage(cause, 'No se pudo guardar la corrección.')); setUncertainCorrection(!(cause instanceof ApiError) || cause.status >= 500); },
    onSettled: () => { correctingLock.current = false; },
  });

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (content.trim() === '') next.content = 'El contenido es obligatorio.';
    else if (content.length > 4000) next.content = 'El contenido admite hasta 4000 caracteres.';
    return next;
  }

  return (
    <div
      id={listId}
      className="mt-3 grid gap-3 rounded-control bg-input-fill p-4"
      aria-label="Evolución del tratamiento"
      data-clinical-pending-editor={content.trim() !== '' || uncertain || uncertainCorrection ? 'true' : undefined}
    >
      {isLoading ? <p className="text-ink-muted">Cargando evolución…</p> : null}
      {isError ? (
        <div className="grid justify-items-start gap-3">
          <p className="text-danger-ink">No se pudieron cargar los registros de evolución.</p>
          <button type="button" className={secondary} onClick={() => void refetch()}>
            Reintentar
          </button>
        </div>
      ) : null}
      {data && data.length === 0 ? (
        <p className="text-ink-secondary">Sin registros de evolución.</p>
      ) : null}
      {uncertainCorrection ? <ClinicalWriteReview onRead={async () => !(await refetch()).isError} onAllow={() => setUncertainCorrection(false)} /> : null}
      {data && data.length > 0 ? (
        <ol className="grid gap-3">
          {groupChains(data).map(({ root, corrections }) => (
            <li key={root.id}>
              <ClinicalEntryChain
                root={root}
                corrections={corrections}
                editable={editable}
                correcting={correctingId === root.id}
                pending={(correctEntry.isPending || uncertainCorrection) && correctingId === root.id}
                error={correctingId === root.id ? correctionError : null}
                getContent={(entry) => entry.content}
                renderEntry={(entry) => (
                  <p className="whitespace-pre-wrap break-words text-[length:var(--text-body-app)] text-ink">
                    {entry.content}
                  </p>
                )}
                renderMeta={(entry) => (
                  <>
                    {entry.authorName} · {new Date(entry.createdAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) })}
                    {' · '}<ClinicalContextLabel context={entry.appointmentContext} />
                  </>
                )}
                onStartCorrect={() => { setCorrectionError(null); setCorrectingId(root.id); }}
                onCancelCorrect={() => { setCorrectionError(null); setCorrectingId(null); }}
                onSubmitCorrect={(value, reason) => { if (correctingLock.current || uncertainCorrection) return; correctingLock.current = true; correctEntry.mutate({ evolutionId: root.id, content: value, reason }); }}
              />
            </li>
          ))}
        </ol>
      ) : null}
      <p className="text-[length:var(--text-caption)] text-ink-muted">
        {editorial ? 'Las evoluciones guardadas se conservan. Para corregirlas, se añade una nueva versión con su motivo.' : 'Append-only: los registros son inmutables, no se editan ni se eliminan; las correcciones se añaden como versiones nuevas con su motivo.'}
      </p>

      {editable ? (
        <form
          noValidate
          className="mt-1 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (submitting.current || uncertain || contextualBlocked || addEntry.isPending) return;
            const next = validate();
            setErrors(next);
            setError(null);
            if (Object.keys(next).length > 0) {
              setError('Revisa el contenido.');
              document.getElementById(`evolucion-${treatmentId}`)?.focus();
              return;
            }
            submitting.current = true;
            addEntry.mutate();
          }}
        >
          {error ? <FormAlert>{error}</FormAlert> : null}
          {uncertain ? <div className="grid gap-2"><p role="status">No sabemos si el envío llegó a guardarse. Consulta los registros antes de repetir; no se reintentará automáticamente.</p>
            <button type="button" className="min-h-11 underline" onClick={async () => { const result = await refetch(); setReviewed(!result.isError); }}>Consultar registros antes de repetir</button>
            {reviewed ? <button type="button" className="min-h-11 underline" onClick={() => { setUncertain(false); setReviewed(false); }}>He revisado los registros; permitir otro envío</button> : null}</div> : null}
          <ClinicalDestinationPicker current={appointment} destination={destination} onChange={setDestination} disabled={addEntry.isPending || uncertain} editorial={editorial} compact={editorial} />
          {contextualBlocked ? <p role="status" className="text-ink-secondary">{support.isPending
            ? 'Comprobando contexto clínico antes de guardar…'
            : 'La cita no permite guardar información contextual o no se pudo verificar su trazabilidad. Reintenta la lectura o elige explícitamente un registro general.'}</p> : null}
          {support.isError && destination ? <button type="button" className="min-h-11 underline" onClick={() => void support.refetch()}>Reintentar contexto clínico</button> : null}
          <fieldset disabled={addEntry.isPending} className="grid min-w-0 gap-3">
            <div>
              <label
                htmlFor={`evolucion-${treatmentId}`}
                className="block text-[length:var(--text-body-sm)] font-medium text-ink"
              >
                Nueva nota de evolución
              </label>
              <textarea
                id={`evolucion-${treatmentId}`}
                name="content"
                rows={3}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                aria-invalid={Boolean(errors.content)}
                aria-describedby={errors.content ? `evolucion-${treatmentId}-error` : undefined}
                className="mt-1.5 w-full rounded-control bg-paper px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              {errors.content ? (
                <p id={`evolucion-${treatmentId}-error`} className="mt-1.5 text-[length:var(--text-caption)] text-danger-ink">
                  {errors.content}
                </p>
              ) : null}
            </div>
          </fieldset>
          <div>
            <button type="submit" className={primary} disabled={addEntry.isPending || uncertain || contextualBlocked}>
              {addEntry.isPending ? 'Guardando…' : editorial ? 'Guardar evolución' : 'Registrar nota'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

type Draft = {
  description: string;
  diagnosis: string;
  status: TreatmentStatus;
  notes: string;
  price: string;
  appointmentId: string;
};

function toDraft(treatment: TreatmentDto | undefined): Draft {
  return {
    description: treatment?.description ?? '',
    diagnosis: treatment?.diagnosis ?? '',
    status: treatment?.status ?? 'PLANNED',
    notes: treatment?.notes ?? '',
    price: treatment?.price ?? '',
    appointmentId: treatment?.appointmentId !== undefined ? String(treatment.appointmentId) : '',
  };
}

function isDraftDirty(draft: Draft, baseline: Draft): boolean {
  return (Object.keys(baseline) as Array<keyof Draft>).some((key) => draft[key] !== baseline[key]);
}

function TreatmentForm({
  onDirtyChange,
  patientId,
  treatment,
  onClose,
  onSaved,
  appointment,
  integrated = false,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  patientId: number;
  treatment: TreatmentDto | undefined;
  onClose: () => void;
  onSaved: () => void;
  appointment?: AppointmentContext | undefined;
  integrated?: boolean;
}) {
  const isEdit = treatment !== undefined;
  const baseline = () => ({ ...toDraft(treatment), ...(!isEdit && integrated && appointment ? { appointmentId: String(appointment.id) } : {}) });
  const [draft, setDraft] = useState<Draft>(baseline);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [reviewRows, setReviewRows] = useState<TreatmentDto[]>([]);

  useUnsavedChanges(isDraftDirty(draft, baseline()) || uncertain);
  const dirty = isDraftDirty(draft, baseline()) || uncertain;
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);

  const appointments = useQuery({
    queryKey: ['appointments', 'patient', patientId],
    queryFn: () => appointmentsApi.list({ patientId, size: 100 }),
    enabled: !isEdit && !integrated,
  });

  const set = (key: keyof Draft) => (value: string) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    if (draft.description.trim() === '') next.description = 'La descripción es obligatoria.';
    else if (draft.description.length > 4000)
      next.description = 'La descripción admite hasta 4000 caracteres.';
    if (draft.diagnosis.length > 4000)
      next.diagnosis = 'El diagnóstico admite hasta 4000 caracteres.';
    if (draft.price.trim() !== '' && normalizeReferencePrice(draft.price) === null)
      next.price = 'Escribe un precio no negativo, sin separadores de miles, con hasta 15 enteros y 4 decimales.';
    return next;
  }

  function focusError(next: Record<string, string>) {
    const key = Object.keys(draft).find((field) => Boolean(next[field]));
    if (key) form.current?.querySelector<HTMLElement>(`[name="${key}"]`)?.focus();
  }

  const save = useMutation({
    retry: false,
    mutationFn: () => {
      const normalizedPrice =
        draft.price.trim() === '' ? null : normalizeReferencePrice(draft.price);
      const base = {
        description: draft.description.trim(),
        diagnosis: draft.diagnosis.trim() === '' ? null : draft.diagnosis.trim(),
        status: draft.status,
        notes: draft.notes.trim() === '' ? null : draft.notes.trim(),
        price: normalizedPrice,
      };
      if (treatment) {
        const input: UpdateTreatmentInput = base;
        return treatmentsApi.update(patientId, treatment.id, input);
      }
      const input: CreateTreatmentInput = {
        ...base,
        appointmentId: draft.appointmentId === '' ? null : Number(draft.appointmentId),
      };
      return treatmentsApi.create(patientId, input);
    },
    onSuccess: onSaved,
    onError: (cause) => {
      setErrors(cause instanceof ApiError ? cause.fieldErrors : {});
      setError(errorMessage(cause, 'No se pudo guardar el tratamiento.'));
      if (!(cause instanceof ApiError) || cause.status >= 500) { setUncertain(true); setReviewed(false); }
    },
    onSettled: () => { submitting.current = false; },
  });

  return (
    <form
      ref={form}
      aria-label={isEdit ? 'Editar tratamiento' : 'Crear tratamiento'}
      data-clinical-pending-editor={dirty ? 'true' : undefined}
      noValidate
      className="mt-5 grid gap-4 rounded-control bg-input-fill p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (submitting.current || save.isPending || uncertain) return;
        const next = validate();
        setErrors(next);
        setError(null);
        if (Object.keys(next).length > 0) {
          setError('Revisa los campos indicados.');
          focusError(next);
          return;
        }
        submitting.current = true; save.mutate();
      }}
    >
      <h4 className="text-[length:var(--text-body-app)] font-medium text-ink">
        {isEdit ? 'Editar tratamiento' : 'Nuevo tratamiento'}
      </h4>
      {error ? <FormAlert>{error}</FormAlert> : null}
      {uncertain ? <div role="alert"><p>No sabemos si el tratamiento se guardó. Consulta los registros antes de repetir; no se reintentará automáticamente.</p><button type="button" className={secondary} onClick={async () => { try { const rows = await treatmentsApi.list(patientId); setReviewRows(rows); setReviewed(true); } catch { setError('No se pudieron consultar los tratamientos. Conserva el borrador y reintenta la consulta.'); } }}>Consultar tratamientos antes de repetir</button>{reviewed ? <><ul>{reviewRows.map(row => <li key={row.id}>{row.description} · {treatmentStatusLabel(row.status)}</li>)}</ul><p>Esta lectura no garantiza que el envío anterior no se haya registrado.</p><button type="button" className={secondary} onClick={() => { setUncertain(false); setReviewed(false); }}>He revisado los registros; permitir otro envío</button></> : null}</div> : null}

      <fieldset disabled={save.isPending} className="grid min-w-0 gap-4">
        <div>
          <label
            htmlFor="treatment-description"
            className="block text-[length:var(--text-body-sm)] font-medium text-ink"
          >
            Descripción
          </label>
          <textarea
            id="treatment-description"
            name="description"
            rows={2}
            value={draft.description}
            onChange={(event) => set('description')(event.target.value)}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? 'treatment-description-error' : undefined}
            className="mt-1.5 w-full rounded-control bg-paper px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          {errors.description ? (
            <p id="treatment-description-error" className="mt-1.5 text-[length:var(--text-caption)] text-danger-ink">
              {errors.description}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="treatment-status"
            className="block text-[length:var(--text-body-sm)] font-medium text-ink"
          >
            Estado
          </label>
          <select
            id="treatment-status"
            name="status"
            value={draft.status}
            onChange={(event) => set('status')(event.target.value)}
            className="mt-1.5 min-h-11 rounded-control bg-paper px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary"
          >
            {TREATMENT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="treatment-diagnosis"
            className="block text-[length:var(--text-body-sm)] font-medium text-ink"
          >
            Diagnóstico (opcional)
          </label>
          <textarea
            id="treatment-diagnosis"
            name="diagnosis"
            rows={2}
            value={draft.diagnosis}
            onChange={(event) => set('diagnosis')(event.target.value)}
            aria-invalid={Boolean(errors.diagnosis)}
            aria-describedby={errors.diagnosis ? 'treatment-diagnosis-error' : undefined}
            className="mt-1.5 w-full rounded-control bg-paper px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          {errors.diagnosis ? (
            <p id="treatment-diagnosis-error" className="mt-1.5 text-[length:var(--text-caption)] text-danger-ink">
              {errors.diagnosis}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="treatment-notes"
            className="block text-[length:var(--text-body-sm)] font-medium text-ink"
          >
            Notas (opcional)
          </label>
          <textarea
            id="treatment-notes"
            name="notes"
            rows={2}
            value={draft.notes}
            onChange={(event) => set('notes')(event.target.value)}
            className="mt-1.5 w-full rounded-control bg-paper px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="treatment-price"
              className="block text-[length:var(--text-body-sm)] font-medium text-ink"
            >
              Precio de referencia (opcional)
            </label>
            <input
              id="treatment-price"
              name="price"
              inputMode="decimal"
              value={draft.price}
              onChange={(event) => set('price')(event.target.value)}
              aria-invalid={Boolean(errors.price)}
              aria-describedby={errors.price ? 'treatment-price-error' : undefined}
              className="mt-1.5 w-full rounded-control bg-paper px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            {errors.price ? (
              <p id="treatment-price-error" className="mt-1.5 text-[length:var(--text-caption)] text-danger-ink">
                {errors.price}
              </p>
            ) : null}
          </div>

          {!isEdit && !integrated ? (
            <div>
              <label
                htmlFor="treatment-appointment"
                className="block text-[length:var(--text-body-sm)] font-medium text-ink"
              >
                Cita vinculada (opcional)
              </label>
              <select
                id="treatment-appointment"
                name="appointmentId"
                value={draft.appointmentId}
                onChange={(event) => set('appointmentId')(event.target.value)}
                className="mt-1.5 min-h-11 w-full rounded-control bg-paper px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary"
              >
                <option value="">Sin cita vinculada</option>
                {appointment ? <option value={appointment.id}>Cita actual #{appointment.id} · {appointmentLabel(appointment.startAt, appointment.timeZone)}</option> : null}
                {(appointments.data?.content ?? []).filter((item) => item.id !== appointment?.id).map((item) => (
                  <option key={item.id} value={item.id}>
                    Cita #{item.id} · {appointmentLabel(item.startAt, appointment?.timeZone)}
                  </option>
                ))}
              </select>
              {appointments.isError ? (
                <p className="mt-1.5 text-[length:var(--text-caption)] text-ink-muted">
                  No se pudieron cargar las citas del paciente. Puedes guardar sin vincular una cita.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <p className="text-[length:var(--text-caption)] text-ink-muted">
          {!isEdit && integrated ? 'Se vinculará a esta cita. ' : ''}
          El precio admite hasta 4 decimales y no genera cargos. La cita vinculada se fija al crear el
          tratamiento y no se modifica después.
        </p>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primary} disabled={save.isPending || uncertain}>
          {save.isPending ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear tratamiento'}
        </button>
        <button type="button" className={secondary} disabled={save.isPending} onClick={onClose}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function appointmentLabel(startAt: string, timeZone?: string): string {
  return new Date(startAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) });
}
