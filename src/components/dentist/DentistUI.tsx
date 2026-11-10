import type { ReactNode } from 'react';
import { apiErrorMessage } from '../appointments/appointmentUi';
import { PageContainer, PageHeader } from '../ui/Page';
import { Section } from '../ui/Section';
import { EmptyState } from '../ui/EmptyState';
import { QueryState } from '../ui/QueryState';

/**
 * UX-05A — Primitivas editoriales del Dentista.
 *
 * Adaptadores compatibles del núcleo editorial; los prefijos y DOM permanecen iguales.
 */

/** Cabecera editorial neutra: orientación, nunca tarjeta ni banner salvia (§22.2). */
export function DentistPageHeader({ title, intro, context, action }: {
  title: string; intro: string; context?: ReactNode; action?: ReactNode;
}) {
  return <PageHeader title={title} intro={intro} context={context} action={action} recipe={{ header: 'dentist-page-heading', copy: 'dentist-page-heading-copy', title: 'dentist-page-title', intro: 'dentist-page-intro', context: 'dentist-page-context', actions: 'dentist-page-actions' }} />;
}

export function DentistPage({ children }: { children: ReactNode }) {
  return <PageContainer className="dentist-home">{children}</PageContainer>;
}

export function DentistSection({ title, intro, action, label, children }: {
  title?: string; intro?: string; action?: ReactNode; label?: string; children: ReactNode;
}) {
  return <Section title={title} intro={title || action ? intro : undefined} action={action} label={label} recipe={{ section: 'dentist-section', heading: 'dentist-section-heading' }}>{children}</Section>;
}

export function DentistEmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <EmptyState title={title} action={action} className="dentist-empty">{children}</EmptyState>;
}

/** Estado por bloque: carga con forma de contenido, error accionable con reintento. */
export function DentistQueryState({ query, label, children }: {
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  label: string;
  children: ReactNode;
}) {
  return <QueryState status={query.isPending ? 'loading' : query.isError ? 'error' : 'ready'}
    loading={
      <div role="status" aria-label={`Cargando ${label}`} className="dentist-skeleton">
        <span className="sr-only">Cargando {label}</span>
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </div>
    }
    failure={query.isError ? (
      <div role="alert" className="dentist-empty">
        <p>{apiErrorMessage(query.error, `No se pudo cargar ${label}.`)}</p>
        <button type="button" className="dentist-link" onClick={() => void query.refetch()}>
          Reintentar {label}
        </button>
      </div>
    ) : undefined}>{children}</QueryState>;
}
