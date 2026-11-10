import { useQuery } from '@tanstack/react-query';
import type { AppointmentResponse } from '../../api/appointments';
import { clinicalTraceApi } from '../../api/clinicalTrace';
import { treatmentsApi } from '../../api/treatments';
import { odontogramApi } from '../../api/odontogram';
import { AttentionTraceSection } from '../appointments/AttentionTraceSection';
import { OdontogramEvents } from '../odontogram/OdontogramEvents';

/** Counts come from persisted, explicitly attributed records, never from editor state. */
export function ClinicalActivity({ appointment: a, zone, summary = false }: {
  appointment: AppointmentResponse; zone: string; summary?: boolean;
}) {
  const selection = { appointmentId: a.id, occurrenceVersion: a.occurrenceVersion };
  const notes = useQuery({ queryKey: ['clinical-trace', a.patientId, a.id, a.occurrenceVersion, 'NOTES', 0], queryFn: () => clinicalTraceApi.notes(a.patientId, selection) });
  const evolutions = useQuery({ queryKey: ['clinical-trace', a.patientId, a.id, a.occurrenceVersion, 'EVOLUTIONS', 0], queryFn: () => clinicalTraceApi.evolutions(a.patientId, selection) });
  const treatments = useQuery({ queryKey: ['treatments', a.patientId], queryFn: () => treatmentsApi.list(a.patientId) });
  const filters = { ...selection, page: 0, size: 20 };
  const dental = useQuery({ queryKey: ['odontogram-history', a.patientId, filters], queryFn: () => odontogramApi.history(a.patientId, filters), retry: false });
  const rows = [
    { label: 'Notas', query: notes, count: notes.data?.results.totalElements },
    { label: 'Evoluciones', query: evolutions, count: evolutions.data?.results.totalElements },
    { label: 'Tratamientos vinculados a esta cita', query: treatments, count: Array.isArray(treatments.data) ? treatments.data.filter(t => t.appointmentId === a.id).length : undefined },
    { label: 'Eventos dentales registrados', query: dental, count: dental.data?.totalElements },
  ];
  return <div className="dc-activity">
    <dl className="dc-activity-counts">{rows.map(({ label, query, count }) => <div key={label}><dt>{label}</dt><dd>{query.isError || query.isSuccess && count === undefined ? 'Sin verificar' : count === undefined ? 'Consultando…' : count}</dd></div>)}</dl>
    {rows.some(r => r.query.isError || r.query.isSuccess && r.count === undefined) ? <p role="alert" className="dc-caption">No se pudieron verificar todos los registros. No se asume que estén vacíos. <button className="dc-link" type="button" onClick={() => rows.forEach(r => { void r.query.refetch(); })}>Reintentar resumen</button></p> : null}
    {!summary ? <><p className="dc-caption">Solo registros guardados. Un tratamiento vinculado no acredita un procedimiento.</p>
      <details open><summary>Notas y evoluciones guardadas</summary><AttentionTraceSection patientId={a.patientId} selection={selection} timeZone={zone} editorial /></details>
      <details><summary>Consultar cambios dentales guardados</summary><OdontogramEvents patientId={a.patientId} filters={selection} timeZone={zone} /></details>
    </> : null}
  </div>;
}
