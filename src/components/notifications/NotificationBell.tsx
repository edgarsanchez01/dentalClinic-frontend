import { Link } from 'react-router-dom';

import { useUnreadNotificationCount } from './notificationQueries';

export function NotificationBell() {
  const counter = useUnreadNotificationCount();
  const unread = counter.isError ? undefined : counter.data?.unread;
  const label = unread !== undefined
    ? `Notificaciones: ${unread} sin leer`
    : counter.isError ? 'Notificaciones: contador no disponible' : 'Notificaciones: cargando contador';

  return (
    <Link
      to="/notifications"
      title={label}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-control bg-paper px-3 py-2 text-ink ring-1 ring-hairline outline-none hover:ring-hairline-strong focus-visible:ring-2 focus-visible:ring-primary"
    >
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </svg>
      <span aria-hidden="true" className={`rounded-xs px-1.5 py-0.5 font-mono text-[length:var(--text-caption)] tabular-nums ${counter.isError ? 'bg-warning-subtle text-warning-ink' : 'bg-muted text-ink'}`}>
        {unread ?? (counter.isError ? '?' : '…')}
      </span>
      <span role="status" className="sr-only">{label}</span>
    </Link>
  );
}
