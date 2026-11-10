import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../app/authStore';

/** Presentation scope only: the authenticated role and administrative permissions never change. */
export function OwnerViewSwitch({ area, embedded = false }: { area: 'home' | 'appointments' | 'scheduling'; embedded?: boolean }) {
  const owner = useAuthStore(state => state.user?.role === 'OWNER');
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  if (!owner) return null;
  const personal = params.get('scope') === 'mine';
  const labels = area === 'scheduling' ? ['Clínica y equipo', 'Mi horario'] : ['Clínica', 'Mi actividad clínica'];
  function destination(mine: boolean) {
    const next = new URLSearchParams(params);
    if (mine) next.set('scope', 'mine'); else next.delete('scope');
    // A different context must not retain another professional or an open booking wizard.
    next.delete('dentistId');
    next.delete('create');
    return `${pathname}${next.size ? `?${next}` : ''}`;
  }
  return <nav aria-label="Ámbito de trabajo" className={embedded ? 'agenda-choice' : 'flex flex-wrap gap-2 px-5 pt-5 md:px-8'}>
    {labels.map((label, index) => <Link key={label} to={destination(index === 1)}
      aria-current={personal === (index === 1) ? 'page' : undefined}
      className={embedded ? 'agenda-choice-option' : `inline-flex min-h-11 items-center rounded-control px-4 py-2 text-[length:var(--text-body-sm)] outline-none ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary ${personal === (index === 1) ? 'bg-primary text-paper' : 'bg-input-fill text-ink hover:bg-sunken'}`}>
      {label}
    </Link>)}
  </nav>;
}
