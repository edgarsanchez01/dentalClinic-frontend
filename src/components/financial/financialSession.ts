import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../../app/authStore';

/** La respuesta pertenece a actor, rol, version y cache; no basta comparar solo un contador. */
export function useFinancialSession() {
  // Cambiar solo estado/cache tambien debe ocultar inmediatamente la presentacion anterior.
  useAuthStore(state => state.status);
  useAuthStore(state => state.queryClient);
  const userId = useAuthStore(state => state.user?.id);
  const role = useAuthStore(state => state.user?.role);
  const version = useAuthStore(state => state.sessionVersion);
  const client = useQueryClient();
  return { userId, role, version, client };
}
export function isFinancialSessionCurrent(session: ReturnType<typeof useFinancialSession>): boolean {
  const current = useAuthStore.getState();
  return session.userId !== undefined && current.status === 'authenticated' && current.user?.id === session.userId
    && current.user.role === session.role && current.sessionVersion === session.version && current.queryClient === session.client;
}
