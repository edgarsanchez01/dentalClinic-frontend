import { useQuery } from '@tanstack/react-query';

import { schedulingApi } from '../../api/scheduling';

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function shortTime(value?: string | null): string {
  return value ? value.slice(0, 5) : '';
}

/**
 * Horario público (RF-SC, §7.4): endpoint sin sesión que no filtra descansos, franquicias ni
 * motivos. Solo muestra la ventana semanal, las excepciones (cerrado/abierto) y los dentistas.
 */
export function PublicSchedulePage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-schedule'],
    queryFn: schedulingApi.getPublicSchedule,
  });

  return (
    <div className="min-h-dvh bg-canvas px-5 py-12">
      <main className="mx-auto w-full max-w-[48rem]">
        <h1 className="text-[length:var(--text-h3)] tracking-[-0.025em] text-ink">Horario</h1>
        {isLoading ? <p className="mt-6 text-ink-muted">Cargando…</p> : null}
        {isError ? <p className="mt-6 text-danger-ink">No se pudo cargar el horario.</p> : null}
        {data ? (
          <div className="mt-6 grid gap-8">
            <section className="rounded-card bg-paper p-5 ring-1 ring-hairline">
              <h2 className="text-[length:var(--text-h5)] text-ink">Horario de apertura</h2>
              <ul className="mt-3 grid gap-1">
                {data.days.map((day) => (
                  <li
                    key={day.dayOfWeek}
                    className="flex items-baseline justify-between border-b border-hairline py-1.5 text-[length:var(--text-body-app)]"
                  >
                    <span className="text-ink-secondary">{DAY_NAMES[day.dayOfWeek - 1]}</span>
                    <span className="tabular text-ink">
                      {day.open ? `${shortTime(day.startTime)}–${shortTime(day.endTime)}` : 'Cerrado'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {data.exceptions.length > 0 ? (
              <section className="rounded-card bg-paper p-5 ring-1 ring-hairline">
                <h2 className="text-[length:var(--text-h5)] text-ink">Excepciones</h2>
                <ul className="mt-3 grid gap-1">
                  {data.exceptions.map((exception) => (
                    <li
                      key={exception.date}
                      className="flex items-baseline justify-between border-b border-hairline py-1.5 text-[length:var(--text-body-app)]"
                    >
                      <span className="tabular text-ink-secondary">{exception.date}</span>
                      <span className="tabular text-ink">
                        {exception.closed
                          ? 'Cerrado'
                          : `${shortTime(exception.startTime)}–${shortTime(exception.endTime)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {data.dentists.length > 0 ? (
              <section className="rounded-card bg-paper p-5 ring-1 ring-hairline">
                <h2 className="text-[length:var(--text-h5)] text-ink">Dentistas</h2>
                <ul className="mt-3 grid gap-4">
                  {data.dentists.map((dentist) => (
                    <li key={dentist.dentistId}>
                      <p className="text-[length:var(--text-body-app)] font-medium text-ink">
                        {dentist.firstName} {dentist.lastName}
                        {dentist.specialty ? (
                          <span className="font-normal text-ink-secondary"> · {dentist.specialty}</span>
                        ) : null}
                      </p>
                      <ul className="mt-1 flex flex-wrap gap-2">
                        {dentist.days
                          .filter((day) => day.open)
                          .map((day) => (
                            <li
                              key={day.dayOfWeek}
                              className="tabular rounded-xs bg-sunken px-2 py-0.5 text-[length:var(--text-caption)] text-ink-secondary"
                            >
                              {DAY_NAMES[day.dayOfWeek - 1]} {shortTime(day.startTime)}–{shortTime(day.endTime)}
                            </li>
                          ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}