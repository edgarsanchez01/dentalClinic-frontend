import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FormAlert } from '../auth/ui';
import type { FinancialIntent } from './useFinancialOperation';
import { danger, secondary } from './financialUi';

const labels = { sending: 'Verificando operación…', uncertain: 'Resultado incierto', registered: 'Registrada · pendiente de ejecución',
  confirmed: 'Confirmada', rejected: 'Rechazada sin efecto', abandoned: 'Abandonada sin efecto' };

/** Feedback compartido por captura y recuperacion; ninguna accion se dispara al montar. */
export function FinancialOperationFeedback({ intent, pending, consult, resume, abandon, retryRegistration, retryRead, startNew }: {
  intent: FinancialIntent<unknown> | null; pending: boolean; consult: () => Promise<void>; resume: () => Promise<void>;
  abandon: () => Promise<void>; retryRegistration: () => Promise<void>; retryRead: () => Promise<void>; startNew?: (() => void) | undefined;
}) {
  const [confirmation, setConfirmation] = useState<'resume' | 'abandon' | null>(null);
  if (!intent) return null;
  return <div className="my-3 grid justify-items-start gap-3" aria-busy={pending}>
    <p role="status" aria-live="polite" className="font-medium">{pending ? labels.sending : labels[intent.phase]}</p>
    {intent.message ? <FormAlert tone={intent.phase === 'confirmed' ? 'success' : 'danger'}>{intent.message}</FormAlert> : null}
    {intent.phase === 'uncertain' ? <p className="max-w-prose text-[length:var(--text-body-sm)] text-ink-secondary">
      No se ha podido verificar el resultado. Consulta esta misma operación antes de reanudar; no crees otra solicitud para reintentar.
      Tras recargar o iniciar sesión, puedes recuperarla en Finanzas.
    </p> : null}
    {intent.phase === 'registered' ? <p className="max-w-prose text-[length:var(--text-body-sm)] text-ink-secondary">
      El servidor conserva la solicitud original. Este estado no descarta una ejecución en curso. Reanudar usa la misma identidad y no permite cambiar el comando.
    </p> : null}
    {intent.phase === 'rejected' ? <p>El servidor acreditó el rechazo sin efecto financiero. La solicitud está cerrada.</p> : null}
    {intent.phase === 'abandoned' ? <p>La solicitud está cerrada sin efecto. No se ha revertido ningún cobro confirmado.</p> : null}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={secondary} disabled={pending} onClick={() => void consult()}>Consultar operación</button>
      {intent.phase === 'registered' && !confirmation ? <>
        <button type="button" className={secondary} disabled={pending} onClick={() => setConfirmation('resume')}>Reanudar operación</button>
        <button type="button" className={secondary} disabled={pending} onClick={() => setConfirmation('abandon')}>Abandonar operación</button>
      </> : null}
      {intent.registrationMissing ? <button type="button" className={secondary} disabled={pending} onClick={() => void retryRegistration()}>Reintentar registro con la misma identidad</button> : null}
      {intent.phase === 'confirmed' && intent.message ? <button type="button" className={secondary} disabled={pending} onClick={() => void retryRead()}>Reintentar consulta del estado</button> : null}
      {startNew && (intent.phase === 'rejected' || intent.phase === 'abandoned') ? <button type="button" className={secondary} disabled={pending || Boolean(intent.message)} onClick={startNew}>Preparar una nueva solicitud</button> : null}
    </div>
    {confirmation && intent.phase === 'registered' ? <section className="grid gap-3" aria-label={confirmation === 'resume' ? 'Confirmar reanudación' : 'Confirmar abandono'}>
      <p className="max-w-prose">{confirmation === 'resume'
        ? '¿Reanudar exactamente la solicitud registrada? Puede producir el efecto financiero pendiente; no es una consulta.'
        : '¿Cerrar esta solicitud sin efecto? El servidor comprobará que no esté confirmada. No se anulan ni reversan cobros existentes.'}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={confirmation === 'abandon' ? danger : secondary} disabled={pending} onClick={() => {
          const action = confirmation === 'resume' ? resume : abandon;
          setConfirmation(null); void action();
        }}>{confirmation === 'resume' ? 'Confirmar reanudación' : 'Confirmar abandono'}</button>
        <button type="button" className={secondary} disabled={pending} onClick={() => setConfirmation(null)}>Volver sin operar</button>
      </div>
    </section> : null}
    {intent.view?.effect ? <Link className="underline underline-offset-2" to={`/finances/${intent.view.effect.chargeId}`}>Ver cargo confirmado #{intent.view.effect.chargeId}</Link> : null}
  </div>;
}
