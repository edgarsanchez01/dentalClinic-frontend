import type { ReactNode } from 'react';

import type { AppointmentResponse } from '../../api/appointments';
import type { PublicScheduleDto } from '../../api/scheduling';
import {
  fullName,
  STATUS_OPTIONS,
  type ViewMode,
} from './appointmentUi';

/** Filtros compartidos por las agendas; cada consumidor conserva su contenedor y visibilidad. */
export function AgendaFilters({
  dentists,
  dentistFilter,
  myDentistId,
  isDentist,
  statusFilter,
  onDentistChange,
  onStatusChange,
}: {
  dentists: PublicScheduleDto['dentists'];
  dentistFilter: number | '';
  myDentistId: number | undefined;
  isDentist: boolean;
  statusFilter: '' | AppointmentResponse['status'];
  onDentistChange: (next: number | '') => void;
  onStatusChange: (next: '' | AppointmentResponse['status']) => void;
}) {
  return (
    <>
      <label hidden={isDentist} className="flex items-center gap-2 text-[length:var(--text-body-sm)] text-ink">
        <span>Filtrar por dentista</span>
        <select value={dentistFilter} disabled={myDentistId !== undefined}
          onChange={(e) => onDentistChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink disabled:opacity-60">
          <option value="">Todos</option>
          {dentists.map((d) => <option key={d.dentistId} value={d.dentistId}>{fullName(d.firstName, d.lastName)}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-[length:var(--text-body-sm)] text-ink">
        <span>Filtrar por estado</span>
        <select value={statusFilter} onChange={(e) => onStatusChange(e.target.value === '' ? '' : (e.target.value as AppointmentResponse['status']))}
          className="rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink">
          <option value="">Todos</option>
          {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    </>
  );
}

/** Adaptador compatible: OWNER también utiliza la barra aprobada de Recepción. */
export function OwnerAgendaToolbar({
  view,
  onView,
  onShift,
  onToday,
  dateValue,
  onDateChange,
  isMobile,
  personal,
  dentistFilter,
  statusFilter,
  filters,
}: {
  view: ViewMode;
  onView: (next: ViewMode) => void;
  onShift: (delta: number) => void;
  onToday: () => void;
  periodLabel: string;
  dateValue: string;
  onDateChange: (value: string) => void;
  isMobile: boolean;
  personal: boolean;
  dentistFilter: number | '';
  statusFilter: '' | AppointmentResponse['status'];
  timeZone: string;
  filters: ReactNode;
}) {
  return <StaffAgendaToolbar isDentist={personal} isOperational isStaff isPatient={false} role="OWNER" view={view} onView={onView}
    onShift={onShift} onToday={onToday} dateValue={dateValue} onDateChange={onDateChange} isMobile={isMobile}
    dentistFilter={dentistFilter} statusFilter={statusFilter} filters={filters} bookingOpen={false} onToggleBooking={() => {}} />;
}

/** Barra de personal/PATIENT: recetas visuales existentes, sin decidir permisos. */
export function StaffAgendaToolbar({
  isDentist,
  isOperational,
  isStaff,
  isPatient,
  isMobile,
  role,
  view,
  onView,
  onShift,
  onToday,
  dateValue,
  onDateChange,
  dentistFilter,
  statusFilter,
  filters,
  bookingOpen,
  onToggleBooking,
}: {
  isDentist: boolean;
  isOperational: boolean;
  isStaff: boolean;
  isPatient: boolean;
  isMobile: boolean;
  role: string | undefined;
  view: ViewMode;
  onView: (next: ViewMode) => void;
  onShift: (delta: number) => void;
  onToday: () => void;
  dateValue: string;
  onDateChange: (value: string) => void;
  dentistFilter: number | '';
  statusFilter: '' | AppointmentResponse['status'];
  filters: ReactNode;
  bookingOpen: boolean;
  onToggleBooking: () => void;
}) {
  return (
    <div hidden={isDentist && bookingOpen} className={isStaff ? 'reception-agenda-controls' : 'mt-6 flex flex-wrap items-center gap-2'}>
      {isStaff && (!isMobile || role === 'OWNER') ? (
        <div role="group" aria-label="Vista" className="agenda-choice">
          {(['day', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => onView(v)}
              className="agenda-choice-option"
            >
              {v === 'day' ? 'Día' : v === 'week' ? 'Semana' : 'Mes'}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-1" role="group" aria-label="Navegación">
        <button
          type="button"
          onClick={() => onShift(-1)}
          className="rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink focus-visible:ring-2 focus-visible:ring-primary"
        >
          Anterior
        </button>
        <button
          type="button"
          onClick={onToday}
          className="rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink focus-visible:ring-2 focus-visible:ring-primary"
        >
          Hoy
        </button>
        <button
          type="button"
          onClick={() => onShift(1)}
          className="rounded-control bg-input-fill px-3 py-2 text-[length:var(--text-body-sm)] text-ink focus-visible:ring-2 focus-visible:ring-primary"
        >
          Siguiente
        </button>
      </div>

      <label className="flex items-center gap-2 text-[length:var(--text-body-sm)] text-ink">
        <span className={isOperational || isDentist ? undefined : 'sr-only'}>Fecha</span>
        <input
          type="date"
          aria-label="Fecha"
          value={dateValue}
          onChange={(e) => { if (e.target.value) onDateChange(e.target.value); }}
          className="rounded-control border border-hairline bg-input-fill px-3 py-2 text-ink focus-visible:ring-2 focus-visible:ring-primary"
        />
      </label>

      {isStaff ? <details className="reception-agenda-filter-drawer" open={!isMobile || (!isDentist && dentistFilter !== '') || statusFilter !== ''}>
        <summary>Filtros de agenda{(!isDentist && dentistFilter !== '') || statusFilter !== '' ? ' · activos' : ''}</summary>
        <div className="reception-agenda-filter-fields">{filters}</div>
      </details> : isStaff ? filters : null}

      {isPatient ? (
        <button
          type="button"
          onClick={onToggleBooking}
          className="ml-auto rounded-control bg-primary px-4 py-2 text-[length:var(--text-body-sm)] font-medium text-paper focus-visible:ring-2 focus-visible:ring-primary"
        >
          {bookingOpen ? 'Cerrar' : 'Solicitar cita'}
        </button>
      ) : null}
    </div>
  );
}
