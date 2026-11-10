import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { appointmentsApi, type AppointmentResponse } from '../../api/appointments';
import { useVerifiedOperation } from '../../app/useVerifiedOperation';
import { useAuthStore } from '../../app/authStore';
import { ClinicalActivity } from './ClinicalActivity';
import { formatDayLong, formatTime } from '../appointments/appointmentUi';
import { reflectCompletionInAgenda } from '../appointments/agendaCache';
import { useInvalidateNotifications } from '../notifications/notificationQueries';

export function ClinicalCompletion({ appointment: a, zone, hasDrafts, saving, refreshFailed, returnTo, onBack, active }: {
  appointment: AppointmentResponse; zone: string; hasDrafts: () => boolean; saving: boolean;
  refreshFailed: boolean; returnTo: string; onBack: () => void; active: boolean;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const invalidateNotifications = useInvalidateNotifications();
  const user = useAuthStore(s => s.user);
  const session = useAuthStore(s => s.sessionVersion);
  const operation = useVerifiedOperation<{ expectedOccurrenceVersion: number }, AppointmentResponse>('clinical-completion', a.id);
  const { op } = operation;
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (active) { dialog.current?.showModal(); heading.current?.focus(); }
    else dialog.current?.close();
  }, [active]);
  // useVerifiedOperation releases the unload/router guard before this effect navigates.
  useEffect(() => {
    if (op?.state === 'success' && !hasDrafts() && !saving) {
      void Promise.resolve(navigate(returnTo)).then(() => client.setQueryData(['clinical-completion-operation', user?.id, a.id], null));
    }
  }, [op?.state, navigate, returnTo, hasDrafts, saving, client, user?.id, a.id]);
  const eligible = (user?.role === 'DENTIST' || user?.role === 'OWNER') && user.dentistId === a.dentistId && a.status === 'SCHEDULED';
  const blocked = hasDrafts() || saving;
  function confirm() {
    if (blocked || (!op && (!eligible || refreshFailed))) return;
    void operation.send({ expectedOccurrenceVersion: a.occurrenceVersion }, (input, key) => appointmentsApi.complete(a.id, input, key), (result, input) => {
      if (!result || result.id !== a.id || result.patientId !== a.patientId || result.dentistId !== a.dentistId || result.status !== 'COMPLETED'
        || result.occurrenceVersion !== input.expectedOccurrenceVersion || !result.completedAt || !Number.isFinite(Date.parse(result.completedAt))) throw new Error('Respuesta clínica no verificable');
    }, async result => {
      await client.cancelQueries({ queryKey: ['appointment', a.id] });
      if (useAuthStore.getState().sessionVersion !== session) return;
      client.setQueryData(['appointment', a.id], result);
      reflectCompletionInAgenda(client, result);
      for (const key of [['appointments'], ['appointment-events', a.id], ['availability'], ['collection-queue'], ['clinical-trace', a.patientId], ['odontogram-at', a.patientId]]) void client.invalidateQueries({ queryKey: key });
      void invalidateNotifications();
    });
  }
  return <dialog ref={dialog} className="dc-completion" aria-modal="true" aria-busy={op?.state === 'pending'} aria-labelledby="completion-heading" onCancel={event => { event.preventDefault(); if (op?.state !== 'pending') onBack(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]'));
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); heading.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
    <h2 id="completion-heading" tabIndex={-1} ref={heading}>Finalizar atención</h2>
    <p>{a.patientFirstName} {a.patientLastName} · Cita #{a.id}</p>
    <p className="dc-caption">{a.service?.name ?? 'Sin servicio asociado'} · {formatDayLong(a.startAt, zone)} · {formatTime(a.startAt, zone)}–{formatTime(a.endAt, zone)} ({zone})</p>
    <h3>Registros guardados</h3>
    <ClinicalActivity appointment={a} zone={zone} summary />
    <p role="status" className={blocked ? 'dc-draft-warning' : 'dc-caption'}>{saving ? 'Guardado en curso. Espera su respuesta antes de finalizar.' : hasDrafts() ? 'Hay borradores sin guardar. Cancela para guardarlos o descartarlos expresamente. No se guardarán al finalizar.' : 'Puedes finalizar sin notas ni tratamientos. No se crean cargos ni pagos.'}</p>
    {op ? <>
      <p role={op.state === 'pending' || op.state === 'success' ? 'status' : 'alert'} className="dc-draft-warning">{op.state === 'pending' ? 'Confirmando finalización clínica…' : op.state === 'success' ? 'Finalización clínica verificada. Regresando a la agenda…' : op.message}</p>
      {op.state === 'uncertain' ? <><p className="dc-caption">Solicitud conservada en esta sesión. Recargar o cerrar sesión pierde esta copia; una lectura de la cita no sustituye el recibo de esta solicitud.</p><button type="button" className="dc-primary" disabled={blocked} onClick={confirm}>Recuperar con la misma solicitud</button></> : null}
      {op.state === 'rejected' ? <button type="button" className="dc-secondary" onClick={async () => { await client.invalidateQueries({ queryKey: ['appointment', a.id] }); operation.clearRejected(); }}>Actualizar cita y revisar de nuevo</button> : null}
    </> : null}
    <div className="dc-flow-footer"><button type="button" className="dc-secondary" disabled={op?.state === 'pending'} onClick={onBack}>Cancelar</button>
      {!op ? <button type="button" className="dc-primary" disabled={blocked || !eligible || refreshFailed} onClick={confirm}>Confirmar finalización</button> : null}
    </div>
  </dialog>;
}
