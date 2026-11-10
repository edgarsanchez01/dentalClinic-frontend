import type { AppointmentResponse } from '../../api/appointments';

/** Horizontal display lanes only. Never changes the caller's time/duration geometry. */
export function ownerDayLanes(appointments: AppointmentResponse[]) {
  const ends: number[] = [], positions: Record<number, number> = {};
  for (const a of [...appointments].sort((x, y) => Date.parse(x.startAt) - Date.parse(y.startAt))) {
    const start = Date.parse(a.startAt);
    let lane = ends.findIndex(end => end <= start);
    if (lane < 0) lane = ends.length;
    ends[lane] = start + a.durationMinutes * 60_000;
    positions[a.id] = lane;
  }
  return { count: Math.max(1, ends.length), positions };
}
