import type { ReactNode } from 'react';
import type { AppointmentResponse } from '../../api/appointments';
import { ReceptionVisit } from '../reception/ReceptionVisit';
import './agenda-presentation.css';

/** Recepción es la receta visual; identidad, selección y acciones llegan del consumidor. */
export function StaffAgendaHeader({ period, timezone, personal = false, action }: { period: string; timezone: string; personal?: boolean; action: ReactNode }) {
  return <header className="reception-page-heading reception-agenda-heading">
    <div className="reception-page-heading-copy"><h1 className="reception-page-title">Citas</h1><p className="reception-page-intro reception-agenda-period">{period}</p><span className="reception-operation-caption">{personal ? 'Mi agenda · ' : ''}Hora de la clínica · {timezone}</span></div>
    {action}
  </header>;
}

export function AgendaVisitList({ appointments, timezone, onOpen, returnTo, showDuration = false, label }: { appointments: AppointmentResponse[]; timezone: string; onOpen?: ((id: number) => void) | undefined; returnTo?: string | undefined; showDuration?: boolean; label?: string }) {
  return <ul className="reception-register-visits" aria-label={label}>{appointments.map(appointment => <li key={appointment.id}>
    <ReceptionVisit appointment={appointment} timezone={timezone} showDuration={showDuration} {...(onOpen ? { onOpen } : {})} {...(returnTo ? { returnTo } : {})} />
  </li>)}</ul>;
}

/** El mismo marco mensual compacto, con scroll local, sin decidir qué hace una fecha. */
export function AgendaMonthGrid({ children, reception = true }: { children: ReactNode; reception?: boolean }) {
  return <div className={reception ? 'reception-month-view overflow-x-auto' : 'overflow-x-auto'}>
    <div className="grid min-w-[700px] grid-cols-7 gap-1">
      {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(label => <div key={label} className="px-1 text-[length:var(--text-caption)] font-medium text-ink-muted">{label}</div>)}
      {children}
    </div>
  </div>;
}
