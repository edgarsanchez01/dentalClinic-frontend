import { useEffect, useState } from 'react';

import { getHealth, type HealthStatus } from '../../api/http';

type HealthState =
  | { phase: 'loading' }
  | { phase: 'ready'; status: string }
  | { phase: 'unreachable' };

/**
 * Consulta tecnica del backend. Solo lectura de `/actuator/health`.
 * No hay datos de negocio, ni clinica, ni pacientes, ni metricas.
 */
function useHealth(): HealthState {
  const [state, setState] = useState<HealthState>({ phase: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    getHealth()
      .then((health: HealthStatus) => setState({ phase: 'ready', status: health.status }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ phase: 'unreachable' });
        }
      });

    return () => controller.abort();
  }, []);

  return state;
}

export function BackendHealthCard() {
  const health = useHealth();

  return (
    <section
      aria-labelledby="backend-health-heading"
      className="rounded-card bg-paper p-5 shadow-card ring-1 ring-hairline"
    >
      <h2 id="backend-health-heading" className="text-[length:var(--text-h4)]">
        Backend
      </h2>

      <div className="mt-4 flex items-center gap-2">
        <HealthBadge state={health} />
      </div>

      <p className="mt-3 max-w-[65ch] text-[length:var(--text-body-app)] text-ink-secondary">
        Endpoint tecnico <code className="text-ink">GET /actuator/health</code>. No expone datos de
        negocio.
      </p>
    </section>
  );
}

function HealthBadge({ state }: { state: HealthState }) {
  if (state.phase === 'loading') {
    return (
      <span className="rounded-xs bg-muted-fill px-3 py-1 text-[length:var(--text-micro)] font-medium uppercase tracking-[0.05em] text-ink-secondary">
        Consultando
      </span>
    );
  }

  if (state.phase === 'unreachable') {
    return (
      <span className="rounded-xs bg-danger-subtle px-3 py-1 text-[length:var(--text-micro)] font-medium uppercase tracking-[0.05em] text-danger-ink">
        No accesible
      </span>
    );
  }

  return (
    <span className="rounded-xs bg-success-subtle px-3 py-1 text-[length:var(--text-micro)] font-medium uppercase tracking-[0.05em] text-success-ink">
      {state.status}
    </span>
  );
}