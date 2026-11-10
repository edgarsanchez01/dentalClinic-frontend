import type { ReactNode } from 'react';
import { ActionGroup } from './ActionGroup';
import './ui.css';

export function PageContainer({ children, preset = 'standard', className }: {
  children: ReactNode; preset?: 'standard' | 'wide' | 'clinical' | 'form'; className?: string;
}) {
  return <div className={className ?? `ce-page ce-page--${preset}`}>{children}</div>;
}

export interface PageHeaderRecipe {
  header?: string; copy?: string; title?: string; intro?: string; context?: string; actions?: string;
}
const editorial: PageHeaderRecipe = {
  header: 'ce-page-heading', copy: 'ce-page-copy', title: 'ce-page-title', intro: 'ce-page-intro',
  context: 'ce-page-context', actions: 'ce-actions',
};

/** La receta conserva el DOM/clases de los adaptadores; nunca consulta rol o datos. */
export function PageHeader({ title, intro, context, action, recipe = editorial }: {
  title: string; intro?: ReactNode; context?: ReactNode; action?: ReactNode; recipe?: PageHeaderRecipe;
}) {
  return <header className={recipe.header}>
    <div className={recipe.copy}>
      <h1 className={recipe.title}>{title}</h1>
      {intro !== undefined ? <p className={recipe.intro}>{intro}</p> : null}
      {context ? <p className={recipe.context}>{context}</p> : null}
    </div>
    {action ? recipe.actions ? <ActionGroup className={recipe.actions}>{action}</ActionGroup> : action : null}
  </header>;
}
