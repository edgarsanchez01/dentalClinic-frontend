import { apiFetch, ApiError } from './http';

export type FeedbackState = 'AVAILABLE' | 'EXPIRED' | 'USED' | 'INVALID' | 'RESPONDED';
export interface Review { id: number; rating: number; comment: string | null; respondedAt: string }
export interface Reviews {
  content: Review[]; page: number; size: number; totalElements: number; totalPages: number;
  count: number; average: number | null;
}
export const REVIEW_ROLES = ['OWNER', 'DENTIST'] as const;

// Los errores públicos nunca propagan URLs/tokens desde el transporte.
async function invitation(token: string, answer?: { rating: number; comment: string }) {
  try {
    return await apiFetch<{ state: FeedbackState }>(`/api/feedback/invitations/${encodeURIComponent(token)}`, {
      auth: false, ...(answer ? { method: 'POST', body: answer } : {}),
    });
  } catch (cause) {
    if (cause instanceof ApiError && (cause.status === 409 || cause.status === 410)) {
      const state = (cause.body as unknown as { state?: FeedbackState } | null)?.state;
      return { state: state === 'USED' || state === 'EXPIRED' ? state : 'INVALID' as FeedbackState };
    }
    // eslint-disable-next-line preserve-caught-error -- El error de transporte puede contener el token en su URL; no conservarlo.
    throw new Error(cause instanceof ApiError && cause.status === 400
      ? 'Revisa la calificación y el comentario (máximo 2000 caracteres).'
      : 'No pudimos conectar. Inténtalo de nuevo; tu respuesta no se enviará dos veces.');
  }
}

export const feedbackApi = {
  validate: (token: string) => invitation(token),
  respond: (token: string, rating: number, comment: string) => invitation(token, { rating, comment }),
  reviews: (page = 0) => apiFetch<Reviews>(`/api/feedback?page=${page}&size=20`),
};
