import type { ReactNode, Ref } from 'react';
import { formatReferencePrice, type ServiceDto } from '../../api/catalog';
import type { ServiceFilterValue } from './serviceQueries';
import './reception-services.css';

export function ServiceFilter({ value, onChange, selectRef }: {
  value: ServiceFilterValue; onChange: (value: ServiceFilterValue) => void; selectRef?: Ref<HTMLSelectElement>;
}) {
  return <div><label htmlFor="service-state">Estado</label>
    <select ref={selectRef} id="service-state" value={value} onChange={event => onChange(event.target.value as ServiceFilterValue)}>
      <option value="all">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option>
    </select>
  </div>;
}

export function ServiceSummary({ item, actions }: { item: ServiceDto; actions?: ReactNode }) {
  return <article aria-label={`Servicio ${item.name}`} className="rc-service">
    <div className="rc-copy">
      <div className="rc-name"><h2>{item.name}</h2><span className={`rc-state ${item.active ? 'rc-active' : ''}`}>{item.active ? 'Activo' : 'Inactivo'}</span></div>
      {item.description ? <p>{item.description}</p> : null}
    </div>
    <dl className="rc-facts">
      <div><dt>Precio de referencia</dt><dd>{formatReferencePrice(item.referencePrice)}</dd></div>
      <div><dt>Duración</dt><dd>{item.durationMinutes} min</dd></div>
    </dl>
    {actions ? <div className="rc-actions">{actions}</div> : null}
  </article>;
}

export function ServiceList({ items, renderActions }: {
  items: readonly ServiceDto[]; renderActions?: (item: ServiceDto) => ReactNode;
}) {
  return <ul className="rc-list">{items.map(item => <li key={item.id}>
    <ServiceSummary item={item} actions={renderActions?.(item)} />
  </li>)}</ul>;
}
