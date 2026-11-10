import type { AppointmentResponse } from '../../api/appointments';
import {
  clockLabel,
  formatTime,
  fullName,
  minutesOfDay,
  statusChipClass,
  statusLabel,
} from './appointmentUi';

/**
 * Lista diaria obligatoria en móvil (§13.7): scroll vertical de citas agrupadas por hora, con
 * tarjeta por cita (hora, paciente, dentista, estado) y acción rápida para abrir el detalle.
 * Se apoya en lo que ya devuelve el backend; no calcula disponibilidad.
 */
export function StaffDayAgenda({
  appointments,
  timeZone,
  onOpen,
  clinicConfigured,
  clinicOpen,
  hasWindow,
}: {
  appointments: AppointmentResponse[];
  timeZone: string;
  onOpen: (id: number) => void;
  clinicConfigured: boolean;
  clinicOpen: boolean;
  hasWindow: boolean;
}) {
  const groups: { hour: number; items: AppointmentResponse[] }[] = [];
  for (const appointment of appointments) {
    const hour = Math.floor(minutesOfDay(new Date(appointment.startAt), timeZone) / 60);
    const group = groups.find((entry) => entry.hour === hour);
    if (group) {
      group.items.push(appointment);
    } else {
      groups.push({ hour, items: [appointment] });
    }
  }

  return (
    <section aria-label="Agenda del día" className="rounded-card bg-paper p-4 ring-1 ring-hairline">
      <h2 className="text-[length:var(--text-h5)] text-ink">Agenda del día</h2>

      {!clinicConfigured ? (
        <p className="mt-2 text-[length:var(--text-body-app)] text-ink">
          Configura el horario de la clínica para ver la disponibilidad del día.
        </p>
      ) : !clinicOpen || !hasWindow ? (
        <p className="mt-2 text-[length:var(--text-body-app)] text-ink">La clínica no atiende este día.</p>
      ) : appointments.length === 0 ? (
        <p className="mt-2 text-[length:var(--text-body-app)] text-ink">No hay citas para este día.</p>
      ) : null}

      {appointments.length > 0 ? (
        <div className="mt-3 grid gap-4">
          {groups.map((group) => (
            <div key={group.hour}>
              <h3 className="text-[length:var(--text-caption)] font-medium tracking-[0.04em] text-ink-muted uppercase">
                {clockLabel(group.hour * 60)}
              </h3>
              <ul className="mt-1 grid gap-2">
                {group.items.map((appointment) => (
                  <li key={appointment.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(appointment.id)}
                      aria-label={`Abrir cita de ${appointment.patientFirstName} ${appointment.patientLastName} a las ${formatTime(appointment.startAt, timeZone)} ${statusLabel(appointment.status)}`}
                      className="min-h-11 w-full rounded-control bg-input-fill p-3 text-left ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[length:var(--text-body-sm)] font-medium text-ink">
                          {formatTime(appointment.startAt, timeZone)}–{formatTime(appointment.endAt, timeZone)}
                        </span>
                        <span
                          className={`rounded-xs px-2 py-0.5 text-[length:var(--text-caption)] ${statusChipClass(appointment.status)}`}
                        >
                          {statusLabel(appointment.status)}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-[length:var(--text-body-app)] font-medium text-ink">
                        {appointment.patientFirstName} {appointment.patientLastName}
                      </span>
                      <span className="block truncate text-[length:var(--text-caption)] text-ink-secondary">
                        {fullName(appointment.dentistFirstName, appointment.dentistLastName)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
