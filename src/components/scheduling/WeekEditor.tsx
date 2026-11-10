import { useState } from 'react';

import type { ScheduleDayDto, ScheduleDayInput, TimeRangeDto } from '../../api/scheduling';
import { toWeekInputs, type WeekDraftController } from './useSchedulingDraft';

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function shortTime(value?: string | null): string {
  return value ? value.slice(0, 5) : '';
}

/** Mensajes de validación locales, en la misma línea que el backend (400 de forma). */
function validateDraft(draft: ScheduleDayInput[]): string[] {
  const errors: string[] = [];
  for (const day of draft) {
    if (!day.open) continue;
    const name = DAY_NAMES[day.dayOfWeek - 1];
    const start = day.startTime ?? '';
    const end = day.endTime ?? '';
    if (!start || !end) {
      errors.push(`${name}: indica la hora de apertura y la de cierre.`);
      continue;
    }
    if (start >= end) {
      errors.push(`${name}: la apertura debe ser anterior al cierre.`);
      continue;
    }
    let previousEnd = '';
    for (const brk of [...day.breaks].sort((a, b) => a.startTime.localeCompare(b.startTime))) {
      if (!brk.startTime || !brk.endTime) {
        errors.push(`${name}: cada descanso necesita hora de inicio y de fin.`);
        continue;
      }
      if (brk.startTime >= brk.endTime) {
        errors.push(`${name}: un descanso debe empezar antes de terminar.`);
      } else if (brk.startTime < start || brk.endTime > end) {
        errors.push(`${name}: los descansos deben quedar dentro de la franja del día.`);
      } else if (previousEnd && brk.startTime < previousEnd) {
        errors.push(`${name}: los descansos no pueden solaparse.`);
      }
      previousEnd = brk.endTime;
    }
  }
  return errors;
}

/** Convierte el borrador al contrato: horas vacías viajan como {@code null}, no como cadenas. */
function toPayload(draft: ScheduleDayInput[]): ScheduleDayInput[] {
  return draft.map((day) =>
    day.open
      ? {
          dayOfWeek: day.dayOfWeek,
          open: true,
          startTime: day.startTime || null,
          endTime: day.endTime || null,
          breaks: day.breaks.map((b) => ({
            startTime: b.startTime || '',
            endTime: b.endTime || '',
          })),
        }
      : { dayOfWeek: day.dayOfWeek, open: false, startTime: null, endTime: null, breaks: [] },
  );
}

/**
 * Editor/visor del horario semanal (RF-SC-01/03/04). Reutilizado por clínica y dentistas.
 *
 * Los siete días ISO se editan en cliente y se guardan de una pieza (reemplazo atómico en el
 * backend). Las horas locales son wall-clock en la zona de la clínica, gestionada por el servidor.
 */
/**
 * Composición de solo lectura del horario semanal. Sustituye a los controles
 * deshabilitados para que la consulta se lea como información, no como un
 * formulario bloqueado.
 */
export function WeekReadOnly({ days, timezone, complete = false }: { days: ScheduleDayDto[]; timezone: string; complete?: boolean }) {
  const rows = complete ? DAY_NAMES.map((_name, index) => ({ dayOfWeek: index + 1, day: days.find((day) => day.dayOfWeek === index + 1) }))
    : days.map((day) => ({ dayOfWeek: day.dayOfWeek, day }));
  return (
    <div className="reception-week-view">
      <p className="reception-readonly-note">Zona horaria: {timezone}</p>
      <div className="reception-week" aria-label="Horario semanal">
        {rows.map(({ dayOfWeek, day }) => {
          const name = DAY_NAMES[dayOfWeek - 1];
          const breaks = day?.breaks.filter((b) => shortTime(b.startTime) && shortTime(b.endTime)) ?? [];
          return (
            <div className="reception-week-row" key={dayOfWeek}>
              <span className="reception-week-day">{name}</span>
              <div>
                {day?.open ? (
                  shortTime(day.startTime) && shortTime(day.endTime) ? (
                    <span className="reception-week-detail">
                      {shortTime(day.startTime)}–{shortTime(day.endTime)}
                    </span>
                  ) : (
                    <span className="reception-week-detail reception-week-closed">Horario sin definir</span>
                  )
                ) : (
                  <span className="reception-week-detail reception-week-closed">{day ? 'Cerrado' : 'Sin horario registrado'}</span>
                )}
                {breaks.length > 0 ? (
                  <p className="reception-week-breaks">
                    Descanso: {breaks.map((b) => `${shortTime(b.startTime)}–${shortTime(b.endTime)}`).join(' · ')}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WeekEditor({
  days,
  disabled = false,
  readOnly = false,
  pending = false,
  onSave,
  timezone,
  controller,
  secondaryAction,
}: {
  days: ScheduleDayDto[];
  disabled?: boolean;
  readOnly?: boolean;
  pending?: boolean;
  onSave: (days: ScheduleDayInput[]) => void;
  timezone: string;
  controller?: WeekDraftController;
  secondaryAction?: React.ReactNode;
}) {
  const [localDraft, setLocalDraft] = useState<ScheduleDayInput[]>(() => toWeekInputs(days));
  const [localErrors, setLocalErrors] = useState<string[]>([]);
  const { draft, setDraft, errors, setErrors } = controller ?? {
    draft: localDraft, setDraft: setLocalDraft, errors: localErrors, setErrors: setLocalErrors,
  };

  if (readOnly) return <WeekReadOnly days={days} timezone={timezone} />;

  const update = (dayOfWeek: number, patch: Partial<ScheduleDayInput>) => {
    setErrors([]);
    setDraft((prev) => prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)));
  };

  const setBreak = (dayOfWeek: number, index: number, patch: Partial<TimeRangeDto>) => {
    setErrors([]);
    setDraft((prev) =>
      prev.map((d) =>
        d.dayOfWeek === dayOfWeek
          ? { ...d, breaks: d.breaks.map((b, i) => (i === index ? { ...b, ...patch } : b)) }
          : d,
      ),
    );
  };

  const addBreak = (dayOfWeek: number) => {
    setErrors([]);
    update(dayOfWeek, {
      breaks: [...(draft.find((d) => d.dayOfWeek === dayOfWeek)?.breaks ?? []), { startTime: '', endTime: '' }],
    });
  };

  const removeBreak = (dayOfWeek: number, index: number) => {
    setErrors([]);
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
      className={`grid gap-3${disabled ? ' reception-readonly' : ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        const found = validateDraft(draft);
        if (found.length > 0) {
          setErrors(found);
          return;
        }
        setErrors([]);
        onSave(toPayload(draft));
      }}
    >
      <p className="text-[length:var(--text-caption)] text-ink-muted">Zona horaria: {timezone}</p>
      {errors.length > 0 ? (
        <div role="alert" className="rounded-nested bg-danger-subtle px-4 py-3 text-[length:var(--text-body-sm)] text-danger-ink">
          <p className="font-medium">Revisa el horario antes de guardar:</p>
          <ul className="mt-1 list-disc pl-5">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}
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
        <div className={secondaryAction ? 'flex flex-wrap gap-3' : undefined}>
          <button
            type="submit"
            disabled={pending}
            className="rounded-control bg-primary px-5 py-2 text-[length:var(--text-body-app)] font-medium text-paper outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Guardando…' : 'Guardar horario'}
          </button>
          {secondaryAction}
        </div>
      )}
    </form>
  );
}
