import type { ReactNode } from 'react';

/** Estado de lectura traducido por el dominio; no recibe Query ni infiere mutaciones. */
export function QueryState({ status, children, loading, failure, incomplete, updating, message = 'No se pudieron cargar los datos.', onRetry, retryLabel = 'Reintentar' }: {
  status: 'loading' | 'ready' | 'error' | 'refreshing' | 'stale-error' | 'incomplete';
  children: ReactNode; loading?: ReactNode; failure?: ReactNode; incomplete?: ReactNode; updating?: ReactNode;
  message?: string; onRetry?: () => void; retryLabel?: string;
}) {
  const error = failure ?? <div role="alert" className="ce-empty"><p>{message}</p>{onRetry ? <button type="button" className="ce-link" onClick={onRetry}>{retryLabel}</button> : null}</div>;
  if (status === 'loading') return loading ?? <p role="status" className="ce-note">Cargando…</p>;
  if (status === 'error') return error;
  if (status === 'incomplete') return incomplete ?? <p role="alert" className="ce-note">Respuesta incompleta.</p>;
  // El contenido ocupa siempre la misma posición al actualizar o fallar con datos previos.
  return <>{status === 'stale-error' ? error : status === 'refreshing' ? updating ?? <p role="status" className="ce-note">Actualizando…</p> : null}{children}</>;
}
