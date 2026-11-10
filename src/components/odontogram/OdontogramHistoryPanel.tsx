import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { odontogramApi, type OdontogramInstantDto, type OdontogramAttentionDto } from '../../api/odontogram';
import type { AppointmentSelection } from '../../api/clinicalTrace';
import { FormAlert } from '../auth/ui';
import { HistoryEventPage } from './OdontogramEvents';
import { ReadOnlyOdontogram } from './ReadOnlyOdontogram';
import { historyTimestamp, utcInputInstant } from './odontogramUi';

type Requested = { mode: 'instant'; at: string } | { mode: 'attention'; selection: AppointmentSelection };
const inputClass = 'min-h-11 min-w-0 w-full rounded-control bg-input-fill px-3 py-2 text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary';

/** A query owns its reference. Draft selector fields never relabel a previously returned state. */
export function OdontogramHistoryPanel({ patientId, initialSelection, timeZone = 'UTC', enabled = true }: {
  patientId: number; initialSelection?: AppointmentSelection | undefined; timeZone?: string | undefined; enabled?: boolean;
}) {
  const id = useId();
  const [mode, setMode] = useState<'instant' | 'attention'>(() => initialSelection ? 'attention' : 'instant');
  const [instant, setInstant] = useState('');
  const [appointmentId, setAppointmentId] = useState(initialSelection ? String(initialSelection.appointmentId) : '');
  const [version, setVersion] = useState(initialSelection ? String(initialSelection.occurrenceVersion) : '1');
  const [requested, setRequested] = useState<Requested | null>(() => initialSelection ? { mode: 'attention', selection: initialSelection } : null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery<OdontogramInstantDto | OdontogramAttentionDto>({ queryKey: ['odontogram-at', patientId, requested, page], retry: false,
    queryFn: () => {
      if (!requested) throw new Error('Elige un criterio de consulta.');
      return requested.mode === 'attention' ? odontogramApi.atAttention(patientId, requested.selection, page)
        : odontogramApi.atInstant(patientId, requested.at);
    },
    enabled: enabled && requested !== null });

  function consult(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (mode === 'instant') setRequested({ mode, at: utcInputInstant(instant) });
      else {
        const appointment = Number(appointmentId), occurrenceVersion = Number(version);
        if (!Number.isSafeInteger(appointment) || appointment < 1 || !Number.isSafeInteger(occurrenceVersion) || occurrenceVersion < 1)
          throw new Error('Indica una cita y una ocurrencia positivas. El backend comprobará que pertenecen a este paciente.');
        setRequested({ mode, selection: { appointmentId: appointment, occurrenceVersion } });
      }
      setPage(0); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Revisa los criterios de consulta.'); }
  }

  const data = query.data;
  const attention = data && 'attributedEvents' in data ? data : null;
  const point = data && 'teeth' in data ? data : null;
  return <section aria-labelledby={id} className="mt-5 border-t border-hairline pt-5">
    <h4 id={id} className="font-medium text-ink">{initialSelection ? 'Estado del odontograma en esta atención' : 'Consulta histórica del odontograma'}</h4>
    <p className="mt-1 text-[length:var(--text-body-sm)] text-ink-secondary">Solo lectura. La captura del contexto, los cambios de una atención y el estado actual son consultas distintas.</p>
    <form onSubmit={consult} className="mt-4 grid gap-3">
      <label className="grid max-w-sm gap-1.5 text-[length:var(--text-body-sm)] text-ink">Consultar por
        <select className={inputClass} value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); setRequested(null); setPage(0); setError(null); }}>
          <option value="instant">Fecha y hora</option><option value="attention">Cita y ocurrencia</option>
        </select>
      </label>
      {mode === 'instant' ? <div className="grid max-w-sm gap-1.5">
        <label htmlFor={`${id}-instant`} className="text-[length:var(--text-body-sm)] text-ink">Fecha y hora (UTC)</label>
        <input id={`${id}-instant`} type="datetime-local" step="0.001" className={inputClass} value={instant}
          onChange={(event) => setInstant(event.target.value)} required />
        <p className="text-[length:var(--text-caption)] text-ink-muted">El selector usa UTC explícitamente; consulta el momento de registro, no una hora de cierre.</p>
      </div> : <div className="grid max-w-lg gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-[length:var(--text-body-sm)] text-ink">Número de cita
          <input type="number" min="1" step="1" className={inputClass} value={appointmentId} onChange={(event) => setAppointmentId(event.target.value)} required />
        </label>
        <label className="grid gap-1.5 text-[length:var(--text-body-sm)] text-ink">Ocurrencia dental a consultar
          <input type="number" min="1" step="1" className={inputClass} value={version} onChange={(event) => setVersion(event.target.value)} required />
        </label>
      </div>}
      <button type="submit" className="min-h-11 justify-self-start rounded-control bg-primary px-4 py-2 font-medium text-paper outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary">Consultar estado histórico</button>
    </form>
    {error ? <div className="mt-3"><FormAlert>{error}</FormAlert></div> : null}
    {requested && query.isPending ? <p role="status" className="mt-4 text-ink-muted">Cargando consulta histórica…</p> : null}
    {query.isError ? <div className="mt-4 grid gap-2"><FormAlert>{query.error instanceof Error ? query.error.message : 'No se pudo consultar el estado histórico.'}</FormAlert>
      <button type="button" onClick={() => void query.refetch()} className="min-h-11 justify-self-start underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary">Reintentar consulta histórica</button></div> : null}
    {point ? <section aria-label="Estado histórico por instante" className="mt-5 border-t border-hairline pt-4">
      <h5 className="font-medium text-ink">Estado reconstruido en {historyTimestamp(point.reference.at, timeZone)}</h5>
      <ReadOnlyOdontogram key={point.reference.at} patientId={patientId} snapshot={{ at: point.reference.at, teeth: point.teeth, completeness: point.completeness }} timeZone={timeZone} />
    </section> : null}
    {attention ? <div className="mt-5 grid gap-6">
      <p className="text-ink-secondary">Cita #{attention.reference.occurrence.appointmentId} · ocurrencia {attention.reference.occurrence.occurrenceVersion} · actual: {attention.reference.occurrence.currentOccurrenceVersion}</p>
      <section aria-label="Estado en la captura" className="border-t border-hairline pt-4">
        <h5 className="font-medium text-ink">Estado en la captura</h5>
        {attention.stateAtCapture ? <>
          <p className="mt-1 text-[length:var(--text-body-sm)] text-ink-secondary">Captura del contexto: {historyTimestamp(attention.stateAtCapture.at, timeZone)}. No representa el final de la cita.</p>
          <ReadOnlyOdontogram key={attention.stateAtCapture.at} patientId={patientId} snapshot={attention.stateAtCapture} timeZone={timeZone} />
        </> : <p className="mt-2 text-ink-secondary">No reconstruible: {attention.reference.occurrence.kind === 'CURRENT_UNFROZEN'
          ? 'esta ocurrencia todavía no tiene contexto capturado.' : 'no se conserva un instante de captura para esta ocurrencia histórica.'} El estado actual se muestra aparte.</p>}
      </section>
      <section aria-label="Cambios atribuidos a la atención" className="border-t border-hairline pt-4">
        <h5 className="font-medium text-ink">Cambios atribuidos a la atención</h5>
        <p className="mt-1 mb-3 text-[length:var(--text-body-sm)] text-ink-secondary">Eventos asociados explícitamente a esta ocurrencia; pueden haberse registrado después de la captura.</p>
        <HistoryEventPage data={attention.attributedEvents} onPageChange={setPage} timeZone={timeZone} />
      </section>
      <section aria-label="Estado actual del paciente" className="border-t border-hairline pt-4">
        <h5 className="font-medium text-ink">Estado actual</h5>
        <p className="mt-1 text-[length:var(--text-body-sm)] text-ink-secondary">Proyección actual del paciente, independiente de la captura y de los eventos de esta atención. Solo lectura.</p>
        <ReadOnlyOdontogram patientId={patientId} records={attention.currentState.teeth} timeZone={timeZone} />
      </section>
    </div> : null}
  </section>;
}
