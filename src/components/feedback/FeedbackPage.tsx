import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { feedbackApi, type FeedbackState } from '../../api/feedback';
import { AuthCard, FormAlert } from '../auth/ui';

export function Star({ filled }: { filled: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor" strokeWidth="1.5"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.2-5.6-3-5.6 3 1.1-6.2L2.9 9.6l6.3-.9Z" /></svg>;
}

const messages: Partial<Record<FeedbackState, string>> = {
  INVALID: 'El enlace no es válido. Comprueba que abriste el enlace completo del correo.',
  EXPIRED: 'Este enlace venció. Las invitaciones tienen una vigencia de 7 días.',
  USED: 'Esta invitación ya fue respondida. La reseña no se puede modificar ni enviar de nuevo.',
  RESPONDED: 'Gracias por compartir tu experiencia. Tu reseña se guardó de forma privada.',
};

export function FeedbackPage() {
  const { token = '' } = useParams();
  // Remontar al cambiar enlace evita reutilizar el borrador/resultado de otra invitación.
  return <FeedbackForm key={token} token={token} />;
}

function FeedbackForm({ token }: { token: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const link = useQuery({ queryKey: ['feedback-link', token], queryFn: () => feedbackApi.validate(token),
    retry: false, gcTime: 0, refetchOnWindowFocus: false });
  const send = useMutation({ mutationFn: () => feedbackApi.respond(token, rating, comment), retry: false });
  const state = send.data?.state ?? link.data?.state;
  const message = state ? messages[state] : undefined;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!rating) { setError('Selecciona de 1 a 5 estrellas.'); return; }
    if (comment.length > 2000) { setError('El comentario admite hasta 2000 caracteres.'); return; }
    try { await send.mutateAsync(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar. Inténtalo de nuevo.');
    }
  }

  return <AuthCard title="¿Cómo fue tu atención?" intro="Tu opinión es privada y nos ayuda a mejorar la atención.">
    <meta name="referrer" content="no-referrer" />
    <meta name="robots" content="noindex, nofollow" />
    {link.isPending ? <p role="status">Comprobando invitación…</p> : link.isError ? <>
      <FormAlert>No pudimos comprobar el enlace. Inténtalo de nuevo.</FormAlert>
      <button type="button" className="mt-4 min-h-11 text-ink underline" onClick={() => void link.refetch()}>Reintentar</button>
    </> : message ? <p role="status" className="text-ink">{message}</p> : state === 'AVAILABLE' ?
      <form className="grid gap-5" onSubmit={submit}>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <fieldset disabled={send.isPending}>
          <legend className="text-ink font-medium">Calificación (obligatoria)</legend>
          <div className="mt-2 flex gap-1">
            {[1, 2, 3, 4, 5].map(value => <label key={value} className="relative flex min-h-11 min-w-11 cursor-pointer items-center justify-center text-primary hover:bg-primary-subtle">
              <input type="radio" name="rating" value={value} checked={rating === value} onChange={() => setRating(value)}
                aria-label={`${value} ${value === 1 ? 'estrella' : 'estrellas'}`} className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0" />
              <span className="pointer-events-none rounded-control p-1 peer-focus-visible:ring-2 peer-focus-visible:ring-primary"><Star filled={rating >= value} /></span>
            </label>)}
          </div>
          <p className="mt-2 text-ink-secondary text-[length:var(--text-body-sm)]" aria-live="polite">{rating ? `${rating} de 5 estrellas` : 'Selecciona una calificación'}</p>
        </fieldset>
        <div>
          <label htmlFor="feedback-comment" className="text-ink font-medium">Comentario (opcional)</label>
          <textarea id="feedback-comment" rows={4} maxLength={2000} value={comment} disabled={send.isPending}
            onChange={event => setComment(event.target.value)} aria-describedby="feedback-help"
            className="mt-2 w-full resize-y rounded-control bg-input-fill px-3 py-2 text-ink ring-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-primary" />
          <p id="feedback-help" className="mt-2 text-[length:var(--text-body-sm)] text-ink-secondary">Máximo 2000 caracteres. Evita incluir información clínica sensible.</p>
        </div>
        <p className="text-[length:var(--text-body-sm)] text-ink-secondary">Solo puedes responder una vez. Después del envío no podrás modificar la reseña.</p>
        <button type="submit" disabled={send.isPending}
          className="min-h-11 w-full rounded-control bg-primary px-4 py-2 font-medium text-paper outline-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-60">
          {send.isPending ? 'Enviando…' : 'Enviar reseña'}
        </button>
      </form> : null}
  </AuthCard>;
}
