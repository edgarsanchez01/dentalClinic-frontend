import { useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/http';
import { useAuthStore } from './authStore';
import { useUnsavedChanges } from './unsavedChanges';

export interface VerifiedOperation<I, R> {
  key: string; input: I; state: 'pending' | 'uncertain' | 'rejected' | 'blocked' | 'success';
  message?: string; result?: R;
}

/** Session-owned memory, no persistence of health/payment data; no automatic business retry. */
export function useVerifiedOperation<I, R>(kind: 'clinical-completion' | 'collection', appointmentId: number) {
  const client = useQueryClient();
  const actor = useAuthStore(s => s.user?.id);
  const session = useAuthStore(s => s.sessionVersion);
  const key = [kind + '-operation', actor, appointmentId] as const;
  const query = useQuery<VerifiedOperation<I, R> | null>({ queryKey: key, queryFn: () => null, enabled: false, gcTime: Infinity });
  const lock = useRef(false);
  const op = query.data;
  useUnsavedChanges(op?.state === 'pending' || op?.state === 'uncertain', 'operation');
  async function send(input: I, request: (input: I, key: string) => Promise<R>, verify: (result: R, input: I) => void, success: (result: R) => void | Promise<void>) {
    const existing = client.getQueryData<VerifiedOperation<I, R> | null>(key);
    if (lock.current || (existing && existing.state !== 'uncertain')) return;
    lock.current = true;
    const command = existing ?? { key: crypto.randomUUID(), input, state: 'pending' as const };
    client.setQueryData(key, { ...command, state: 'pending' });
    try {
      const result = await request(command.input, command.key);
      verify(result, command.input);
      if (useAuthStore.getState().sessionVersion !== session) return;
      await success(result);
      if (useAuthStore.getState().sessionVersion === session) client.setQueryData(key, { ...command, state: 'success', result });
    } catch (cause) {
      if (useAuthStore.getState().sessionVersion !== session) return;
      const status = cause instanceof ApiError ? cause.status : 0;
      const state = [401, 403, 404].includes(status) ? 'blocked' : [400, 409, 422].includes(status) ? 'rejected' : 'uncertain';
      const code = cause instanceof ApiError ? cause.body?.code : '';
      const message = state === 'blocked' ? 'No tienes permiso o el recurso ya no está disponible. Solicita verificación al personal autorizado.' : state === 'rejected'
        ? code === 'COLLECTION_CHARGE_AMBIGUOUS' ? 'Hay varios cargos activos. Se requiere resolución administrativa.'
          : code === 'COLLECTION_ECONOMIC_REFERENCE_REQUIRED' || code === 'FINANCIAL_CONTEXT_UNAVAILABLE' ? 'No se pudo verificar la referencia económica. Se requiere resolución administrativa.'
          : 'El servidor rechazó la solicitud. Actualiza y revisa el estado, la programación y el contexto antes de confirmar de nuevo.'
        : 'Resultado incierto. No se asume que la operación se haya revertido. Recupera la respuesta con la misma solicitud y clave; no inicies otra operación.';
      client.setQueryData(key, { ...command, state, message });
    } finally { lock.current = false; }
  }
  function clearRejected() {
    const current = client.getQueryData<VerifiedOperation<I, R> | null>(key);
    if (current?.state === 'rejected' || current?.state === 'success') client.setQueryData(key, null);
  }
  return { op, send, clearRejected };
}
