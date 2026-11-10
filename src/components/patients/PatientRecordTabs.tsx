import type { ReactNode } from 'react';

import { SectionTabs } from '../ui/SectionTabs';

/** Ficha del paciente: conserva el contenedor y los paneles `<section>` de siempre. */
export function PatientRecordTabs({ sections }: {
  sections: Array<{ id: string; label: string; content: ReactNode }>;
}) {
  return <SectionTabs
    items={sections}
    ariaLabel="Secciones de la ficha del paciente"
    className="patient-record-sections"
    tabListClassName="patient-record-tabs"
  />;
}
