import type { ReactNode } from 'react';

import { SectionTabs } from '../ui/SectionTabs';

const TABS = [
  { id: 'week', label: 'Mi semana' },
  { id: 'exceptions', label: 'Excepciones' },
  { id: 'absences', label: 'Ausencias' },
] as const;

/** Presentation only: switching tabs never unmounts an editor or changes the URL. */
export function DentistScheduleTabs({ children }: { children: [ReactNode, ReactNode, ReactNode] }) {
  return <SectionTabs
    items={TABS.map((tab, index) => ({ id: tab.id, label: tab.label, content: children[index] }))}
    ariaLabel="Gestionar mi horario"
    className="mt-4 grid min-w-0 grid-cols-1 gap-6"
    tabListClassName="reception-tabs"
    tabClassName={active => active ? 'reception-button' : 'reception-button reception-button-secondary'}
    panelTag="div"
  />;
}
