import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import {
  patientsApi,
  type ClinicalRecordDto,
  type PatientDto,
} from '../../api/patients';
import { useAuthStore } from '../../app/authStore';
import { ApiError } from '../../api/http';
import { appointmentsApi } from '../../api/appointments';
import { formatDayLong, formatTime } from '../appointments/appointmentUi';
import { FormAlert } from '../auth/ui';
import { OdontogramSection } from '../odontogram/OdontogramSection';
import { TreatmentsSection } from './TreatmentsSection';
import { ClinicalContextLabel, ClinicalDestinationPicker } from './ClinicalDestinationPicker';
import { ClinicalEntryChain } from './ClinicalCorrection';
import { ClinicalWriteReview } from './ClinicalWriteReview';
import { groupChains } from './clinicalChain';
import { clinicalTraceApi, destinationSelection, type ClinicalDestination } from '../../api/clinicalTrace';
import { FinancialAccessLink } from '../financial/FinancialAccessLink';
import { useUnsavedChanges } from '../../app/unsavedChanges';
import { IntakeDeclarations } from '../medical-intake/PatientIntakeProfile';
import { PatientProfile } from '../patient/PatientProfile';
import { PatientFacts } from './PatientFacts';
import { ReceptionPatientRecord } from './ReceptionPatients';
import { PatientRecordTabs } from './PatientRecordTabs';
import './patient-record.css';

/**
 * Detalle del paciente. La informacion administrativa la gestionan OWNER/RECEPTIONIST; el
 * expediente clinico lo leen y lo escriben OWNER y DENTIST (matriz §7.4: el OWNER siempre tiene
 * perfil de dentista, AD-11). El PATIENT solo ve su propia ficha, y el backend responde 404 ante
 * cualquier ficha ajena.
 */
export function PatientDetailPage() {
  const { id } = useParams();
  const patient = useAuthStore(state => state.user?.role === 'PATIENT');
  return patient ? <PatientProfile patientId={Number(id)} /> : <StaffPatientDetailPage />;
}

function StaffPatientDetailPage() {
  const { id } = useParams();
  const patientId = Number(id);
  const [searchParams] = useSearchParams();
  const appointmentId = Number(searchParams.get('appointmentId'));
  const occurrenceVersion = Number(searchParams.get('occurrenceVersion'));
  const user = useAuthStore((state) => state.user);
  const role = user?.role;
  const isPatient = role === 'PATIENT';
  const canViewRecord = !isPatient || user?.patientId === patientId;

  const canReadClinical = role === 'OWNER' || role === 'DENTIST';
  const canWriteClinical = role === 'OWNER' || role === 'DENTIST';
  const hasAppointmentContext = canReadClinical && Number.isSafeInteger(appointmentId) && appointmentId > 0;
  const context = useQuery({
    queryKey: ['appointment', appointmentId],
    queryFn: () => appointmentsApi.get(appointmentId),
    enabled: hasAppointmentContext,
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => patientsApi.get(patientId),
    enabled: Number.isFinite(patientId) && canViewRecord,
  });

  if (!Number.isFinite(patientId)) {
    return <p className="px-5 py-8 text-danger-ink">Paciente inválido.</p>;
  }

  // La ficha administrativa compartida no da a recepción acceso al expediente.
  if (role === 'RECEPTIONIST') {
    return <ReceptionPatientRecord patientId={patientId} />;
  }

  if (role === 'OWNER') {
    return <div className="owner-chrome owner-patients">
      <ReceptionPatientRecord key={patientId} patientId={patientId} renderContent={administration => <>
        {hasAppointmentContext && context.isPending ? <p role="status">Cargando contexto de la cita…</p> : null}
        {hasAppointmentContext && context.isError ? <div><FormAlert>No se pudo cargar la cita de origen. Puedes seguir consultando el expediente.</FormAlert><button type="button" className="reception-link" onClick={() => void context.refetch()}>Reintentar contexto</button></div> : null}
        {hasAppointmentContext && context.data && context.data.patientId !== patientId ? <p>La cita de origen no corresponde a este paciente.</p> : null}
        {!context.isError && context.data?.patientId === patientId ? <p className="reception-readonly-note">
          Desde la cita #{context.data.id} · <Link className="reception-link" to={`/appointments/${context.data.id}${Number.isSafeInteger(occurrenceVersion) && occurrenceVersion > 0 && occurrenceVersion <= context.data.occurrenceVersion ? `?occurrenceVersion=${occurrenceVersion}` : ''}`}>Volver a la atención</Link>
        </p> : null}
        <PatientRecordTabs sections={[
          { id: 'administration', label: 'Administración', content: <div className="patient-record-administration">{administration}</div> },
          { id: 'declarations', label: 'Declaraciones del paciente', content: <IntakeDeclarations patientId={patientId} /> },
          { id: 'record', label: 'Expediente clínico', content: <>
            <ClinicalRecordIntro editable={canWriteClinical} />
            <h2 className="text-[length:var(--text-h5)]">Observaciones del odontólogo</h2>
            <ClinicalRecordCard patientId={patientId} editable={canWriteClinical} />
          </> },
          { id: 'odontogram', label: 'Odontograma', content: <OdontogramSection patientId={patientId} editable={canWriteClinical} /> },
          { id: 'treatments', label: 'Tratamientos', content: <TreatmentsSection patientId={patientId} editable={canWriteClinical} /> },
          { id: 'notes', label: 'Notas clínicas', content: <ClinicalNotesCard patientId={patientId} editable={canWriteClinical} /> },
        ]} />
      </>} />
    </div>;
  }

  return (
    <div className="mx-auto w-full max-w-[64rem] px-5 py-8 md:px-8">
      {isPatient ? (
        <header>
          <h1 className="text-[length:var(--text-h3)] tracking-[-0.025em] text-ink">Mis datos</h1>
          <p className="mt-1 text-[length:var(--text-body-app)] text-ink-secondary">Consulta tus datos registrados.</p>
        </header>
      ) : <Link
        to="/patients"
        className="text-[length:var(--text-body-sm)] text-ink-secondary underline underline-offset-2"
      >
        ← Volver al listado
      </Link>}

      {hasAppointmentContext && context.isPending ? <p role="status" className="mt-3">Cargando contexto de la cita…</p> : null}
      {hasAppointmentContext && context.isError ? <div className="mt-3"><FormAlert>No se pudo cargar la cita de origen. Puedes seguir consultando el expediente.</FormAlert><button type="button" className="min-h-11 underline" onClick={() => void context.refetch()}>Reintentar contexto</button></div> : null}
      {hasAppointmentContext && context.data && context.data.patientId !== patientId ? <p className="mt-3 text-ink-secondary">La cita de origen no corresponde a este paciente.</p> : null}
      {canReadClinical && !context.isError && context.data?.patientId === patientId ? (
        <p className="mt-3 text-ink-secondary">
          Desde la cita #{context.data.id} ·{' '}
          <Link className="underline underline-offset-2" to={`/appointments/${context.data.id}${Number.isSafeInteger(occurrenceVersion) && occurrenceVersion > 0 && occurrenceVersion <= context.data.occurrenceVersion ? `?occurrenceVersion=${occurrenceVersion}` : ''}`}>Volver a la atención</Link>
        </p>
      ) : null}
      {isLoading ? <p className="mt-6 text-ink-muted">Cargando…</p> : null}
      {!canViewRecord || isError ? (
        <p role="alert" className="mt-6 text-danger-ink">
          {!canViewRecord || (error instanceof ApiError && error.status === 404)
            ? isPatient ? 'No se encontró tu ficha de paciente. Contacta con la clínica.' : 'No se encontró el paciente.'
            : isPatient ? 'No se pudieron cargar tus datos.' : 'No se pudo cargar el paciente.'}
        </p>
      ) : null}

      {data && canViewRecord ? (
        <>
          <header className="mt-4">
            {isPatient ? <p className="text-[length:var(--text-h5)] text-ink">{data.lastName}, {data.firstName}</p> : <h1 className="text-[length:var(--text-h3)] tracking-[-0.025em] text-ink">
              {data.lastName}, {data.firstName}
            </h1>}
            <p className="mt-1 text-[length:var(--text-body-app)] text-ink-secondary">
              {data.active ? 'Paciente activo' : 'Paciente inactivo'}
              {data.userId ? ' · Con cuenta de acceso' : ' · Sin cuenta de acceso'}
            </p>
          </header>

          <AdminPatientSummary patient={data} />

          <FinancialAccessLink patientId={patientId} />
          {isPatient ? <Link to="/patient-profile" className="mt-5 inline-flex min-h-11 items-center underline">Consultar y actualizar mi información de salud</Link> : null}
          {canReadClinical ? <><IntakeDeclarations patientId={patientId} /><h2 className="mt-8 text-[length:var(--text-h4)]">Observaciones del odontólogo</h2></> : null}
          {canReadClinical ? (
            <ClinicalSection key={`clinical-${patientId}`} patientId={patientId} editable={canWriteClinical} />
          ) : null}
          {role === 'PATIENT' ? <PatientOdontogramSummary patientId={patientId} /> : null}
        </>
      ) : null}
    </div>
  );
}

/** El PATIENT solo consulta el resumen de su propio odontograma (RF-OD-08, matriz §7.4). */
function PatientOdontogramSummary({ patientId }: { patientId: number }) {
  const userPatientId = useAuthStore((state) => state.user?.patientId);
  if (userPatientId !== patientId) return null;
  return <OdontogramSection patientId={patientId} summary />;
}

function AdminPatientSummary({ patient }: { patient: PatientDto }) {
  return (
    <section className="mt-8 rounded-card bg-paper p-6 ring-1 ring-hairline">
      <h2 className="text-[length:var(--text-h5)] text-ink">Datos administrativos</h2>
      <PatientFacts
        variant="card"
        facts={[
          { label: 'Email', value: patient.email ?? '—' },
          { label: 'Teléfono', value: patient.phone ?? '—' },
          { label: 'Fecha de nacimiento', value: patient.birthDate ?? '—' },
          { label: 'Notas administrativas', value: patient.administrativeNotes ?? '—' },
        ]}
      />
    </section>
  );
}

function ClinicalSection({ patientId, editable }: { patientId: number; editable: boolean }) {
  return (
    <section className="mt-8 grid gap-4">
      <ClinicalRecordIntro editable={editable} />
      <ClinicalRecordCard patientId={patientId} editable={editable} />
      <OdontogramSection patientId={patientId} editable={editable} />
      <TreatmentsSection patientId={patientId} editable={editable} />
      <ClinicalNotesCard patientId={patientId} editable={editable} />
    </section>
  );
}

function ClinicalRecordIntro({ editable }: { editable: boolean }) {
  return <div className="rounded-card bg-paper p-6 ring-1 ring-hairline">
        <p className="text-[length:var(--text-micro)] font-medium uppercase tracking-[0.05em] text-ink-muted">
          Dato de salud protegido
        </p>
        <h2 className="mt-1 text-[length:var(--text-h5)] text-ink">Expediente clínico</h2>
        <p className="mt-1 text-[length:var(--text-body-sm)] text-ink-secondary">
          {editable
            ? 'Los datos clínicos son sensibles. Las notas son inmutables una vez registradas.'
            : 'Solo lectura. El expediente clínico no se modifica desde este perfil.'}
        </p>
      </div>;
}

export function ClinicalRecordCard({ patientId, editable }: { patientId: number; editable: boolean }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['clinical-record', patientId],
    queryFn: () => patientsApi.getClinicalRecord(patientId),
  });

  if (isLoading) return <p role="status" className="text-ink-muted">Cargando expediente…</p>;
  return (
    <>
    {isError ? <div><FormAlert>No se pudo cargar el expediente.</FormAlert><button type="button" className="min-h-11 underline" onClick={() => void refetch()}>Reintentar expediente</button></div> : null}
    {!isError || data ? (
    <ClinicalRecordForm
      key={patientId}
      patientId={patientId}
      editable={editable}
      record={
        data ?? {
          patientId,
          medicalBackground: '',
          allergies: '',
          clinicalHistory: '',
          generalObservations: '',
        }
      }
    />
    ) : null}
    </>
  );
}

function ClinicalRecordForm({
  patientId,
  editable,
  record,
}: {
  patientId: number;
  editable: boolean;
  record: ClinicalRecordDto;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => {
    const draft = toDraft(record);
    return { record, draft, baseline: draft, revision: 0 };
  });
  const { draft } = form;
  const dirty = isRecordDraftDirty(draft, form.baseline);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reconcile before committing a render so clean refetches never register a false draft.
  // A dirty editor retains both its contents and the baseline it was edited against.
  if (form.record !== record) {
    const confirmed = toDraft(record);
    setForm({ ...form, record, ...(!dirty ? { draft: confirmed, baseline: confirmed } : {}) });
  }

  useUnsavedChanges(editable && dirty);

  const save = useMutation({
    retry: false,
    onMutate: () => queryClient.cancelQueries({ queryKey: ['clinical-record', patientId] }),
    mutationFn: (submitted: { draft: ReturnType<typeof toDraft>; revision: number }) => patientsApi.saveClinicalRecord(patientId, submitted.draft),
    onSuccess: async (saved, submitted) => {
      // Also fence off reads started during the PUT before publishing its confirmed response.
      await queryClient.cancelQueries({ queryKey: ['clinical-record', patientId] });
      const confirmed = toDraft(saved);
      setForm(current => ({
        ...current,
        baseline: confirmed,
        // A late response must not discard edits queued after this submission.
        draft: current.revision === submitted.revision ? confirmed : current.draft,
      }));
      setNotice('Expediente guardado.');
      setError(null);
      queryClient.setQueryData(['clinical-record', patientId], saved);
    },
    onError: (cause) => {
      setNotice(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el expediente.');
    },
    onSettled: () => { submitting.current = false; },
  });
  const submitting = useRef(false);

  const fields: Array<{ key: keyof typeof draft; label: string }> = [
    { key: 'medicalBackground', label: 'Antecedentes médicos' },
    { key: 'allergies', label: 'Alergias' },
    { key: 'clinicalHistory', label: 'Historia clínica' },
    { key: 'generalObservations', label: 'Observaciones generales' },
  ];

  return (
    <div className="rounded-card bg-paper p-6 ring-1 ring-hairline">
      <h3 className="text-[length:var(--text-body-app)] font-medium text-ink">Datos del expediente</h3>
      {notice ? (
        <div className="mt-3">
          <FormAlert tone="success">{notice}</FormAlert>
        </div>
      ) : null}
      {error ? (
        <div className="mt-3">
          <FormAlert>{error}</FormAlert>
        </div>
      ) : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {fields.map((field) =>
          editable ? (
            <div key={field.key}>
              <label
                htmlFor={`clinical-${field.key}`}
                className="block text-[length:var(--text-body-sm)] font-medium text-ink"
              >
                {field.label}
              </label>
              <textarea
                id={`clinical-${field.key}`}
                disabled={save.isPending}
                value={draft[field.key]}
                onChange={(event) => {
                  const value = event.target.value;
                  const confirmed = toDraft(queryClient.getQueryData<ClinicalRecordDto>(['clinical-record', patientId]) ?? record);
                  setForm(current => {
                    const next = { ...current.draft, [field.key]: value };
                    // Reverting the last local change makes a deferred external refresh safe to adopt.
                    const reverted = !isRecordDraftDirty(next, current.baseline);
                    return { ...current, draft: reverted ? confirmed : next, baseline: reverted ? confirmed : current.baseline, revision: current.revision + 1 };
                  });
                }}
                rows={2}
                className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
          ) : (
            <div key={field.key}>
              <p className="text-[length:var(--text-caption)] uppercase tracking-[0.05em] text-ink-muted">
                {field.label}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-[length:var(--text-body-app)] text-ink">
                {draft[field.key] || '—'}
              </p>
            </div>
          ),
        )}
      </div>
      {editable ? (
        <button
          type="button"
          onClick={() => { if (submitting.current) return; submitting.current = true; save.mutate({ draft, revision: form.revision }); }}
          disabled={save.isPending}
          className="mt-4 rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-paper outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        >
          {save.isPending ? 'Guardando…' : 'Guardar expediente'}
        </button>
      ) : null}
    </div>
  );
}

export function ClinicalNotesCard({ patientId, editable, timeZone, appointment, displayNotes = true, generalOnly = false, editorial = false, contextualWriteBlocked = false, consoleMode = false, compose = true }: {
  patientId: number; editable: boolean; timeZone?: string; appointment?: ClinicalDestination | undefined;
  displayNotes?: boolean; generalOnly?: boolean;
  editorial?: boolean;
  contextualWriteBlocked?: boolean;
  consoleMode?: boolean;
  compose?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: generalOnly ? ['clinical-notes', patientId, 'general'] : ['clinical-notes', patientId],
    queryFn: () => patientsApi.listClinicalNotes(patientId, generalOnly),
    enabled: displayNotes,
  });
  const [content, setContent] = useState('');
  const [destination, setDestination] = useState<ClinicalDestination | null>(() => appointment ?? null);
  const [uncertain, setUncertain] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const offered = appointment ?? destination;
  const support = useQuery({
    queryKey: ['clinical-trace', patientId, offered?.appointmentId, offered?.occurrenceVersion, 'NOTES', 0],
    queryFn: () => clinicalTraceApi.notes(patientId, offered!),
    enabled: destination !== null && offered !== null,
  });
  const contextualBlocked = destination !== null && (contextualWriteBlocked || support.isPending || support.isError
    || (offered !== null && (destination.appointmentId !== offered.appointmentId || destination.occurrenceVersion !== offered.occurrenceVersion))
    || support.data?.context.currentOccurrenceVersion !== destination.occurrenceVersion
    || support.data?.context.currentStatus === 'CANCELLED' || support.data?.context.currentStatus === 'NO_SHOW');
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [correctingId, setCorrectingId] = useState<number | null>(null);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [uncertainCorrection, setUncertainCorrection] = useState(false);
  const correctingLock = useRef(false);

  useUnsavedChanges(editable && (content.trim() !== '' || uncertain || uncertainCorrection));

  const addNote = useMutation({
    retry: false,
    mutationFn: (text: string) => patientsApi.addClinicalNote(patientId, text, appointment || destination ? destinationSelection(destination) : undefined),
    onSuccess: () => {
      setContent('');
      setError(null);
      setUncertain(false);
      setReviewed(false);
      setDestination(appointment ?? null);
      void queryClient.invalidateQueries({ queryKey: ['clinical-notes', patientId] });
      void queryClient.invalidateQueries({ queryKey: ['clinical-trace', patientId] });
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : 'No se pudo añadir la nota.');
      setUncertain(!(cause instanceof ApiError) || cause.status >= 500);
      setReviewed(false);
      if (cause instanceof ApiError && cause.status === 409 && destination) {
        void queryClient.invalidateQueries({ queryKey: ['appointment', destination.appointmentId] });
        void queryClient.invalidateQueries({ queryKey: ['clinical-trace', patientId] });
      }
    },
    onSettled: () => { submitting.current = false; },
  });

  const correctNote = useMutation({
    retry: false,
    mutationFn: ({ noteId, content, reason }: { noteId: number; content: string; reason: string }) =>
      patientsApi.correctClinicalNote(patientId, noteId, { content, correctionReason: reason }),
    onSuccess: () => {
      setCorrectingId(null);
      setCorrectionError(null);
      void queryClient.invalidateQueries({ queryKey: ['clinical-notes', patientId] });
      void queryClient.invalidateQueries({ queryKey: ['clinical-trace', patientId] });
    },
    onError: (cause) => {
      setCorrectionError(cause instanceof Error ? cause.message : 'No se pudo guardar la corrección.');
      setUncertainCorrection(!(cause instanceof ApiError) || cause.status >= 500);
    },
    onSettled: () => { correctingLock.current = false; },
  });

  return (
    <div className="rounded-card bg-paper p-6 ring-1 ring-hairline">
      <h3 className="text-[length:var(--text-body-app)] font-medium text-ink">{displayNotes ? 'Notas clínicas' : consoleMode ? 'Nota de la consulta' : 'Registrar nota clínica'}</h3>
      {displayNotes || !editorial ? <p className="mt-1 text-[length:var(--text-caption)] text-ink-muted">
        {editorial ? 'Las notas guardadas se conservan. Una corrección añade una nueva versión con su motivo.' : 'Append-only: no se editan ni se eliminan; las correcciones se añaden como versiones nuevas con su motivo.'}
      </p> : null}
      {error ? (
        <div className="mt-3">
          <FormAlert>{error}</FormAlert>
        </div>
      ) : null}

      {addNote.isSuccess && !content ? <FormAlert tone="success">{editorial ? 'Nota clínica guardada. Consulta su vínculo en los registros de la atención o en el historial general.' : 'Nota clínica guardada en el expediente del paciente.'}</FormAlert> : null}
      {uncertainCorrection ? <ClinicalWriteReview onRead={async () => !(await refetch()).isError} onAllow={() => setUncertainCorrection(false)} /> : null}
      {uncertain ? <div className="mt-3 grid gap-2"><p role="status">No sabemos si el envío llegó a guardarse. Consulta los registros antes de repetir; no se reintentará automáticamente.</p>
        <button type="button" className="min-h-11 underline" onClick={async () => { const result = await refetch(); setReviewed(!result.isError); }}>Consultar registros antes de repetir</button>
        {reviewed ? <button type="button" className="min-h-11 underline" onClick={() => { setUncertain(false); setReviewed(false); }}>He revisado los registros; permitir otro envío</button> : null}</div> : null}
      {uncertain && data ? <p className="mt-3 text-ink-secondary">Registros consultados del paciente (incluyen otras atenciones):</p> : null}
      {isLoading && (displayNotes || uncertain) ? <p role="status" className="mt-3 text-ink-muted">Cargando notas…</p> : null}
      {isError && (displayNotes || uncertain) ? <div><FormAlert>No se pudieron cargar las notas.</FormAlert><button type="button" className="min-h-11 underline" onClick={() => void refetch()}>Reintentar notas</button></div> : null}
      {data && data.length === 0 && (displayNotes || uncertain) ? (
        <p className="mt-3 text-ink-secondary">Todavía no hay notas clínicas.</p>
      ) : null}
      {data && data.length > 0 && (displayNotes || uncertain) ? (
        <ol className="mt-4 grid gap-3">
          {groupChains(data).map(({ root, corrections }) => (
            <li key={root.id}>
              <ClinicalEntryChain
                root={root}
                corrections={corrections}
                editable={editable}
                correcting={correctingId === root.id}
                pending={(correctNote.isPending || uncertainCorrection) && correctingId === root.id}
                error={correctingId === root.id ? correctionError : null}
                getContent={(entry) => entry.content}
                renderEntry={(entry) => (
                  <p className="whitespace-pre-wrap break-words text-[length:var(--text-body-app)] text-ink">
                    {entry.content}
                  </p>
                )}
                renderMeta={(entry) => (
                  <>
                    {entry.authorName} · {timeZone ? `${formatDayLong(entry.createdAt, timeZone)} ${formatTime(entry.createdAt, timeZone)}` : new Date(entry.createdAt).toLocaleString()}
                    {' · '}<ClinicalContextLabel context={entry.appointmentContext} />
                  </>
                )}
                onStartCorrect={() => { setCorrectionError(null); setCorrectingId(root.id); }}
                onCancelCorrect={() => { setCorrectionError(null); setCorrectingId(null); }}
                onSubmitCorrect={(content, reason) => { if (correctingLock.current || uncertainCorrection) return; correctingLock.current = true; correctNote.mutate({ noteId: root.id, content, reason }); }}
              />
            </li>
          ))}
        </ol>
      ) : null}

      {editable && compose ? (
        <section aria-label="Formulario de nota clínica" className="mt-4">
          <ClinicalDestinationPicker current={appointment} destination={destination} onChange={setDestination} disabled={addNote.isPending || uncertain} editorial={editorial} compact={consoleMode} />
          {contextualBlocked ? <p role="status" className="my-2 text-ink-secondary">{contextualWriteBlocked
            ? 'Esta cita no permite nuevas notas vinculadas. Tu borrador se conserva; puedes copiarlo o elegir expresamente guardarlo como registro general del paciente.' : support.isPending
            ? 'Comprobando contexto clínico antes de guardar…'
            : 'La cita no permite guardar información contextual o no se pudo verificar su trazabilidad. Reintenta la lectura o elige explícitamente un registro general.'}</p> : null}
          {support.isError && destination ? <button type="button" className="min-h-11 underline" onClick={() => void support.refetch()}>Reintentar contexto clínico</button> : null}
          <label
            htmlFor="new-note"
            className="block text-[length:var(--text-body-sm)] font-medium text-ink"
          >
            {consoleMode ? 'Contenido de la nota' : 'Nueva nota clínica'}
          </label>
          <textarea
            id="new-note"
            disabled={addNote.isPending}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={3}
            className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-app)] text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <button
            type="button"
            onClick={() => {
              if (submitting.current || uncertain || contextualBlocked || content.trim() === '') return;
              submitting.current = true;
              addNote.mutate(content.trim());
            }}
            disabled={addNote.isPending || uncertain || contextualBlocked || content.trim() === ''}
            className="mt-3 min-h-11 rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-paper outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
          >
            {addNote.isPending ? 'Guardando nota…' : consoleMode ? 'Guardar nota' : 'Añadir nota'}
          </button>
          {content && !addNote.isPending ? <button type="button" className="ml-3 min-h-11 underline" onClick={() => { setContent(''); setError(null); }}>Descartar borrador de nota</button> : null}
        </section>
      ) : null}
    </div>
  );
}

function toDraft(record: ClinicalRecordDto) {
  return {
    medicalBackground: record.medicalBackground ?? '',
    allergies: record.allergies ?? '',
    clinicalHistory: record.clinicalHistory ?? '',
    generalObservations: record.generalObservations ?? '',
  };
}

function isRecordDraftDirty(draft: ReturnType<typeof toDraft>, baseline: ReturnType<typeof toDraft>): boolean {
  return draft.medicalBackground !== baseline.medicalBackground || draft.allergies !== baseline.allergies
    || draft.clinicalHistory !== baseline.clinicalHistory || draft.generalObservations !== baseline.generalObservations;
}
