import type { ReactNode } from 'react';
import { apiErrorMessage } from '../appointments/appointmentUi';
import { PageContainer, PageHeader } from '../ui/Page';
import { Section } from '../ui/Section';
import { EmptyState } from '../ui/EmptyState';
import { QueryState } from '../ui/QueryState';

/** Cabecera editorial de módulo de Recepción. Espeja `PatientPageHeader`. */
export function ReceptionPageHeader({ title, intro, action }: { title: string; intro: string; action?: ReactNode }) {
  return <PageHeader title={title} intro={intro} action={action} recipe={{ header: 'reception-page-heading', copy: 'reception-page-heading-copy', title: 'reception-page-title', intro: 'reception-page-intro', actions: 'reception-page-actions' }} />;
}

export function ReceptionPage({ children }: { children: ReactNode }) {
  return <PageContainer className="reception-page">{children}</PageContainer>;
}

export function ReceptionSection({ title, intro, action, children }: {
  title?: string; intro?: string; action?: ReactNode; children: ReactNode;
}) {
  return <Section title={title} intro={title || action ? intro : undefined} action={action} recipe={{ section: 'reception-section', heading: 'reception-section-heading' }}>{children}</Section>;
}

export function ReceptionEmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <EmptyState title={title} action={action} className="reception-empty">{children}</EmptyState>;
}

export function ReceptionQueryState({ query, label, children }: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  label: string;
  children: ReactNode;
}) {
  return <QueryState status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
    loading={
      <p role="status" aria-label={`Cargando ${label}`} className="reception-readonly-note">
        Cargando {label}…
      </p>
    }
    failure={query.isError ? (
      <div role="alert" className="reception-empty">
        <p>{apiErrorMessage(query.error, `No se pudo cargar ${label}.`)}</p>
        <button type="button" className="reception-link" onClick={() => void query.refetch()}>
          Reintentar {label}
        </button>
      </div>
    ) : undefined}>{children}</QueryState>;
}
