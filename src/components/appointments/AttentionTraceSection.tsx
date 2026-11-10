import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clinicalTraceApi, type AppointmentSelection, type OccurrenceContext } from '../../api/clinicalTrace';
import type { ChainEntry } from '../patients/clinicalChain';
import { FormAlert } from '../auth/ui';
import { ClinicalContextLabel } from '../patients/ClinicalDestinationPicker';
import { statusLabel } from './appointmentUi';

export function AttentionTraceSection({ patientId, selection, timeZone, editorial = false, compact = false }: { patientId: number; selection: AppointmentSelection; timeZone: string; editorial?: boolean; compact?: boolean }) {
  const [notesPage, setNotesPage] = useState(0);
  const [evolutionPage, setEvolutionPage] = useState(0);
  const notes = useQuery({ queryKey: ['clinical-trace', patientId, selection.appointmentId, selection.occurrenceVersion, 'NOTES', notesPage],
    queryFn: () => clinicalTraceApi.notes(patientId, selection, notesPage) });
  const evolutions = useQuery({ queryKey: ['clinical-trace', patientId, selection.appointmentId, selection.occurrenceVersion, 'EVOLUTIONS', evolutionPage],
    queryFn: () => clinicalTraceApi.evolutions(patientId, selection, evolutionPage) });
  const context = notes.data?.context ?? evolutions.data?.context;
  const entryTimeZone = context?.timezone ?? timeZone;
  return <div className="grid min-w-0 grid-cols-1 gap-4" aria-label="Registros de esta atención">
    {context ? editorial ? <p className="dc-caption">{context.kind === 'HISTORICAL_UNKNOWN' ? 'No se conservó el horario de esta programación anterior. No se sustituye por el actual.' : selection.occurrenceVersion !== context.currentOccurrenceVersion ? 'Registros de una programación anterior; no corresponden al horario actual.' : 'Registros guardados expresamente para esta atención.'}</p> : <ContextDescription context={context} /> : null}
    {notes.isPending || evolutions.isPending ? <p role="status">Cargando registros de esta atención…</p> : null}
    {notes.isError || evolutions.isError ? <div className="grid justify-items-start gap-2"><FormAlert>{editorial ? 'No se pudieron cargar todos los registros de esta atención. Reintenta la consulta antes de repetir un envío.' : 'No se pudo cargar toda la revisión. Puedes completar la cita o consultar los registros antes de repetir un envío.'}</FormAlert>
      <button type="button" className="min-h-11 underline underline-offset-2" onClick={() => { void notes.refetch(); void evolutions.refetch(); }}>Reintentar registros de la atención</button></div> : null}
    <section aria-label="Notas de esta atención">
      <h4 className="font-medium text-ink">Notas de esta atención</h4>
      {notes.data ? <><p className="text-ink-secondary">Notas vinculadas a esta atención: {notes.data.results.totalElements}.</p>
        <ul hidden={compact} className="mt-2 grid gap-3">{notes.data.results.content.map((chain) => <li key={chain.recordId}>
          <p className="whitespace-pre-wrap break-words">{chain.currentEntry.content}</p>
          <p className="text-[length:var(--text-caption)] text-ink-secondary">{chain.currentEntry.authorName} · {date(chain.currentEntry.createdAt, entryTimeZone)} · {editorial ? chain.currentEntry.appointmentContext?.statusAtRegistration === 'COMPLETED' ? 'Registrada después del cierre' : 'Guardada con cita programada' : <ClinicalContextLabel context={chain.currentEntry.appointmentContext} />}</p>
          <PreviousVersions original={chain.originalEntry} corrections={chain.corrections} timeZone={entryTimeZone} />
        </li>)}</ul><Pagination page={notesPage} totalPages={notes.data.results.totalPages} onChange={setNotesPage} /></> : null}
    </section>
    <section aria-label="Evoluciones de esta atención">
      <h4 className="font-medium text-ink">Evoluciones de esta atención</h4>
      {evolutions.data ? <><p className="text-ink-secondary">Evoluciones vinculadas a esta atención: {evolutions.data.results.totalElements}.</p>
        <ul hidden={compact} className="mt-2 grid gap-3">{evolutions.data.results.content.map((chain) => <li key={chain.recordId}>
          {!editorial ? <p className="text-[length:var(--text-body-sm)] text-ink-secondary">Tratamiento #{chain.currentEntry.treatmentId}</p> : null}
          <p className="whitespace-pre-wrap break-words">{chain.currentEntry.content}</p>
          <p className="text-[length:var(--text-caption)] text-ink-secondary">{chain.currentEntry.authorName} · {date(chain.currentEntry.createdAt, entryTimeZone)} · {editorial ? chain.currentEntry.appointmentContext?.statusAtRegistration === 'COMPLETED' ? 'Registrada después del cierre' : 'Guardada con cita programada' : <ClinicalContextLabel context={chain.currentEntry.appointmentContext} />}</p>
          <PreviousVersions original={chain.originalEntry} corrections={chain.corrections} timeZone={entryTimeZone} />
        </li>)}</ul><Pagination page={evolutionPage} totalPages={evolutions.data.results.totalPages} onChange={setEvolutionPage} /></> : null}
    </section>
  </div>;
}

function ContextDescription({ context }: { context: OccurrenceContext }) {
  const description = context.kind === 'FROZEN' ? 'Contexto programado conservado; no acredita por sí solo asistencia ni procedimientos.'
    : context.kind === 'CURRENT_UNFROZEN' ? 'Contexto actual no congelado. Consultar no crea registros.'
      : 'El horario de esta ocurrencia histórica no fue conservado. No se reconstruye desde la cita actual.';
  return <div className="text-[length:var(--text-body-sm)] text-ink-secondary">
    <p>{description}</p>
    {context.scheduledStartAt && context.timezone ? <p>Horario programado: {date(context.scheduledStartAt, context.timezone)} · {context.timezone}</p> : null}
    <p>Ocurrencia consultada: {context.occurrenceVersion}. Programación actual: {context.currentOccurrenceVersion}. Estado actual de la cita: {statusLabel(context.currentStatus)}.</p>
  </div>;
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return <div className="mt-3 flex flex-wrap items-center gap-3">
    <button type="button" className="min-h-11 underline disabled:opacity-60" disabled={page === 0} onClick={() => onChange(page - 1)}>Anterior</button>
    <span>Página {page + 1} de {totalPages}</span>
    <button type="button" className="min-h-11 underline disabled:opacity-60" disabled={page + 1 >= totalPages} onClick={() => onChange(page + 1)}>Siguiente</button>
  </div>;
}

function PreviousVersions<T extends ChainEntry & { content: string; authorName: string }>({ original, corrections, timeZone }: {
  original: T; corrections: T[]; timeZone: string;
}) {
  if (corrections.length === 0) return null;
  const versions = [original, ...corrections];
  return <details className="mt-2">
    <summary className="cursor-pointer text-[length:var(--text-caption)] text-ink-secondary">Corregida · ver versiones anteriores ({corrections.length})</summary>
    <ol className="mt-2 grid gap-2">{versions.map((entry, index) => <li key={entry.id} className="rounded-control bg-input-fill p-3">
      <p className="text-[length:var(--text-caption)] font-medium text-ink-secondary">{index === 0 ? 'Original' : `Corrección ${index}`}</p>
      <p className="mt-1 whitespace-pre-wrap break-words">{entry.content}</p>
      {entry.correctionReason ? <p className="text-[length:var(--text-caption)] text-ink-muted">Motivo: {entry.correctionReason}</p> : null}
      <p className="text-[length:var(--text-caption)] text-ink-secondary">{entry.authorName} · {date(entry.createdAt, timeZone)}</p>
    </li>)}</ol>
  </details>;
}

function date(value: string, timeZone: string) { return new Date(value).toLocaleString('es-ES', { timeZone, dateStyle: 'medium', timeStyle: 'short' }); }
