import type { TreatmentStatus } from '../../api/treatments';

/** Etiquetas y estilos de estado del tratamiento, en un módulo sin componentes (§13.3). */

export const TREATMENT_STATUS_OPTIONS: { value: TreatmentStatus; label: string }[] = [
  { value: 'PLANNED', label: 'Planificado' },
  { value: 'IN_PROGRESS', label: 'En progreso' },
  { value: 'COMPLETED', label: 'Completado' },
  { value: 'CANCELLED', label: 'Cancelado' },
];

export function treatmentStatusLabel(status: TreatmentStatus): string {
  return TREATMENT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/** §13.3: color Y tratamiento (tachado/opacidad), nunca solo color. */
export function treatmentStatusChipClass(status: TreatmentStatus): string {
  switch (status) {
    case 'PLANNED':
      return 'bg-primary-subtle text-primary-ink';
    case 'IN_PROGRESS':
      return 'bg-info-subtle text-info-ink';
    case 'COMPLETED':
      return 'bg-success-subtle text-success-ink';
    case 'CANCELLED':
      return 'bg-sunken text-ink-muted line-through opacity-70';
  }
}
