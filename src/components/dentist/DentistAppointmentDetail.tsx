import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useContext, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { appointmentsApi, type AppointmentResponse } from '../../api/appointments';
import { ApiError } from '../../api/http';
import { patientsApi } from '../../api/patients';
import { schedulingApi } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { safeReturnTo } from '../../app/deepLinks';
import { UnsavedChangesContext, type UnsavedChangesValue } from '../../app/unsavedChanges';
import { useInvalidateNotifications } from '../notifications/notificationQueries';
import { apiErrorMessage, EVENT_LABELS, formatDayLong, formatTime, localDateInput } from '../appointments/appointmentUi';
import { AttentionTraceSection } from '../appointments/AttentionTraceSection';
import { ClinicalNotesCard, ClinicalRecordCard } from '../patients/PatientDetailPage';
import { TreatmentsSection } from '../patients/TreatmentsSection';
import { IntakeDeclarations } from '../medical-intake/PatientIntakeProfile';
import { OdontogramSection } from '../odontogram/OdontogramSection';
import { DentistStatusChip } from './DentistVisit';
import { DentistDraftBoundary } from './DentistDraftBoundary';
import { DentistSlots } from './DentistSlots';
import { ClinicalCompletion } from './ClinicalCompletion';
import { ClinicalActivity } from './ClinicalActivity';
import { ClinicalDraftGroup } from './ClinicalDraftGroup';
import './dentist-appointments.css';

/** UX-05E: a single mounted console; focused dentistry is presentation, never navigation. */
export function DentistAppointmentDetail() {
  const user = useAuthStore(s => s.user);
  if (user?.role !== 'OWNER' && user?.role !== 'DENTIST') return <p role="alert">No tienes acceso al espacio de atención clínica.</p>;
  if (user.role === 'DENTIST' && !user.dentistId) return <p role="alert">Tu cuenta no tiene un perfil de dentista. Contacta con el propietario.</p>;
  // Local identity for OWNER's clinical surface, not a migration of the administrative shell.
  return <div className="dentist-shell"><ClinicalAppointmentLoader /></div>;
}

function ClinicalAppointmentLoader() {
  const navigationGuard = useContext(UnsavedChangesContext);
  const { id } = useParams();
  const user = useAuthStore(s => s.user);
  const aid = Number(id);
  const valid = Number.isSafeInteger(aid) && aid > 0;
  const appointment = useQuery({ queryKey: ['appointment', aid], queryFn: () => appointmentsApi.get(aid), enabled: valid, retry: false });
  const zone = useQuery({ queryKey: ['public-schedule'], queryFn: () => schedulingApi.getPublicSchedule(), enabled: valid });
  let timeZone: string | undefined;
  try { if (zone.data?.timezone) { new Intl.DateTimeFormat('es', { timeZone: zone.data.timezone }); timeZone = zone.data.timezone; } } catch { /* No browser-zone fallback. */ }
  const denied = appointment.error instanceof ApiError && (appointment.error.status === 403 || appointment.error.status === 404);
  const outsideScope = user?.role === 'DENTIST' && appointment.data && appointment.data.dentistId !== user.dentistId;
  if (!valid || denied || outsideScope) return <div className="dc-appointments"><p role="alert">{appointment.error instanceof ApiError && appointment.error.status === 403 ? 'No tienes acceso a esta atención clínica.' : 'No encontramos la cita solicitada.'}</p><Link className="dc-link" to="/appointments">Volver a Citas</Link></div>;
  if (appointment.isPending) return <div className="dc-appointments"><p role="status">Cargando cita…</p></div>;
  if (!appointment.data) return <div className="dc-appointments"><p role="alert">{apiErrorMessage(appointment.error, 'No se pudo cargar la cita.')}</p><button type="button" className="dc-secondary" onClick={() => void appointment.refetch()}>Reintentar cita</button></div>;
  return <DentistDraftBoundary key={`${user?.id}-${aid}-${appointment.data.patientId}`}>{hasDrafts => <AppointmentWorkspace navigationGuard={navigationGuard} appointment={appointment.data} zone={timeZone ?? 'UTC'} zoneVerified={Boolean(timeZone)} zonePending={zone.isPending} hasDrafts={hasDrafts} refreshFailed={appointment.isError || zone.isError} onRefresh={() => { void appointment.refetch(); void zone.refetch(); }} />}</DentistDraftBoundary>;
}

function AppointmentWorkspace({ appointment: a, zone, zoneVerified, zonePending, hasDrafts, refreshFailed, onRefresh, navigationGuard }: {
  navigationGuard: UnsavedChangesValue | null;
  appointment: AppointmentResponse; zone: string; zoneVerified: boolean; zonePending: boolean; hasDrafts: () => boolean; refreshFailed: boolean; onRefresh: () => void;
}) {
  const user = useAuthStore(s => s.user);
  const [params] = useSearchParams();
  const historical = Number(params.get('occurrenceVersion'));
  const initialVersion = Number.isSafeInteger(historical) && historical > 0 && historical <= a.occurrenceVersion ? historical : a.occurrenceVersion;
  const [version, setVersion] = useState(initialVersion);
  const fromOwnerDetail = user?.role === 'OWNER' && params.get('clinical') === '1';
  const [clinicalOpen, setClinicalOpen] = useState(fromOwnerDetail);
  const [detailOpen, setDetailOpen] = useState(false);
  const [dentalFocused, setDentalFocused] = useState(false);
  const [panel, setPanel] = useState<number | null>(null);
  const [visited, setVisited] = useState(new Set<number>());
  const [drafts, setDrafts] = useState<Record<string, { label: string; dirty: boolean }>>({});
  const reportDraft = useCallback((id: string, label: string, dirty: boolean) => setDrafts(previous =>
    previous[id]?.dirty === dirty && previous[id]?.label === label ? previous : { ...previous, [id]: { label, dirty } }), []);
  const panelTrigger = useRef<HTMLElement | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const busy = useRef(false);
  const queryClient = useQueryClient();
  const recovery = useQuery({ queryKey: ['clinical-completion-operation', user?.id, a.id], queryFn: () => null, enabled: false, gcTime: Infinity });
  const recovering = Boolean(recovery.data);
  const [completionVisited, setCompletionVisited] = useState(recovering);
  const [reviewOpen, setReviewOpen] = useState(recovering);
  const saving = useIsMutating() > 0;
  const notifications = useInvalidateNotifications();
  const assigned = user?.dentistId === a.dentistId;
  const canManage = assigned && a.status === 'SCHEDULED';
  const record = useQuery({ queryKey: ['clinical-record', a.patientId], queryFn: () => patientsApi.getClinicalRecord(a.patientId) });
  const events = useQuery({ queryKey: ['appointment-events', a.id], queryFn: () => appointmentsApi.events(a.id), enabled: visited.has(5) });
  const candidateReturn = safeReturnTo(params.get('returnTo'));
  const returnTo = candidateReturn === '/appointments' || candidateReturn.startsWith('/appointments?') ? candidateReturn : '/appointments';

  function refresh(updated?: AppointmentResponse) {
    if (updated) queryClient.setQueryData(['appointment', a.id], updated);
    for (const key of [['appointments'], ['availability'], ['appointment', a.id], ['appointment-events', a.id], ['clinical-trace', a.patientId], ['odontogram-at', a.patientId]]) void queryClient.invalidateQueries({ queryKey: key });
    void notifications();
  }
  const cancel = useMutation({ retry: false, mutationFn: () => appointmentsApi.cancel(a.id),
    onSuccess: updated => { refresh(updated); setConfirmCancel(false); setNotice('Cita cancelada.'); },
    onError: cause => { setError(apiErrorMessage(cause, 'No se pudo cancelar la cita.')); refresh(); },
    onSettled: () => { busy.current = false; } });
  function selectPanel(index: number | null) {
    if (index !== null) { panelTrigger.current = document.activeElement as HTMLElement; setVisited(old => new Set([...old, index])); }
    setPanel(index === panel ? null : index);
    requestAnimationFrame(() => {
      if (index === null || index === panel) panelTrigger.current?.focus();
      else document.getElementById(`clinical-context-${index}`)?.focus();
    });
  }
  function goToDraft(id: string) {
    setDentalFocused(id === 'clinical-dental');
    if (id === 'clinical-record') { setVisited(old => new Set([...old, 3])); setPanel(3); }
    else if (id === 'clinical-history') { setVisited(old => new Set([...old, 5])); setPanel(5); }
    else setPanel(null);
    requestAnimationFrame(() => {
      const node = document.getElementById(id);
      if (id === 'clinical-treatments') {
        node?.querySelector<HTMLButtonElement>('[data-show-treatment-list][aria-expanded="false"]')?.click();
        node?.querySelectorAll('[data-clinical-pending-editor="true"]').forEach(editor => {
          const card = editor.closest('article');
          card?.querySelector<HTMLButtonElement>('[data-toggle-treatment-detail][aria-expanded="false"]')?.click();
          card?.querySelector<HTMLButtonElement>('[data-toggle-evolution][aria-expanded="false"]')?.click();
        });
      }
      requestAnimationFrame(() => {
        const target = node?.querySelector<HTMLElement>('[data-clinical-pending-editor="true"] textarea')
          ?? node?.querySelector<HTMLElement>('textarea')
          ?? node?.querySelector<HTMLElement>('input, select, button');
        target?.scrollIntoView?.({ block: 'center' }); target?.focus();
      });
    });
  }
  function openCompletion() { setCompletionVisited(true); setReviewOpen(true); }
  function closeCompletion() {
    setReviewOpen(false);
    requestAnimationFrame(() => document.getElementById('clinical-finish')?.focus());
  }
  const context = { appointmentId: a.id, occurrenceVersion: a.occurrenceVersion, startAt: a.startAt, timeZone: zone };
  const clinicalEditable = a.status === 'SCHEDULED' || a.status === 'COMPLETED';
  const draftWarning = hasDrafts();
  const activeDrafts = Object.entries(drafts).filter(([, value]) => value.dirty);
  return <div className="dc-appointments dc-appointment-detail dc-clinical-workspace dc-unified-console" data-dental-focused={dentalFocused || undefined}>
    <Link to={returnTo} className="dc-link">Volver a Agenda</Link>
    <header className="dc-heading"><div><h1>{a.patientFirstName} {a.patientLastName}</h1><p>{a.service ? `Servicio previsto · ${a.service.name}` : 'Cita sin servicio asociado'}</p><small>{formatDayLong(a.startAt, zone)} · {formatTime(a.startAt, zone)}–{formatTime(a.endAt, zone)} · {zone}</small></div>
      <div className="dc-header-actions"><DentistStatusChip status={a.status} />{!clinicalOpen && !recovering ? <button key="open" type="button" className="dc-primary" onClick={() => { setClinicalOpen(true); requestAnimationFrame(() => { if (!document.querySelector('dialog[open]')) document.getElementById('consultation-heading')?.focus(); }); }}>Abrir consulta</button> : <button key="detail" type="button" className="dc-link" aria-expanded={detailOpen} onClick={() => setDetailOpen(!detailOpen)}>Datos de la cita</button>}
        {(clinicalOpen && canManage) || recovering ? <button id="clinical-finish" type="button" className="dc-secondary" disabled={refreshFailed && !recovering} onClick={openCompletion}>{recovering ? 'Revisar finalización' : 'Finalizar atención'}</button> : null}</div>
    </header>
    {saving ? <p role="status" className="dc-editor-state">Guardando… Espera el resultado antes de salir.</p> : null}
    {notice ? <p role="status" className="dc-success">{notice}</p> : null}
    {error ? <p role="alert" className="dc-error">{error}</p> : null}
    {!zoneVerified ? <div role={zonePending ? 'status' : 'alert'} className="dc-draft-warning"><p>{zonePending ? 'Consultando la zona horaria de la clínica.' : 'No se pudo verificar la zona horaria de la clínica.'} Los instantes se muestran explícitamente en UTC, no en la hora local de la clínica. Puedes trabajar en los registros clínicos; la reprogramación requiere la zona verificada.</p><button className="dc-link" type="button" onClick={onRefresh}>Reintentar zona horaria</button></div> : null}
    {refreshFailed ? <div role="alert" className="dc-error">No se pudo actualizar la cita o su zona horaria. Se conservan los datos consultados y tus borradores. <button type="button" className="dc-link" onClick={onRefresh}>Reintentar actualización</button></div> : null}
    {!clinicalEditable ? <p role="status" className="dc-draft-warning">Esta cita está cerrada por cancelación o ausencia. No admite nuevas entradas vinculadas ni acciones de agenda. El expediente longitudinal conserva sus permisos y los borradores no cambian de destino automáticamente.</p> : null}
    {a.status === 'COMPLETED' ? <p className="dc-caption">Atención completada{a.completedAt ? ` el ${formatDayLong(a.completedAt, zone)} a las ${formatTime(a.completedAt, zone)}` : ''}. No se puede volver a cerrar. Los registros posteriores conservan su trazabilidad.</p> : null}
    <section className="dc-patient-context" aria-label="Contexto del paciente"><div><strong>Alergias y antecedentes</strong>
      {record.isPending ? <p role="status">Consultando antecedentes…</p> : record.isError ? <p role="alert">Información no verificada. <button type="button" className="dc-link" onClick={() => void record.refetch()}>Reintentar antecedentes</button></p> : <><p><b>Alergias registradas: </b>{record.data?.allergies || 'No registradas en el expediente profesional.'}</p>{record.data?.medicalBackground ? <details><summary>Antecedentes médicos registrados</summary><p>{record.data.medicalBackground}</p></details> : <p className="dc-caption">Antecedentes médicos no registrados en el expediente profesional.</p>}</>}
      </div><button type="button" className="dc-link" aria-expanded={panel === 3} aria-controls="clinical-panel-3" onClick={() => { setClinicalOpen(true); selectPanel(3); }}>Consultar expediente</button></section>
    <section id="visit-panel-0" aria-label="Detalle de cita" hidden={clinicalOpen && !detailOpen}>
      <h2>Detalle de cita</h2><dl className="dc-facts"><div><dt>Profesional</dt><dd>{a.dentistFirstName} {a.dentistLastName}</dd></div><div><dt>Referencia</dt><dd>Cita #{a.id} · Programación {a.occurrenceVersion} · {a.durationMinutes} min</dd></div><div><dt>Motivo de la cita</dt><dd>{a.reason || 'Sin motivo registrado.'}</dd></div><div><dt>Información administrativa</dt><dd>{a.notes || 'Sin notas administrativas.'}</dd></div></dl>
      {canManage ? <div className="dc-secondary-actions"><h3>Gestionar la reserva</h3><div className="dc-actions"><button type="button" className="dc-secondary" disabled={saving || !zoneVerified} onClick={() => setRescheduling(!rescheduling)}>Reprogramar</button><button type="button" className="dc-link" disabled={saving} onClick={() => setConfirmCancel(true)}>Cancelar cita</button></div></div> : null}
      {confirmCancel && canManage ? <div className="dc-draft-warning" role="group" aria-label="Cancelar cita"><p>¿Cancelar esta cita? No podrás volver a programarla desde este registro.</p>{draftWarning ? <p>Hay cambios clínicos sin guardar. No se guardarán al cancelar; los borradores se conservarán en esta página.</p> : null}<div className="dc-actions"><button type="button" className="dc-secondary" disabled={cancel.isPending} onClick={() => setConfirmCancel(false)}>Conservar cita</button><button type="button" className="dc-danger" disabled={saving} onClick={() => { if (busy.current || saving) return; busy.current = true; cancel.mutate(); }}>{cancel.isPending ? 'Cancelando…' : 'Confirmar cancelación'}</button></div></div> : null}
      {rescheduling && canManage && zoneVerified ? <Reschedule appointment={a} zone={zone} onSaved={updated => { refresh(updated); setRescheduling(false); setNotice('Cita reprogramada. Los borradores conservan su destino original.'); }} /> : null}
    </section>
    <div hidden={!clinicalOpen}>
    {clinicalOpen ? <>
      <h2 id="consultation-heading" className="sr-only" tabIndex={-1}>Consulta clínica</h2>
      <nav className="dc-context-access" aria-label="Consulta contextual">
        <button type="button" className="dc-link" aria-expanded={panel === 1} aria-controls="clinical-panel-1" onClick={() => selectPanel(1)}>Registros de esta atención</button>
        <button type="button" className="dc-link" aria-expanded={panel === 2} aria-controls="clinical-panel-2" onClick={() => selectPanel(2)}>Borradores pendientes{activeDrafts.length ? ` · ${activeDrafts.length}` : ''}</button>
        <button type="button" className="dc-link" aria-expanded={panel === 5} aria-controls="clinical-panel-5" onClick={() => selectPanel(5)}>Historial del paciente</button>
      </nav>
      <section id="clinical-panel-1" hidden={panel !== 1} aria-label="Registros guardados de esta atención" className="dc-context-panel">
        <h2 id="clinical-context-1" tabIndex={-1}>Registros guardados de esta atención</h2>
        {visited.has(1) ? <ClinicalActivity key={a.occurrenceVersion} appointment={a} zone={zone} /> : null}
        <button type="button" className="dc-link" onClick={() => selectPanel(null)}>Volver a consulta</button>
      </section>
      <section id="clinical-panel-2" hidden={panel !== 2} aria-label="Borradores pendientes" className="dc-context-panel">
        <h2 id="clinical-context-2" tabIndex={-1}>Borradores pendientes</h2>
        <p className="dc-caption">Se conservan al explorar la consulta. No se guardan al finalizar ni al salir.</p>
        {activeDrafts.length ? <ul>{activeDrafts.map(([id, value]) => <li key={id}>{value.label} · Sin guardar <button type="button" className="dc-link" onClick={() => goToDraft(id)}>Ir al borrador de {value.label.toLowerCase()}</button></li>)}</ul> : <p>Sin borradores pendientes.</p>}
        <button type="button" className="dc-link" onClick={() => selectPanel(null)}>Volver a consulta</button>
      </section>
    </> : null}
    <section id="clinical-panel-3" className="dc-context-panel" aria-label="Expediente del paciente" hidden={panel !== 3}>{visited.has(3) ? <ClinicalDraftGroup id="clinical-record" label="Expediente" onChange={reportDraft}><h2 id="clinical-context-3" tabIndex={-1}>Expediente del paciente</h2><p className="dc-caption">Datos actuales del paciente, no notas de esta cita.</p><IntakeDeclarations patientId={a.patientId} /><ClinicalRecordCard patientId={a.patientId} editable /><button type="button" className="dc-link" onClick={() => selectPanel(null)}>Volver a consulta</button><Link className="dc-link" to={`/patients/${a.patientId}?appointmentId=${a.id}&occurrenceVersion=${a.occurrenceVersion}`}>Expediente completo</Link></ClinicalDraftGroup> : null}</section>
    <section id="clinical-panel-5" className="dc-context-panel" aria-label="Historial del paciente" hidden={panel !== 5}>{visited.has(5) ? <ClinicalDraftGroup id="clinical-history" label="Corrección de nota" onChange={reportDraft}><h2 id="clinical-context-5" tabIndex={-1}>Historial del paciente</h2><ClinicalNotesCard patientId={a.patientId} editable timeZone={zone} editorial compose={false} />
      {a.occurrenceVersion > 1 ? <><label className="dc-field">Programación de esta cita<select value={version} onChange={e => setVersion(Number(e.target.value))}>{Array.from({ length: a.occurrenceVersion }, (_, i) => <option key={i} value={i + 1}>{i + 1 === a.occurrenceVersion ? 'Programación actual' : `Programación anterior ${i + 1}`}</option>)}</select></label><AttentionTraceSection key={version} patientId={a.patientId} selection={{ appointmentId: a.id, occurrenceVersion: version }} timeZone={zone} editorial /></> : null}
      <details><summary>Actividad de la cita</summary>{events.isPending ? <p role="status">Consultando actividad…</p> : events.isError ? <p role="alert">No se pudo consultar la actividad. <button type="button" className="dc-link" onClick={() => void events.refetch()}>Reintentar actividad</button></p> : events.data?.length ? <ul className="dc-event-list">{events.data.map(e => <li key={e.id}>{EVENT_LABELS[e.eventType]} · {formatDayLong(e.createdAt, zone)} {formatTime(e.createdAt, zone)}</li>)}</ul> : <p>Sin actividad registrada.</p>}</details><button type="button" className="dc-link" onClick={() => selectPanel(null)}>Volver a consulta</button></ClinicalDraftGroup> : null}</section>
    {clinicalOpen ? <>
      <div className="dc-console-work">
        <section className="dc-console-dental" aria-label="Área dental">
          <ClinicalDraftGroup id="clinical-dental" label="Odontograma" onChange={reportDraft}>
            <OdontogramSection patientId={a.patientId} editable timeZone={zone} appointment={context} initialHistorySelection={{ appointmentId: a.id, occurrenceVersion: initialVersion }} contextualWriteBlocked={!clinicalEditable} integrated consoleMode focused={dentalFocused} onFocusChange={setDentalFocused} />
          </ClinicalDraftGroup>
        </section>
        <section className="dc-console-note" aria-label="Nota de la consulta" hidden={dentalFocused}>
          <ClinicalDraftGroup id="clinical-note" label="Nota" onChange={reportDraft}>
            <ClinicalNotesCard patientId={a.patientId} editable timeZone={zone} displayNotes={false} appointment={context} editorial contextualWriteBlocked={!clinicalEditable} consoleMode />
          </ClinicalDraftGroup>
        </section>
      </div>
      <section className="dc-console-treatments" aria-label="Tratamientos del paciente" hidden={dentalFocused}>
        <ClinicalDraftGroup id="clinical-treatments" label="Tratamientos y evolución" onChange={reportDraft}>
          <TreatmentsSection patientId={a.patientId} editable appointment={{ id: a.id, ...context }} editorial contextualWriteBlocked={!clinicalEditable} integrated compact />
        </ClinicalDraftGroup>
      </section>
    </> : null}
      {user?.role === 'OWNER' ? <Link className="dc-link" to={`/appointments/${a.id}${params.has('returnTo') ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`}>Volver al detalle administrativo</Link> : null}
      <p className="dc-console-privacy">Dato de salud protegido · Cada registro se guarda por separado.</p>
    </div>
    {completionVisited || recovering ? <UnsavedChangesContext.Provider value={navigationGuard}><ClinicalCompletion active={reviewOpen} appointment={a} zone={zone} hasDrafts={hasDrafts} saving={saving} refreshFailed={refreshFailed} returnTo={returnTo} onBack={closeCompletion} /></UnsavedChangesContext.Provider> : null}
  </div>;
}

function Reschedule({ appointment: a, zone, onSaved }: { appointment: AppointmentResponse; zone: string; onSaved: (a: AppointmentResponse) => void }) {
  const [day, setDay] = useState(localDateInput(new Date(a.startAt), zone));
  const [selected, setSelected] = useState('');
  const submitting = useRef(false);
  const availability = useQuery({ queryKey: ['availability', 'dentist-reschedule', a.id, day], queryFn: () => schedulingApi.availability({ dentistId: a.dentistId, from: day, appointmentId: a.id }), enabled: Boolean(day) });
  const slot = availability.data?.slots.find(s => s.start === selected);
  const save = useMutation({ retry: false, mutationFn: async () => {
    const result = await availability.refetch();
    const current = result.data?.slots.find(s => s.start === selected);
    if (result.isError || !current) throw new Error('Ese horario ya no está disponible. Selecciona otro.');
    return appointmentsApi.reschedule(a.id, { startAt: current.start, endAt: current.end, expectedOccurrenceVersion: a.occurrenceVersion });
  }, onSuccess: onSaved, onSettled: () => { submitting.current = false; } });
  return <section className="dc-reschedule" aria-label="Reprogramar cita"><h3>Elegir otro horario</h3><label className="dc-field">Día<input type="date" value={day} disabled={save.isPending} onChange={e => { setDay(e.target.value); setSelected(''); }} /></label>
    {availability.isPending || availability.isFetching ? <p role="status">Consultando horarios…</p> : availability.isError ? <p role="alert">No se pudo consultar la disponibilidad. <button type="button" className="dc-link" onClick={() => void availability.refetch()}>Reintentar horarios</button></p> : <DentistSlots slots={availability.data?.slots ?? []} selected={selected} onSelect={s => { if (!save.isPending) setSelected(s.start); }} timezone={zone} durationMinutes={availability.data.durationMinutes} />}
    {availability.isSuccess && !availability.data.slots.length ? <p>No hay horarios disponibles para este día. Prueba otra fecha.</p> : null}
    {save.isError ? <p role="alert">{apiErrorMessage(save.error, 'No se pudo reprogramar la cita.')}</p> : null}
    <button className="dc-secondary" type="button" disabled={!slot || availability.isFetching || save.isPending} onClick={() => { if (submitting.current) return; submitting.current = true; save.mutate(); }}> {save.isPending ? 'Reprogramando…' : 'Confirmar reprogramación'}</button>
  </section>;
}
