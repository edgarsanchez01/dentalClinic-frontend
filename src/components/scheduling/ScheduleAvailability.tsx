import type { ReactNode } from 'react';
import { ReceptionEmptyState, ReceptionQueryState } from '../reception/ReceptionUI';
import { readableDate } from './scheduleDates';
import type { useScheduleAvailability } from './useScheduleAvailability';

const shortTime = (value: string) => value.slice(0, 5);

/** Approved reception consultation; no private resources, mutations or booking controls. */
export function ScheduleAvailability({ name, model, children }: {
  name: string | undefined;
  model: ReturnType<typeof useScheduleAvailability>;
  children?: ReactNode;
}) {
  const { from, duration, currentRequest, result, slotsByDate, availability, needsSearch } = model;
  return <section className="rs-availability" aria-labelledby="rs-availability-title">
    <div className="rs-tool-heading">
      <div className="rs-heading"><h2 id="rs-availability-title">Consultar disponibilidad</h2><p>{name || 'Selecciona un profesional para consultar intervalos.'}</p></div>
      <p className="rs-tool-scope">Consulta informativa. No reserva una cita.</p>
    </div>
    <div className="rs-tool-controls">
      {children}
      {name ? <form className="rs-search" onSubmit={(event) => { event.preventDefault(); model.search(); }}>
        <div className="rs-field"><label htmlFor="availability-from">Fecha</label>
          <input id="availability-from" type="date" required value={from} onChange={(event) => model.changeDate(event.target.value)} />
        </div>
        <div className="rs-field"><label htmlFor="availability-duration">Duración (min)</label>
          <input id="availability-duration" type="number" required min={5} step={5} value={duration} onChange={(event) => model.changeDuration(event.target.value)} />
        </div>
        <button className="reception-button" type="submit" disabled={availability.isFetching && currentRequest !== null}>Buscar disponibilidad</button>
      </form> : null}
    </div>
    <div className="rs-results" aria-live="polite" aria-atomic="false" aria-busy={Boolean(currentRequest && availability.isFetching)}>
      {!currentRequest && name ? <p className="rs-note">{needsSearch ? `El profesional cambió. Pulsa Buscar disponibilidad para consultar a ${name}.` : 'Selecciona fecha y duración para consultar intervalos.'}</p> : null}
      {currentRequest ? <>
        <div className="rs-result-context"><h3>{name} · <time dateTime={currentRequest.from}>{readableDate(currentRequest.from)}</time></h3>
          <p className="rs-note">{result?.durationMinutes ?? currentRequest.duration} min{result ? ` · Zona horaria: ${result.timezone}` : ''}</p>
        </div>
        {availability.isFetching ? <div className="rs-loading"><p role="status">Calculando disponibilidad…</p><div className="rs-loading-lines" aria-hidden="true"><span /><span /><span /></div></div> : availability.isError ?
          <ReceptionQueryState query={availability} label="la disponibilidad">{null}</ReceptionQueryState> : result ? <>
            {!result.slots.length ? <ReceptionEmptyState title="Sin disponibilidad"><span>No hay huecos para los criterios indicados.</span> Prueba otra fecha, duración o dentista.</ReceptionEmptyState> :
              [...slotsByDate.entries()].map(([day, slots]) => <div key={day}>
                <p className="rs-note">{slots.length} intervalos · {readableDate(day)}</p>
                <ul className="rs-slots" aria-label={`Intervalos disponibles del ${readableDate(day)}`}>
                  {slots.map((slot) => <li key={`${slot.start}-${slot.end}`} className="rs-time" aria-label={`De ${shortTime(slot.startTime)} a ${shortTime(slot.endTime)}`}>{shortTime(slot.startTime)}–{shortTime(slot.endTime)}</li>)}
                </ul>
              </div>)}
          </> : null}
      </> : null}
    </div>
  </section>;
}
