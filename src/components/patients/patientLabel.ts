/** Identificación humana del paciente cuando la API ya entregó el registro autorizado. */
export function patientLabel(patient: { firstName?: string; lastName?: string } | undefined, id: number): string {
  const name = [patient?.lastName, patient?.firstName].filter(Boolean).join(', ');
  const detail = [patient?.lastName, patient?.firstName].filter(Boolean).length === 2 ? `${name} · Paciente #${id}` : '';
  return detail || `Paciente #${id}`;
}
