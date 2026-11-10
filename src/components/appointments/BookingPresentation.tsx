import type { ReactNode } from 'react';
import './booking-presentation.css';

/** Contexto secundario: describe la agenda sin cambiar los criterios del borrador. */
export function BookingContext({ children }: { children: ReactNode }) {
  return <p className="reception-operation-caption">Contexto de agenda · {children}</p>;
}

/**
 * Pasos del asistente de recepción. Es la única fuente de verdad: el rail de progreso y el
 * orden de los paneles se derivan de esta lista para que título, orden y número no puedan desviarse.
 */
const BOOKING_STEPS = [
  { title: 'Paciente y servicio', hint: 'Quién reserva y qué necesita' },
  { title: 'Fecha y horario', hint: 'Dentista y huecos reales' },
  { title: 'Motivo y confirmación', hint: 'Revisa y reserva' },
] as const;

/** Rail de progreso del asistente; conserva el DOM y las clases de Recepción. */
export function BookingStepRail({ current, hidden = false }: { current: 1 | 2 | 3; hidden?: boolean }) {
  return (
    <ol hidden={hidden} className="reception-stepper" aria-label="Pasos para agendar una cita">
      {BOOKING_STEPS.map(({ title, hint }, index) => {
        const step = index + 1;
        return (
          <li
            key={title}
            className="reception-stepper-step"
            aria-current={current === step ? 'step' : undefined}
            data-state={current > step ? 'done' : current === step ? 'current' : 'pending'}
          >
            <span className="reception-stepper-index" aria-hidden="true">{current > step ? '✓' : step}</span>
            <span className="reception-stepper-text"><strong>{title}</strong><small>{hint}</small></span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Panel de un paso. El consumidor conserva validaciones, foco y orden; este componente
 * solo evita repetir contenedor, encabezado, botón Atrás y navegación.
 */
export function BookingStep({
  step,
  title,
  active,
  done,
  hidden = false,
  headingRef,
  onBack,
  children,
  nav,
}: {
  step: 1 | 2 | 3;
  title: ReactNode;
  active: boolean;
  done: boolean;
  hidden?: boolean;
  headingRef?: ((node: HTMLHeadingElement | null) => void) | undefined;
  onBack?: (() => void) | undefined;
  children: ReactNode;
  nav?: ReactNode;
}) {
  return (
    <div
      hidden={hidden}
      className="reception-step"
      data-active={active ? 'true' : 'false'}
      data-state={done ? 'done' : active ? 'current' : 'pending'}
    >
      {active && onBack ? (
        <div className="reception-step-back">
          <button
            type="button"
            onClick={onBack}
            className="rounded-control bg-input-fill px-4 py-2 text-[length:var(--text-body-sm)] text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary"
          >
            Atrás
          </button>
        </div>
      ) : null}
      <h3
        id={`reception-step-${step}`}
        tabIndex={-1}
        ref={headingRef}
        className="reception-step-head"
      >
        <span aria-hidden="true">{step}</span> {title}
      </h3>
      {children}
      {active && nav ? <div className="reception-step-nav">{nav}</div> : null}
    </div>
  );
}

/** Revisión del paso final; el consumidor aporta etiquetas y valores ya calculados. */
export function BookingReview({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="reception-review" role="group" aria-label="Revisión de la cita">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
