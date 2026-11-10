import type { AppointmentResponse } from '../../api/appointments';
import { formatReferencePrice } from '../../api/catalog';

/** Siempre usa la instantánea histórica de la cita; nunca el catálogo actual. */
export function ServiceSnapshot({ service, owner = false, patient = false }: {
  service: AppointmentResponse['service']; owner?: boolean; patient?: boolean;
}) {
  const historical = 'Cita histórica sin servicio asociado. Se conserva su duración original.';
  if (owner) return <article className="appointment-detail-card"><h3>Servicio</h3>
    {service ? <>
      <p className="appointment-detail-card-title">{service.name} · {service.durationMinutes} min</p>
      {service.description ? <p className="appointment-detail-card-text">{service.description}</p> : null}
      <p className="appointment-detail-card-muted">Precio de referencia: {formatReferencePrice(service.referencePrice)}. Sin moneda ni impuestos definidos; no genera un cargo.</p>
    </> : <p className="appointment-detail-card-text">{historical}</p>}
  </article>;
  if (!service) return <p className="mt-4 text-ink-secondary">{historical}</p>;
  return <section className="mt-4 rounded-card bg-paper p-4 ring-1 ring-hairline">
    <h2 className="text-[length:var(--text-h5)] text-ink">{patient ? 'Servicio de tu visita' : 'Servicio de la cita (datos históricos)'}</h2>
    <p className="mt-2 text-ink">{service.name} · {service.durationMinutes} min</p>
    {service.description ? <p className="mt-1 text-ink-secondary">{service.description}</p> : null}
    {!patient ? <p className="mt-2 text-ink-secondary">Precio de referencia: {formatReferencePrice(service.referencePrice)}. Sin moneda ni impuestos definidos; no genera un cargo.</p> : null}
  </section>;
}
