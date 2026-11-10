import type { ReactNode } from 'react';

export function Surface({ children, as: Element = 'div', appearance = 'paper', className, id, label }: {
  children: ReactNode; as?: 'div' | 'section'; appearance?: 'plain' | 'paper' | 'context';
  className?: string | undefined; id?: string | undefined; label?: string | undefined;
}) {
  return <Element className={className ?? `ce-surface ce-surface--${appearance}`} id={id} aria-label={label}>{children}</Element>;
}

export interface SectionRecipe { section?: string; heading?: string; copy?: string; }
const editorial: SectionRecipe = { section: 'ce-section', heading: 'ce-section-heading' };

export function Section({ title, intro, action, children, id, label, recipe = editorial }: {
  title?: string | undefined; intro?: string | undefined; action?: ReactNode; children: ReactNode;
  id?: string; label?: string | undefined; recipe?: SectionRecipe;
}) {
  return <Surface as="section" appearance="plain" className={recipe.section} id={id} label={label}>
    {title || intro || action ? <div className={recipe.heading}>
      <div className={recipe.copy}>{title ? <h2>{title}</h2> : null}{intro ? <p>{intro}</p> : null}</div>
      {action}
    </div> : null}
    {children}
  </Surface>;
}
