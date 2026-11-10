import { useState } from 'react';

import { ServiceFilter, ServiceList } from './ServiceList';
import { useServiceList, type ServiceFilterValue } from './serviceQueries';
import { ReceptionEmptyState, ReceptionPageHeader, ReceptionQueryState } from '../reception/ReceptionUI';
import './reception-services.css';

/** Read-only catalogue; OWNER's management UI stays in ServicesPage unchanged. */
export function ReceptionServices() {
  const [filter, setFilter] = useState<ServiceFilterValue>('all');
  const query = useServiceList(filter);
  return <div className="reception-page reception-services">
    <ReceptionPageHeader title="Servicios dentales" intro="Consulta los servicios del catálogo. Acceso de solo lectura." />
    <div className="rc-tools">
      <ServiceFilter value={filter} onChange={setFilter} />
      {query.isSuccess ? <p className="rc-note">{query.data.length} {query.data.length === 1 ? 'servicio' : 'servicios'}{filter === 'all' ? ' en el catálogo' : ' con este estado'}</p> : null}
      {query.isFetching && !query.isPending ? <p role="status" className="rc-note">Actualizando catálogo…</p> : null}
    </div>
    <p className="rc-note">Precios de referencia sin moneda ni impuestos definidos. No generan cargos.</p>
    <ReceptionQueryState query={query} label="servicios">
      {query.isSuccess && query.data.length === 0 ? <ReceptionEmptyState title={filter === 'all' ? 'El catálogo está vacío' : 'No hay servicios con este estado'}
        action={filter !== 'all' ? <button className="reception-link" onClick={() => setFilter('all')}>Ver todos los servicios</button> : undefined}>
        {filter === 'all' ? 'Los servicios aparecerán aquí cuando se registren.' : 'Prueba con otro estado o consulta el catálogo completo.'}
      </ReceptionEmptyState> : null}
      {query.isSuccess && query.data.length > 0 ? <ServiceList items={query.data} /> : null}
    </ReceptionQueryState>
  </div>;
}
