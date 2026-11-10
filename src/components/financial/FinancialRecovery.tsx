import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { financialIntentsApi, type FinancialIntentOperation, type FinancialIntentView } from '../../api/financialIntents';
import { useAuthStore } from '../../app/authStore';
import { FormAlert } from '../auth/ui';
import { FinancialOperationFeedback } from './FinancialOperationFeedback';
import { isFinancialSessionCurrent, useFinancialSession } from './financialSession';
import { canManageCharges, control, financialDate, financialError, secondary } from './financialUi';
import { cacheFinancialIntentView, useFinancialOperation } from './useFinancialOperation';

const labels: Record<FinancialIntentOperation, string> = { FIN_CONFIRM_CHARGE: 'Confirmar cargo', FIN_REGISTER_PAYMENT: 'Registrar pago',
  FIN_REVERSE_PAYMENT: 'Reversar pago', FIN_CANCEL_CHARGE: 'Anular cargo' };
const states = { REGISTERED: 'Registrada', CONFIRMED: 'Confirmada', REJECTED: 'Rechazada sin efecto', ABANDONED: 'Abandonada sin efecto' };

export function FinancialRecovery() {
  const user = useAuthStore(state => state.user);
  const version = useAuthStore(state => state.sessionVersion);
  if (!canManageCharges(user?.role)) return null;
  return <Recovery key={`${version}:${user?.id}:${user?.role}`} />;
}

function Recovery() {
  const session = useFinancialSession();
  const current = isFinancialSessionCurrent(session);
  const [filter, setFilter] = useState<'pending' | 'recent'>('pending');
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<FinancialIntentView | null>(null);
  const query = useQuery({ queryKey: ['financial-recovery', session.userId, session.version, session.role, filter, cursors[page]],
    queryFn: async ({ signal }) => {
      if (!isFinancialSessionCurrent(session)) throw new DOMException('Sesión reemplazada', 'AbortError');
      const result = await financialIntentsApi.list(filter, cursors[page], signal);
      if (!isFinancialSessionCurrent(session)) throw new DOMException('Sesión reemplazada', 'AbortError');
      result.items.forEach(item => cacheFinancialIntentView(session, item));
      return result;
    }, enabled: current, retry: false });
  if (!current) return null;
  const items = query.data?.items.filter(item => session.role === 'OWNER'
    || item.operation === 'FIN_CONFIRM_CHARGE' || item.operation === 'FIN_REGISTER_PAYMENT') ?? [];
  return <section className="reception-card grid gap-4" aria-label="Recuperación de operaciones financieras">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-[length:var(--text-h5)]">Tus operaciones financieras</h2>
      <button type="button" className={secondary} disabled={query.isFetching} onClick={() => void query.refetch()}>Actualizar operaciones</button>
    </div>
    <p className="max-w-prose text-ink-secondary">Recupera solicitudes tras recargar o volver a iniciar sesión. Consultar no registra cobros. Reanudar y abandonar siempre requieren tu confirmación.</p>
    <details className="reception-advanced">
    <summary>Revisar pendientes y recientes{query.data && filter === 'pending' ? ` · ${items.length}${query.data.nextCursor ? ' o más' : ''} en esta página` : ''}</summary>
    <div className="reception-advanced-body">
    <div className="max-w-sm"><label htmlFor="financial-recovery-view">Mostrar operaciones</label>
      <select id="financial-recovery-view" className={control} value={filter} onChange={event => {
        setFilter(event.target.value as 'pending' | 'recent'); setCursors([undefined]); setPage(0); setSelected(null);
      }}><option value="pending">Pendientes</option><option value="recent">Recientes · todos los estados</option></select>
    </div>
    {query.isPending ? <p role="status">Consultando operaciones propias…</p> : query.isError ? <FormAlert>{financialError(query.error)} No se pudo verificar la lista de operaciones. Reintenta la consulta.</FormAlert> : <>
      {items.length === 0 ? <p>No hay operaciones {filter === 'pending' ? 'pendientes' : 'recientes'} en esta página.</p> : <>
      <p className="text-[length:var(--text-body-sm)] text-ink-secondary sm:hidden">Desliza la tabla horizontalmente para consultar todas las columnas.</p>
      <div className="min-w-0 overflow-x-auto" role="region" aria-label="Operaciones propias" tabIndex={0}>
        <table className="reception-table w-full text-left"><caption className="sr-only">Solicitudes propias conservadas por el servidor</caption>
          <thead><tr><th scope="col">Operación</th><th scope="col">Registro</th><th scope="col">Estado</th><th scope="col">Acciones</th></tr></thead>
          <tbody>{items.map(item => <tr key={`${item.operation}:${item.intentId}`}>
            <td>{labels[item.operation]}</td><td>{financialDate(item.registeredAt)}</td><td>{states[item.state]}</td>
            <td><button type="button" className={secondary} onClick={() => setSelected(item)}>Revisar operación</button></td>
          </tr>)}</tbody>
        </table>
      </div></>}
      <nav className="flex flex-wrap items-center gap-3" aria-label="Paginación de operaciones">
        <button type="button" className={secondary} disabled={page === 0 || query.isFetching} onClick={() => { setPage(page - 1); setSelected(null); }}>Operaciones anteriores</button>
        <span>Página {page + 1}</span>
        <button type="button" className={secondary} disabled={!query.data?.nextCursor || query.isFetching} onClick={() => {
          const next = query.data?.nextCursor; if (!next) return;
          setCursors([...cursors.slice(0, page + 1), next]); setPage(page + 1); setSelected(null);
        }}>Más operaciones</button>
      </nav>
    </>}
    {selected ? <RecoveredOperation key={`${selected.operation}:${selected.intentId}`} view={selected} onSaved={async (_view, isCurrent) => {
      if (isCurrent()) await session.client.invalidateQueries({ queryKey: ['financial-charges'] });
    }} /> : null}
    </div>
    </details>
  </section>;
}

function RecoveredOperation({ view, onSaved }: { view: FinancialIntentView;
    onSaved: (view: FinancialIntentView, isCurrent: () => boolean) => Promise<void> }) {
  const correction = view.operation === 'FIN_REVERSE_PAYMENT' || view.operation === 'FIN_CANCEL_CHARGE';
  const operation = useFinancialOperation<never>(`recovery:${view.operation}:${view.intentId}`, view.operation,
    () => { throw new Error('La recuperación nunca reconstruye un comando.'); }, onSaved, correction ? 'owner' : 'write', view);
  return <section className="border-t border-hairline pt-4" aria-label="Operación recuperada">
    <h3 className="font-medium">{labels[view.operation]} · {financialDate(view.registeredAt)}</h3>
    <FinancialOperationFeedback {...operation} startNew={undefined} />
  </section>;
}
