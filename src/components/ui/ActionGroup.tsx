import type { ReactNode } from 'react';

/** Solo composición: el caller conserva orden, permisos, disabled y confirmaciones. */
export function ActionGroup({ children, className = 'ce-actions' }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}
