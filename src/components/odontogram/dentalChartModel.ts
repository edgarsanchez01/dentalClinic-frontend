import type { ToothCondition } from '../../api/odontogram';

/** Presentation only: containers project authorized DTOs; the renderer knows no roles or HTTP. */
export interface ChartTooth {
  fdi: number;
  condition: ToothCondition | null;
  conditionText?: string;
  notes: string | undefined;
  treatmentCount: number | null;
  notesText?: string;
}
