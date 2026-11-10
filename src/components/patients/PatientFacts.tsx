import type { ReactNode } from 'react';

export interface PatientFact {
  label: string;
  value: ReactNode;
  /** Solo cambia la presentación del valor vacío; nunca decide qué datos se montan. */
  empty?: boolean;
}

type PatientFactsVariant = 'summary' | 'inline' | 'card' | 'patient';

const RECIPES: Record<PatientFactsVariant, {
  list: string;
  row?: string;
  label?: string;
  value?: string;
  empty?: string;
}> = {
  summary: {
    list: 'reception-patients-summary-list',
    row: 'reception-patients-summary-row',
    empty: 'reception-patients-empty-value',
  },
  inline: {
    list: 'reception-patients-facts',
    row: 'reception-patients-fact',
    label: 'reception-patients-fact-label',
    value: 'reception-patients-fact-value',
  },
  card: {
    list: 'mt-4 grid gap-3 md:grid-cols-2',
    label: 'text-[length:var(--text-caption)] uppercase tracking-[0.05em] text-ink-muted',
    value: 'mt-0.5 text-[length:var(--text-body-app)] text-ink',
  },
  patient: {
    list: 'patient-review',
  },
};

/**
 * Datos administrativos ya autorizados, con la receta visual de cada contexto.
 * No añade ni filtra campos por rol: cada consumidor decide qué hechos monta.
 */
export function PatientFacts({ facts, variant = 'summary', className }: {
  facts: ReadonlyArray<PatientFact>;
  variant?: PatientFactsVariant | undefined;
  className?: string | undefined;
}) {
  const recipe = RECIPES[variant];
  return <dl className={className ?? recipe.list}>
    {facts.map(fact => <div key={fact.label} className={recipe.row}>
      <dt className={recipe.label}>{fact.label}</dt>
      <dd className={[recipe.value, fact.empty ? recipe.empty : undefined].filter(Boolean).join(' ') || undefined}>
        {fact.value}
      </dd>
    </div>)}
  </dl>;
}
