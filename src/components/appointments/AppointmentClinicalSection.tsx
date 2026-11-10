import { useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { AppointmentResponse } from '../../api/appointments';
import { patientsApi } from '../../api/patients';
import { treatmentsApi } from '../../api/treatments';
import { FormAlert } from '../auth/ui';
import { OdontogramSection } from '../odontogram/OdontogramSection';
import { OdontogramEvents } from '../odontogram/OdontogramEvents';
import { ClinicalNotesCard, ClinicalRecordCard } from '../patients/PatientDetailPage';
import { TreatmentsSection } from '../patients/TreatmentsSection';
import { treatmentStatusLabel } from '../patients/treatmentUi';
import { AttentionTraceSection } from './AttentionTraceSection';
import { schedulingApi } from '../../api/scheduling';

/** Lazy on first expansion, then kept mounted: collapsing does not discard clinical drafts. */
function ClinicalPanel({ title, initiallyOpen = false, children }: { title: string; initiallyOpen?: boolean; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(initiallyOpen);
  const [visited, setVisited] = useState(initiallyOpen);
  return <section className="mt-4 min-w-0">
    <h3>
      <button type="button" aria-expanded={open} aria-controls={id}
         className="min-h-11 max-w-full rounded-control bg-input-fill px-4 py-2 text-left font-medium text-ink outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-primary"
        onClick={() => { setVisited(true); setOpen(!open); }}>
        {title} <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
    </h3>
    <div id={id} hidden={!open} className="mt-3">{visited ? children : null}</div>
  </section>;
}

/** Only mounted for OWNER/DENTIST by the appointment page; backend gates remain authoritative. */
export function AppointmentClinicalSection({ appointment, timeZone, initialOccurrenceVersion }: { appointment: AppointmentResponse; timeZone: string; initialOccurrenceVersion?: number | undefined }) {
  const [historicalVersion, setHistoricalVersion] = useState<number | null>(() => initialOccurrenceVersion ?? null);
  const version = historicalVersion ?? appointment.occurrenceVersion;
  const record = useQuery({
    queryKey: ['clinical-record', appointment.patientId],
    queryFn: () => patientsApi.getClinicalRecord(appointment.patientId),
  });
  return <section aria-label="Atención clínica" className="mt-6">
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <h2 className="text-[length:var(--text-h5)] text-ink">Atención clínica · {appointment.patientFirstName} {appointment.patientLastName}</h2>
      <Link to={`/patients/${appointment.patientId}?appointmentId=${appointment.id}&occurrenceVersion=${version}`}
        className="min-h-11 py-2 text-ink-secondary underline underline-offset-2">Abrir ficha y expediente</Link>
    </div>
    <p className="mt-1 text-ink-secondary">Dato de salud protegido. Guarda cada registro durante la atención; no necesitas completar la cita.</p>
    <div className="mt-3 rounded-card bg-paper p-5 ring-1 ring-hairline">
      <h3 className="mb-2 font-medium text-ink">Antecedentes y alergias · estado actual del paciente</h3>
      {record.isPending ? <p role="status">Cargando antecedentes y alergias…</p> : null}
      {record.isError ? <><FormAlert>No se pudieron cargar los antecedentes y alergias.</FormAlert>
        <button type="button" className="min-h-11 underline" onClick={() => void record.refetch()}>Reintentar antecedentes</button></> : null}
      {!record.isPending && !record.isError ? <dl className="grid gap-3 md:grid-cols-2">
        <div><dt className="font-medium text-ink">Antecedentes médicos</dt><dd className="mt-1 whitespace-pre-wrap break-words text-ink-secondary">{record.data?.medicalBackground || 'Sin antecedentes registrados.'}</dd></div>
        <div><dt className="font-medium text-ink">Alergias registradas</dt><dd className="mt-1 whitespace-pre-wrap break-words text-ink-secondary">{record.data?.allergies || 'Sin información de alergias registrada.'}</dd></div>
      </dl> : null}
    </div>
    <ClinicalPanel title="Esta atención" initiallyOpen>
      <label className="grid max-w-xs gap-2 text-ink-secondary">Ocurrencia a consultar
        <input type="number" min={1} max={appointment.occurrenceVersion} value={version}
          className="min-h-11 rounded-control bg-input-fill px-3 py-2 text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
          onChange={(event) => { const next = Number(event.target.value); if (Number.isSafeInteger(next) && next >= 1 && next <= appointment.occurrenceVersion) setHistoricalVersion(next); }} />
      </label>
      <button type="button" className="my-2 min-h-11 underline" onClick={() => setHistoricalVersion(null)}>Consultar ocurrencia actual</button>
      <AttentionTraceSection key={version} patientId={appointment.patientId} selection={{ appointmentId: appointment.id, occurrenceVersion: version }} timeZone={timeZone} />
      <p className="mt-4 text-ink-secondary">Las nuevas entradas utilizan el destino indicado en cada formulario. Describe explícitamente lo realizado; no se deduce del tratamiento ni del servicio reservado.</p>
      <ClinicalNotesCard patientId={appointment.patientId} editable timeZone={timeZone} displayNotes={false}
        appointment={{ appointmentId: appointment.id, occurrenceVersion: appointment.occurrenceVersion, startAt: appointment.startAt, timeZone }} />
    </ClinicalPanel>
    <ClinicalPanel title="Historial del paciente">
      <p className="text-ink-secondary">Notas longitudinales: generales y de otras atenciones con sus contextos conocidos.</p>
      <ClinicalNotesCard patientId={appointment.patientId} editable={false} timeZone={timeZone} />
    </ClinicalPanel>
    <ClinicalPanel title="Tratamientos y evolución"><TreatmentsSection patientId={appointment.patientId} editable appointment={{ id: appointment.id, occurrenceVersion: appointment.occurrenceVersion, startAt: appointment.startAt, timeZone }} /></ClinicalPanel>
    <ClinicalPanel title="Expediente y antecedentes"><p className="text-ink-secondary">Estado actual del paciente; no es una reconstrucción de esta atención.</p><ClinicalRecordCard patientId={appointment.patientId} editable /></ClinicalPanel>
    <ClinicalPanel title="Odontograma"><OdontogramSection patientId={appointment.patientId} editable timeZone={timeZone}
      appointment={{ appointmentId: appointment.id, occurrenceVersion: appointment.occurrenceVersion, startAt: appointment.startAt, timeZone }}
      initialHistorySelection={{ appointmentId: appointment.id, occurrenceVersion: version }} /></ClinicalPanel>
  </section>;
}

export function CompletionReview({ appointment, timeZone }: { appointment: AppointmentResponse; timeZone?: string | undefined }) {
  return <div className="mb-3 grid min-w-0 grid-cols-1 gap-3">
    <h3 className="font-medium text-ink">Revisión opcional de la atención</h3>
    <p>{appointment.patientFirstName} {appointment.patientLastName} · Cita #{appointment.id}</p>
    <p className="text-ink-secondary">Puedes cerrar sin notas ni tratamientos. Completar no guarda borradores ni genera tratamientos o cobros.</p>
    <ClinicalPanel title="Consultar registros antes de cerrar">
      <div className="grid min-w-0 grid-cols-1 gap-4">
        <CompletionAntecedents patientId={appointment.patientId} />
        <SavedClinicalReview appointment={appointment} timeZone={timeZone} />
        <CompletionOdontogram appointment={appointment} timeZone={timeZone} />
      </div>
    </ClinicalPanel>
  </div>;
}

function CompletionAntecedents({ patientId }: { patientId: number }) {
  const record = useQuery({ queryKey: ['clinical-record', patientId], queryFn: () => patientsApi.getClinicalRecord(patientId) });
  return <section aria-label="Antecedentes y alergias para el cierre" className="rounded-control bg-sunken p-3 text-[length:var(--text-body-sm)]">
    <h4 className="font-medium text-ink">Antecedentes y alergias (estado actual)</h4>
    {record.isPending ? <p role="status" className="mt-1 text-ink-muted">Cargando antecedentes y alergias…</p> : null}
    {record.isError ? <div className="mt-1 grid justify-items-start gap-1"><FormAlert>No se pudieron cargar los antecedentes y alergias.</FormAlert>
      <button type="button" className="min-h-11 underline" onClick={() => void record.refetch()}>Reintentar antecedentes</button></div> : null}
    {record.isSuccess ? <dl className="mt-1 grid gap-2 md:grid-cols-2">
      <div><dt className="font-medium text-ink">Antecedentes médicos</dt><dd className="mt-1 whitespace-pre-wrap break-words text-ink-secondary">{record.data?.medicalBackground || 'Sin antecedentes registrados.'}</dd></div>
      <div><dt className="font-medium text-ink">Alergias</dt><dd className="mt-1 whitespace-pre-wrap break-words text-ink-secondary">{record.data?.allergies || 'Sin información de alergias registrada.'}</dd></div>
    </dl> : null}
  </section>;
}

function CompletionOdontogram({ appointment, timeZone }: { appointment: AppointmentResponse; timeZone?: string | undefined }) {
  return <section aria-label="Cambios del odontograma en esta atención" className="grid min-w-0 grid-cols-1 gap-2">
    <h4 className="font-medium text-ink">Cambios del odontograma en esta atención</h4>
    <p className="text-[length:var(--text-body-sm)] text-ink-secondary">Solo lectura. Se muestran los eventos atribuidos explícitamente a esta ocurrencia; el cierre no depende de ellos.</p>
    <OdontogramEvents patientId={appointment.patientId}
      filters={{ appointmentId: appointment.id, occurrenceVersion: appointment.occurrenceVersion }} timeZone={timeZone} />
  </section>;
}

function SavedClinicalReview({ appointment, timeZone }: { appointment: AppointmentResponse; timeZone?: string | undefined }) {
  const treatments = useQuery({ queryKey: ['treatments', appointment.patientId], queryFn: () => treatmentsApi.list(appointment.patientId) });
  const schedule = useQuery({ queryKey: ['public-schedule'], queryFn: () => schedulingApi.getPublicSchedule() });
  const linked = treatments.data?.filter((item) => item.appointmentId === appointment.id);
  const traceZone = timeZone ?? schedule.data?.timezone;
  return <div className="grid min-w-0 grid-cols-1 gap-2 text-[length:var(--text-body-sm)]">
    {treatments.isPending ? <p role="status">Cargando revisión… Puedes confirmar el cierre.</p> : null}
    {treatments.isError ? <FormAlert>No se pudo cargar toda la revisión. Puedes completar la cita o volver a la atención y reintentar.</FormAlert> : null}
    {traceZone ? <AttentionTraceSection patientId={appointment.patientId} selection={{ appointmentId: appointment.id, occurrenceVersion: appointment.occurrenceVersion }} timeZone={traceZone} /> : null}
    {treatments.isSuccess ? <>
      <p>Tratamientos vinculados a esta cita: {linked?.length ?? 0}.</p>
      <ul className="grid gap-1">{linked?.map((item) => <li key={item.id} className="whitespace-pre-wrap break-words">{item.description} · {treatmentStatusLabel(item.status)}</li>)}</ul>
      <p className="text-ink-secondary">La vinculación inicial de un tratamiento no acredita procedimientos realizados. Las evoluciones de esta atención se muestran por su contexto explícito.</p>
    </> : null}
  </div>;
}
