import { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';

import { authApi, type LoginResponse, type RegisterInput, type Role, type UserDto } from '../api/auth';
import { ApiError, cancelSessionRequests, refreshSession, setUnauthenticatedHandler, tokenStore } from '../api/http';

export type SessionStatus = 'restoring' | 'anonymous' | 'authenticated';

interface AuthState {
  queryClient: QueryClient;
  sessionVersion: number;
  status: SessionStatus;
  user: UserDto | null;
  restorationError: boolean;
  refreshProfile: () => Promise<void>;
  /** Restaura la sesion al arrancar: intenta refresh (cookie HttpOnly) y resuelve /me. */
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  hasRole: (role: Role) => boolean;
}

/**
 * Estado de sesion del cliente (Architecture.md 14.3-14.4).
 *
 * El access token NO vive aqui: esta en `tokenStore` (memoria) para que ni Zustand ni
 * ninguna herramienta de depuracion lo serialicen. El store solo guarda el perfil y el
 * estado de restauracion. `restoring` es lo que evita el "parpadeo" a login en una
 * recarga con sesion valida. El QueryClient de la sesion contiene el server-state;
 * sus respuestas no se duplican en campos de Zustand.
 */
export const useAuthStore = create<AuthState>((set, get) => {
  let operationVersion = 0;
  let registrationVersion: number | null = null;
  const createQueryClient = () => new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  // Una frontera de sesion descarta queries, mutaciones y respuestas anteriores.
  const beginSession = (status: SessionStatus): number => {
    cancelSessionRequests();
    tokenStore.set(null);
    get().queryClient.clear();
    const sessionVersion = get().sessionVersion + 1;
    set({ status, user: null, restorationError: false, queryClient: createQueryClient(), sessionVersion });
    return ++operationVersion;
  };
  setUnauthenticatedHandler(() => {
    const recoveringRegistration = registrationVersion === operationVersion;
    beginSession(recoveringRegistration ? 'restoring' : 'anonymous');
    if (recoveringRegistration) set({ restorationError: true });
  });

  // Login y registro publican sesión solo después del perfil autoritativo.
  const authenticate = async (issue: () => Promise<LoginResponse>, registration = false) => {
    if (get().status !== 'anonymous') beginSession('anonymous');
    cancelSessionRequests();
    tokenStore.set(null);
    const version = ++operationVersion;
    let issued = false;
    try {
      const response = await issue();
      if (operationVersion !== version) throw new DOMException('Sesion reemplazada', 'AbortError');
      issued = true;
      if (registration) registrationVersion = version;
      tokenStore.set(response.accessToken);
      const user = await authApi.me();
      if (operationVersion !== version) throw new DOMException('Sesion reemplazada', 'AbortError');
      const token = tokenStore.get(); // /me puede haber renovado el access token.
      beginSession('anonymous');
      tokenStore.set(token);
      set({ status: 'authenticated', user });
    } catch (cause) {
      if (operationVersion === version) {
        cancelSessionRequests();
        tokenStore.set(null);
        if (registration && (issued || !(cause instanceof ApiError) || cause.status >= 500)) {
          // Alta confirmada o resultado de red incierto: recuperar cookie + /me antes
          // de permitir otro formulario; nunca repetir automáticamente el POST de alta.
          beginSession('restoring');
          set({ restorationError: true });
        }
      }
      throw cause;
    } finally {
      if (registrationVersion === version) registrationVersion = null;
    }
  };

  return {
    queryClient: createQueryClient(),
    sessionVersion: 0,
    status: 'restoring',
    user: null,
    restorationError: false,
    refreshProfile: async () => {
      const version = operationVersion;
      const user = await authApi.me();
      if (operationVersion === version) set({ user });
    },

    hydrate: async () => {
      const version = beginSession('restoring');
      try {
        const refreshed = await refreshSession();
        if (operationVersion !== version) return;
        if (!refreshed) {
          beginSession('anonymous');
          return;
        }
        const user = await authApi.me();
        if (operationVersion !== version) return;
        set({ status: 'authenticated', user });
      } catch {
        if (operationVersion === version) set({ restorationError: true });
      }
    },

    login: (email, password) => authenticate(() => authApi.login(email, password)),
    register: input => authenticate(() => authApi.register(input), true),

    logout: async () => {
      beginSession('anonymous');
      await authApi.logout();
    },

    changePassword: async (currentPassword, newPassword) => {
      const version = operationVersion;
      await authApi.changePassword(currentPassword, newPassword);
      // El backend revoca TODAS las familias al cambiar la contrasena: la sesion
      // actual deja de poder renovar, asi que se cierra en el cliente de forma explicita.
      if (operationVersion === version) beginSession('anonymous');
    },

    hasRole: (role) => get().user?.role === role,
  };
});
