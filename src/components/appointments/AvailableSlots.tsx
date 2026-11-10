import type { ReactNode } from 'react';

import type { AvailabilitySlotDto } from '../../api/scheduling';
import { clockLabel, formatTime, parseClock } from './appointmentUi';
import './available-slots.css';

/** Receta visual del consumidor: AvailableSlots no decide estilos ni permisos. */
export interface SlotPeriodRecipe {
  timezone: string;
  periodClassName: string;
  gridClassName: string;
  headingClassName?: string;
  labels?: { morning: string; afternoon: string };
}

function periodOf(startIso: string, timezone: string): 'morning' | 'afternoon' {
  return Number(formatTime(startIso, timezone).slice(0, 2)) < 12 ? 'morning' : 'afternoon';
}

function defaultLabel(slot: AvailabilitySlotDto): string {
  return `${clockLabel(parseClock(slot.startTime))}–${clockLabel(parseClock(slot.endTime))}`;
}

/**
 * Huecos reales de la API. Solo presentación: el consumidor conserva selección,
 * frescura, idempotencia y el envío. Con `periods` agrupa por mañana/tarde local.
 */
export function AvailableSlots({
  slots,
  selected,
  onSelect,
  label,
  className,
  buttonClassName,
  disabled = false,
  periods,
  renderLabel,
  editorial,
}: {
  slots: AvailabilitySlotDto[];
  selected: string;
  onSelect: (slot: AvailabilitySlotDto) => void;
  label: string;
  className: string;
  buttonClassName?: string | undefined;
  disabled?: boolean;
  periods?: SlotPeriodRecipe | undefined;
  renderLabel?: ((slot: AvailabilitySlotDto) => ReactNode) | undefined;
  editorial?: { timezone: string; durationMinutes: number; grouped?: boolean } | undefined;
}) {
  const button = (slot: AvailabilitySlotDto) => (
    <button
      key={`${slot.start}-${slot.end}`}
      type="button"
      disabled={disabled}
      aria-pressed={selected === slot.start}
      onClick={() => onSelect(slot)}
      className={editorial ? 'booking-slot' : buttonClassName}
      aria-label={editorial ? `${formatTime(slot.start, editorial.timezone)}–${formatTime(slot.end, editorial.timezone)}` : undefined}
      aria-description={editorial ? `${editorial.durationMinutes} minutos` : undefined}
    >
      {editorial ? <>
        <span className="booking-slot-time">{formatTime(slot.start, editorial.timezone)}–{formatTime(slot.end, editorial.timezone)}</span>
        <span className="booking-slot-duration">{editorial.durationMinutes} min</span>
        <span className="booking-slot-selection" aria-hidden="true">{selected === slot.start ? 'Seleccionado' : 'Seleccionar'}</span>
      </> : renderLabel ? renderLabel(slot) : defaultLabel(slot)}
    </button>
  );

  const periodRecipe: SlotPeriodRecipe | undefined = editorial && editorial.grouped !== false
    ? { timezone: editorial.timezone, periodClassName: 'booking-slot-period', gridClassName: 'booking-slot-grid', headingClassName: 'booking-slot-heading' }
    : periods;
  const rootClass = editorial ? editorial.grouped === false ? 'booking-slot-grid' : 'booking-slots' : className;
  if (!periodRecipe) {
    return <div role="group" aria-label={label} className={rootClass}>{slots.map(button)}</div>;
  }

  const labels = periodRecipe.labels ?? { morning: 'Mañana', afternoon: 'Tarde' };
  return (
    <div role="group" aria-label={label} className={rootClass}>
      {(['morning', 'afternoon'] as const).map((period) => {
        const entries = slots.filter((slot) => periodOf(slot.start, periodRecipe.timezone) === period);
        if (entries.length === 0) return null;
        return (
          <div key={period} className={periodRecipe.periodClassName}>
            <h4 className={periodRecipe.headingClassName}>{labels[period]}</h4>
            <div className={periodRecipe.gridClassName}>{entries.map(button)}</div>
          </div>
        );
      })}
    </div>
  );
}
