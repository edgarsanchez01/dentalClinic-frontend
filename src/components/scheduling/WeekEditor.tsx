import { useState } from 'react';

import type { ScheduleDayDto, ScheduleDayInput, TimeRangeDto } from '../../api/scheduling';

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function shortTime(value?: string | null): string {
  return value ? value.slice(0, 5) : '';
}

function toInputs(days: ScheduleDayDto[]): ScheduleDayInput[] {
  return days.map((day) => ({
    dayOfWeek: day.dayOfWeek,
    open: day.open,
    startTime: day.open ? shortTime(day.startTime) || '09:00' : null,
    endTime: day.open ? shortTime(day.endTime) || '17:00' : null,
    breaks: day.breaks.map((b) => ({ startTime: shortTime(b.startTime), endTime: shortTime(b.endTime) })),
  }));
}

/**
 * Editor/visor del horario semanal (RF-SC-01/03/04). Reutilizado por clínica y dentistas.
 *
 * Los siete días ISO se editan en cliente y se guardan de una pieza (reemplazo atómico en el
 * backend). Las horas locales son wall-clock en la zona de la clínica, gestionada por el servidor.
 */
export function WeekEditor({
  days,
  disabled = false,
  pending = false,
  onSave,
  timezone,
}: {
  days: ScheduleDayDto[];
  disabled?: boolean;
  pending?: boolean;
  onSave: (days: ScheduleDayInput[]) => void;
  timezone: string;
}) {
  const [draft, setDraft] = useState<ScheduleDayInput[]>(() => toInputs(days));

  const update = (dayOfWeek: number, patch: Partial<ScheduleDayInput>) => {
    setDraft((prev) => prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  };

  const setBreak = (dayOfWeek: number, index: number, patch: Partial<TimeRangeDto>) => {
    setDraft((prev) =>
      prev.map((d) =>
        d.dayOfWeek === dayOfWeek
          ? { ...d, breaks: d.breaks.map((b, i) => (i === index ? { ...b, ...patch } : b)) }
          : d,
      ),
    );
  };

  const addBreak = (dayOfWeek: number) => {
    update(dayOfWeek, {
      breaks: [...(draft.find((d) => d.dayOfWeek === dayOfWeek)?.breaks ?? []), { startTime: '13:00', endTime: '14:00' }],
    });
  };

  const removeBreak = (dayOfWeek: number, index: number) => {
    setDraft((prev) =>
      prev.map((d) =>
        d.dayOfWeek === dayOfWeek
          ? { ...d, breaks: d.breaks.filter((_, i) => i !== index) }
          : d,
      ),
    );
  };

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <p className="text-[length:var(--text-caption)] text-ink-muted">Zona horaria: {timezone}</p>
      {draft.map((day) => (
        <fieldset
          key={day.dayOfWeek}
          className="rounded-nested bg-sunken px-4 py-3"
          disabled={disabled}
        >
          <legend className="sr-only">{DAY_NAMES[day.dayOfWeek - 1]}</legend>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[length:var(--text-body-app)] font-medium text-ink">
              <input
                type="checkbox"
                checked={day.open}
                onChange={(event) => update(day.dayOfWeek, { open: event.target.checked })}
                className="size-4 rounded-xs accent-primary"
              />
              {DAY_NAMES[day.dayOfWeek - 1]}
            </label>
            {day.open ? (
              <>
                <label className="flex items-center gap-1 text-[length:var(--text-caption)] text-ink-secondary">
                  Desde
                  <input
                    type="time"
                    aria-label={`Inicio ${DAY_NAMES[day.dayOfWeek - 1]}`}
                    value={day.startTime ?? ''}
                    onChange={(event) => update(day.dayOfWeek, { startTime: event.target.value })}
                    className="rounded-xs bg-input-fill px-2 py-1 text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </label>
                <label className="flex items-center gap-1 text-[length:var(--text-caption)] text-ink-secondary">
                  Hasta
                  <input
                    type="time"
                    aria-label={`Fin ${DAY_NAMES[day.dayOfWeek - 1]}`}
                    value={day.endTime ?? ''}
                    onChange={(event) => update(day.dayOfWeek, { endTime: event.target.value })}
                    className="rounded-xs bg-input-fill px-2 py-1 text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </label>
              </>
            ) : (
              <span className="text-[length:var(--text-caption)] text-ink-muted">Cerrado</span>
            )}
          </div>
          {day.open ? (
            <div className="mt-3 grid gap-2">
              {day.breaks.map((brk, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="text-[length:var(--text-caption)] text-ink-muted">Descanso</span>
                  <input
                    type="time"
                    aria-label={`Descanso inicio ${DAY_NAMES[day.dayOfWeek - 1]} ${index + 1}`}
                    value={brk.startTime.slice(0, 5)}
                    onChange={(event) => setBreak(day.dayOfWeek, index, { startTime: event.target.value })}
                    className="rounded-xs bg-input-fill px-2 py-1 text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary"
                  />
                  <input
                    type="time"
                    aria-label={`Descanso fin ${DAY_NAMES[day.dayOfWeek - 1]} ${index + 1}`}
                    value={brk.endTime.slice(0, 5)}
                    onChange={(event) => setBreak(day.dayOfWeek, index, { endTime: event.target.value })}
                    className="rounded-xs bg-input-fill px-2 py-1 text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => removeBreak(day.dayOfWeek, index)}
                    className="text-[length:var(--text-caption)] text-danger-ink underline"
                  >
                    Quitar
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addBreak(day.dayOfWeek)}
                className="justify-self-start text-[length:var(--text-caption)] text-primary-ink underline"
              >
                Añadir descanso
              </button>
            </div>
          ) : null}
        </fieldset>
      ))}
      {disabled ? null : (
        <div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-primary-ink outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Guardando…' : 'Guardar horario'}
          </button>
        </div>
      )}
    </form>
  );
}