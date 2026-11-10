import type { AppointmentResponse } from '../../api/appointments';
import { formatDayLong, formatTime } from './appointmentUi';

/** Datos administrativos recibidos, sin consultar catálogo ni expediente clínico. */
export function AppointmentFacts({ appointment: a, timeZone, owner = false }: {
  appointment: AppointmentResponse; timeZone: string; owner?: boolean;
}) {
  const facts = [
    ['Paciente', `${a.patientFirstName} ${a.patientLastName}`],
    [owner ? 'Profesional' : 'Dentista', `${a.dentistFirstName} ${a.dentistLastName}`],
    ['Motivo', a.reason || '-'],
    [owner ? 'Notas administrativas' : 'Notas administrativas de la cita', a.notes || '-'],
    ['Versión', a.occurrenceVersion],
    ['Completada', a.completedAt ? `${formatDayLong(a.completedAt, timeZone)} ${formatTime(a.completedAt, timeZone)}` : '-'],
  ] as const;
  const list = <dl className={owner ? 'appointment-detail-list' : 'mt-3 grid gap-3 text-[length:var(--text-body-sm)] sm:grid-cols-2 lg:grid-cols-3'}>
    {facts.map(([label, value]) => <div key={label}>
      <dt className={owner ? undefined : 'text-ink-muted'}>{label}</dt>
      <dd className={owner ? undefined : 'text-ink'}>{value}</dd>
    </div>)}
  </dl>;
  return owner ? <article className="appointment-detail-card"><h3>Detalle de la cita</h3>{list}</article>
    : <section className="mt-6 rounded-card bg-paper p-5 ring-1 ring-hairline">
      <h2 className="text-[length:var(--text-h5)] text-ink">Detalles</h2>{list}
    </section>;
}
