import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { appointmentsApi } from '../../api/appointments';
import { useAuthStore } from '../../app/authStore';
import { FormAlert } from '../auth/ui';
import { control, financialDate, secondary } from './financialUi';
import { useFinancialAppointment } from './financialQueries';
import { PatientCombobox } from '../patients/PatientCombobox';

export function FinancialPatientPicker({ value, onChange, disabled = false, required = false }: {
  value: number | null; onChange: (id: number | null) => void; disabled?: boolean; required?: boolean;
}) {
  return <PatientCombobox value={value} onChange={id => onChange(id)} disabled={disabled} required={required}
    label={required ? 'Paciente' : 'Paciente (filtro opcional)'} resolution="by-id" cacheProfile="shared" />;
}

/**
 * UX-04F.3 — Selector de paciente de Recepción con búsqueda opcional.
 *
 * Un único campo lista, busca y selecciona: al abrir consulta la primera página
 * autorizada, sin exigir un término. Escribir filtra ese listado, y elegir una
 * opción fija la selección por ID real (nunca por el texto visible). No calcula
 * nada: consulta `GET /api/patients` (conservando su paginación dentro del
 * desplegable) y confirma la selección con `GET /api/patients/{id}` a través de
 * `useFinancialPatient`.
 *
 * Contratos preservados de UX-04F.1:
 * - etiqueta visible `Paciente` / `Paciente (obligatorio)`;
 * - resumen `aria-label="Paciente seleccionado"` con `patientLabel`, acción
 *   `Quitar selección` y estado `Verificando paciente seleccionado…`;
 * La consulta paginada usa una clave propia; nunca conserva resultados de otro texto.
 * La navegación por resultados ya no es una segunda barra de paginación: se
 * carga dentro del desplegable con `Cargar más pacientes`.
 */
export function ReceptionPatientPicker({ value, onChange, disabled = false, required = false, label = 'Paciente' }: {
  value: number | null; onChange: (id: number | null) => void; disabled?: boolean; required?: boolean; label?: string;
}) {
  return <PatientCombobox value={value} onChange={id => onChange(id)} disabled={disabled} required={required} label={label} />;
}

export function FinancialAppointmentPicker({ patientId, value, onChange, disabled }: {
  patientId: number; value: number | null; onChange: (id: number | null) => void; disabled: boolean;
}) {
  const user = useAuthStore((state) => state.user);
  const ownOnly = user?.role === 'DENTIST';
  const [page, setPage] = useState(0);
  const id = useId();
  const query = useQuery({ queryKey: ['financial-appointments', patientId, ownOnly ? user?.dentistId : null, page],
    queryFn: () => appointmentsApi.list({ patientId, page, size: 10,
      ...(ownOnly && user?.dentistId ? { dentistId: user.dentistId } : {}) }),
    enabled: !ownOnly || user?.dentistId !== undefined, retry: false });
  const selected = useFinancialAppointment(value);
  // Es solo una ayuda de seleccion desde /me + GET; el POST financiero nunca envia dentistId.
  const entries = (query.data?.content ?? []).filter((appointment) =>
    appointment.patientId === patientId && (!ownOnly || appointment.dentistId === user?.dentistId));
  return <fieldset disabled={disabled} className="grid min-w-0 gap-2">
    <label htmlFor={id} className="text-[length:var(--text-body-sm)] font-medium text-ink">{ownOnly ? 'Atención propia vinculada (obligatoria)' : 'Cita vinculada (opcional)'}</label>
    <select id={id} value={value ?? ''} className={control} required={ownOnly}
      onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}>
      <option value="">{ownOnly ? 'Seleccionar atención propia' : 'Sin cita vinculada'}</option>
      {value !== null && !entries.some((appointment) => appointment.id === value) ? <option value={value}>Cita #{value}</option> : null}
      {entries.map((appointment) => <option key={appointment.id} value={appointment.id}>Cita #{appointment.id} · {financialDate(appointment.startAt)} · {appointment.status}</option>)}
    </select>
    {ownOnly ? <p className="text-[length:var(--text-body-sm)] text-ink-secondary">La API verificará que la atención pertenezca a tu perfil profesional y al mismo paciente.</p> : null}
    {ownOnly && user?.dentistId === undefined ? <FormAlert>Tu cuenta no tiene un perfil profesional verificable para crear cargos.</FormAlert> : null}
    {query.isFetching ? <p role="status" className="text-ink-muted">Consultando citas del paciente…</p> : null}
    {query.isError || selected.isError ? <div><FormAlert>No se pudo verificar la cita.</FormAlert>
      <button type="button" className={secondary} onClick={() => { void query.refetch(); if (value) void selected.refetch(); }}>Reintentar citas</button></div> : null}
    {query.data && query.data.totalPages > 1 ? <div className="flex flex-wrap gap-2">
      <button type="button" className={secondary} disabled={page === 0 || query.isFetching} onClick={() => setPage(page - 1)}>Citas anteriores</button>
      <span className="self-center">Página {page + 1} de {query.data.totalPages}</span>
      <button type="button" className={secondary} disabled={page + 1 >= query.data.totalPages || query.isFetching} onClick={() => setPage(page + 1)}>Más citas</button>
    </div> : null}
  </fieldset>;
}
