import type { ReactNode } from 'react';

/** La explicación del dominio distingue sin registros/sin coincidencias/página vacía. */
export function EmptyState({ title, children, action, className = 'ce-empty', headingLevel = 3 }: {
  title: string; children: ReactNode; action?: ReactNode; className?: string; headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return <div className={className}><Heading>{title}</Heading><p>{children}</p>{action}</div>;
}
