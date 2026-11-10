import { useId } from 'react';
import type { ClinicalDestination, RecordedAppointmentContext } from '../../api/clinicalTrace';
import { Link } from 'react-router-dom';
import { statusLabel } from '../appointments/appointmentUi';

/** A draft owns its destination. Refetch can offer a new one, never select it. */
export function ClinicalDestinationPicker({ current, destination, onChange, disabled = false, editorial = false, compact = false }: {
  compact?: boolean;
  current?: ClinicalDestination | undefined;
  destination: ClinicalDestination | null;
  onChange: (destination: ClinicalDestination | null) => void;
  disabled?: boolean;
  editorial?: boolean;
}) {
  const id = useId();
  if (!current && !destination) return <p className="text-ink-secondary">Destino: registro general del paciente, sin cita.</p>;
  const changed = destination && current && (destination.appointmentId !== current.appointmentId || destination.occurrenceVersion !== current.occurrenceVersion);
  return <div className={`grid gap-2 text-[length:var(--text-body-sm)]${compact ? ' dc-compact-destination' : ''}`}>
    <p className="whitespace-pre-wrap break-words text-ink-secondary">{editorial && destination && !changed ? 'Se guardará en esta atención.' : <>{editorial ? 'Se guardará en: ' : 'Destino: '}{destination
      ? `${editorial ? 'esta cita' : `cita #${destination.appointmentId} · ocurrencia ${destination.occurrenceVersion}`} · ${new Date(destination.startAt).toLocaleString('es-ES', { timeZone: destination.timeZone, dateStyle: 'medium', timeStyle: 'short' })} · ${destination.timeZone}`
      : 'registro general del paciente, sin cita.'}</>}</p>
    <details className={compact ? 'dc-destination-options' : 'contents'} open={!compact}><summary hidden={!compact}>Cambiar destino</summary><label htmlFor={id} className="flex min-h-11 items-center gap-2">
      <input id={id} type="checkbox" checked={destination === null} disabled={disabled}
        onChange={(event) => onChange(event.target.checked ? null : current ?? destination)} />
      Guardar como registro general, sin cita
    </label></details>
    {changed ? <div role="status" className="grid justify-items-start gap-2">
      <p>La programación cambió. El destino del borrador se mantiene; revisa la nueva atención antes de volver a guardar.</p>
      <button type="button" disabled={disabled} onClick={() => onChange(current)}
        className="min-h-11 rounded-control bg-input-fill px-3 py-2 text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {editorial ? 'Vincular a la programación actual' : `Usar la ocurrencia actual #${current.occurrenceVersion}`}
      </button>
    </div> : null}
  </div>;
}

export function ClinicalContextLabel({ context }: { context?: RecordedAppointmentContext | undefined }) {
  if (!context) return <span>Registro general · Sin cita asociada</span>;
  return <span><Link className="underline underline-offset-2" to={`/appointments/${context.appointmentId}?occurrenceVersion=${context.occurrenceVersion}`}>
    Cita #{context.appointmentId} · ocurrencia {context.occurrenceVersion}
  </Link>{context.statusAtRegistration === 'COMPLETED' ? ' · Registrado después de completar la cita'
    : context.statusAtRegistration === 'SCHEDULED' ? ' · Registrado con cita programada'
      : ` · Estado al registrar: ${statusLabel(context.statusAtRegistration)}`}</span>;
}
