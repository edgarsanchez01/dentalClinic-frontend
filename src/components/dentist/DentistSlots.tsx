import type { AvailabilitySlotDto } from '../../api/scheduling';
import { AvailableSlots } from '../appointments/AvailableSlots';

export function DentistSlots({ slots, selected, onSelect, timezone, durationMinutes }: { slots: AvailabilitySlotDto[]; selected: string; onSelect: (slot: AvailabilitySlotDto) => void; timezone: string; durationMinutes: number }) {
  return <AvailableSlots slots={slots} selected={selected} onSelect={onSelect} label="Huecos disponibles" className="booking-slots" editorial={{ timezone, durationMinutes }} />;
}
