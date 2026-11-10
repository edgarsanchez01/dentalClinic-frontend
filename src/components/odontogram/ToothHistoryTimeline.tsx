import type { ToothRecordDto, OdontogramEventDto } from '../../api/odontogram';
import { Link, useInRouterContext } from 'react-router-dom';
import { statusLabel } from '../appointments/appointmentUi';
import {
  conditionChipClass,
  conditionLabel,
  historyEventTypeLabel,
  orderedHistoryEvents,
  historyTimestamp,
  surfaceLabel,
  toothHistoryEvents,
} from './odontogramUi';

/**
 * Línea de tiempo del historial clínico de una pieza y sus superficies (RF-OD-04, §14.4).
 *
 * Presentacional y reutilizable: recibe el registro completo y deriva la cronología con
 * `toothHistoryEvents`. Ordena del evento más reciente al más antiguo, distingue el tipo de
 * evento (registro inicial / actualización), la superficie afectada cuando corresponde, y
 * muestra autor y fecha. Sin movimientos, explica el estado vacío (§16.2). El color nunca es
 * el único indicador: cada condición y cada tipo de evento llevan su etiqueta de texto (§17.1).
 */
export function ToothHistoryTimeline({ record, entries, timeZone = 'UTC' }: {
  record?: ToothRecordDto | undefined;
  entries?: readonly OdontogramEventDto[] | undefined;
  timeZone?: string | undefined;
}) {
  const events = entries ? orderedHistoryEvents(entries) : toothHistoryEvents(record);
  const inRouter = useInRouterContext();

  if (events.length === 0) {
    return (
      <p className="rounded-xs bg-sunken px-3 py-2 text-[length:var(--text-caption)] text-ink-muted">
        Sin movimientos registrados. Al registrar o actualizar esta pieza o sus superficies, la traza
        de cada cambio aparecerá aquí con la condición anterior, la nueva, el autor y la fecha.
      </p>
    );
  }

  return (
    <ol aria-label="Historial de cambios" className="grid gap-2">
      {events.map((event, index) => {
        return (
          <li key={event.key} className="relative pl-6">
            <span
              aria-hidden="true"
              className="absolute left-1 top-3.5 size-2.5 rounded-pill bg-primary ring-2 ring-paper"
            />
            {index < events.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute left-[0.59rem] top-6 bottom-[-0.5rem] w-px bg-hairline"
              />
            ) : null}

            <div className="rounded-xs bg-sunken p-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="rounded-xs bg-primary-subtle px-2 py-0.5 text-[length:var(--text-caption)] font-medium text-primary-ink">
                  {event.kind === 'CONDITION' ? historyEventTypeLabel(event.previousCondition)
                    : event.kind === 'NOTES' ? 'Cambio de observaciones'
                      : event.changeKind === 'ADD' ? 'Tratamiento vinculado' : 'Tratamiento desvinculado'}
                </span>
                <span className="text-[length:var(--text-caption)] text-ink-muted">
                  Pieza {event.toothFdi} · {event.surface ? `Superficie · ${surfaceLabel(event.surface)}` : 'Pieza completa'}
                </span>
              </div>

              {event.kind === 'CONDITION' && event.newCondition ? <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--text-body-sm)] text-ink-secondary">
                {event.previousCondition ? conditionLabel(event.previousCondition) : 'Sin registro previo'}
                <span aria-hidden="true">→</span>
                <span className="sr-only">cambió a</span>
                <span
                  className={`rounded-xs px-2 py-0.5 text-[length:var(--text-caption)] ${conditionChipClass(
                    event.newCondition,
                  )}`}
                >
                  {conditionLabel(event.newCondition)}
                </span>
              </p> : null}
              {event.kind === 'NOTES' ? <dl className="mt-2 grid gap-2 text-[length:var(--text-body-sm)] text-ink-secondary">
                <div><dt className="font-medium">Valor anterior registrado</dt><dd className="whitespace-pre-wrap break-words">{event.previousNotes ?? 'No consignado; no se reconstruye un intervalo anterior.'}</dd></div>
                <div><dt className="font-medium">Nuevo valor</dt><dd className="whitespace-pre-wrap break-words">{event.newNotes ?? 'Observaciones eliminadas (valor vacío conocido).'}</dd></div>
              </dl> : null}
              {event.kind === 'TREATMENT_LINK' ? <p className="mt-2 text-[length:var(--text-body-sm)] text-ink-secondary">
                Tratamiento #{event.treatmentId} · {event.changeKind === 'ADD' ? 'Vinculado a la pieza' : 'Desvinculado de la pieza; el tratamiento no se elimina'}.
              </p> : null}

              <p className="mt-2 text-[length:var(--text-caption)] text-ink-muted">
                <span className="font-medium text-ink-secondary">{event.actorName}</span>
                {' · '}
                <time dateTime={event.changedAt} title={event.changedAt}>{historyTimestamp(event.changedAt, timeZone)}</time>
              </p>
              <p className="mt-2 text-[length:var(--text-caption)] text-ink-secondary">
                {event.occurrence ? <>
                  {inRouter && Number.isSafeInteger(event.occurrence.appointmentId) && event.occurrence.appointmentId > 0
                    && Number.isSafeInteger(event.occurrence.occurrenceVersion) && event.occurrence.occurrenceVersion > 0
                    ? <Link className="inline-block min-h-11 py-2 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      to={`/appointments/${event.occurrence.appointmentId}?occurrenceVersion=${event.occurrence.occurrenceVersion}`}>
                      Cita #{event.occurrence.appointmentId} · ocurrencia {event.occurrence.occurrenceVersion}
                    </Link> : <>Cita #{event.occurrence.appointmentId} · ocurrencia {event.occurrence.occurrenceVersion}</>}
                  {' · '}Estado al registrar: {statusLabel(event.occurrence.statusAtRegistration)}
                </> : 'Sin asociación registrada'}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
