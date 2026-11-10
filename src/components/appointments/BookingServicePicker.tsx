import { Link } from 'react-router-dom';
import { useId } from 'react';
import { formatReferencePrice, type BookingServiceDto } from '../../api/catalog';
import { FormAlert } from '../auth/ui';

export function BookingServicePicker({ services, selectedId, onChange, pending, error, owner, reload }: {
  services: BookingServiceDto[]; selectedId: number | ''; onChange: (id: number | '') => void;
  pending: boolean; error: boolean; owner: boolean; reload: () => void;
}) {
  const selected = services.find((entry) => entry.id === selectedId);
  const controlId = useId();
  return <div className="mb-4 grid min-w-0 gap-2">
    <label htmlFor={controlId} className="block min-w-0 text-[length:var(--text-body-sm)] font-medium text-ink">
      Servicio
    </label>
      <select id={controlId} value={selectedId} disabled={pending || error || services.length === 0} required
        onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        className="mt-1.5 min-w-0 max-w-full w-full rounded-control bg-input-fill px-3 py-2 text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60">
        <option value="">Seleccionar servicio</option>
        {selectedId !== '' && !selected ? <option value={selectedId}>Servicio no disponible</option> : null}
        {services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.durationMinutes} min</option>)}
      </select>
    {pending ? <p role="status" className="text-ink-muted">Actualizando servicios…</p> : error ? <FormAlert>No se pudo consultar el catálogo de servicios.</FormAlert>
      : services.length === 0 ? <FormAlert>No hay servicios activos. No es posible crear nuevas reservas.
        {owner ? <> <Link className="underline" to="/services">Gestionar servicios</Link></> : ' Contacta con la clínica para que habilite un servicio.'}</FormAlert>
      : selectedId !== '' && !selected ? <FormAlert>El servicio seleccionado ya no está disponible. Selecciona otro servicio activo.</FormAlert> : null}
    {selected ? <p className="break-words text-[length:var(--text-body-sm)] text-ink-secondary">
      {selected.name} · {selected.durationMinutes} min · Precio de referencia: {formatReferencePrice(selected.referencePrice)} (sin moneda ni impuestos definidos).
    </p> : null}
    <button type="button" disabled={pending} onClick={reload} className="justify-self-start text-[length:var(--text-body-sm)] text-ink underline focus-visible:ring-2 focus-visible:ring-primary">Actualizar servicios</button>
  </div>;
}
