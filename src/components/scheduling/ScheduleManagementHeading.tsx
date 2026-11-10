import type { ReactNode } from 'react';
import { Section } from '../ui/Section';

/** Jerarquía de gestión; el consumidor conserva nivel, permisos y acciones. */
export function ScheduleManagementHeading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="schedule-management-heading">
    <div><h3>{title}</h3><p>{description}</p></div>
    {action}
  </div>;
}

/** Receta existente de los editores, ahora sobre la sección común. */
export function SectionCard({ title, subtitle, children, className }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return <Section title={title} intro={subtitle} recipe={{ section: className ? `reception-card ${className}` : 'reception-card', heading: 'reception-section-heading' }}>
    <div style={{ marginTop: 16 }}>{children}</div>
  </Section>;
}

/** Agrupa sin ocultar/desmontar ni cambiar las políticas de los editores contenidos. */
export function ScheduleManagementGroup({ id, label, title, intro, children }: {
  id: string; label: string; title: string; intro: string; children: ReactNode;
}) {
  return <div id={id} role="region" aria-label={label} className="schedule-management-group min-w-0">
    <Section title={title} intro={intro}><></></Section>
    <div className="schedule-management-editors mt-4 grid gap-6">{children}</div>
  </div>;
}
