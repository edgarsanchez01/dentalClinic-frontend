import { create } from 'zustand';

import { authApi, type Role, type UserDto } from '../api/auth';
import { refreshSession, setUnauthenticatedHandler, tokenStore } from '../api/http';

export type SessionStatus = 'restoring' | 'anonymous' | 'authenticated';

interface AuthState {
  status: SessionStatus;
  user: UserDto | null;
  /** Restaura la sesion al arrancar: intenta refresh (cookie HttpOnly) y resuelve /me. */
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
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
 * recarga con sesion valida.
 */
export const useAuthStore = create<AuthState>((set, get) => {
  setUnauthenticatedHandler(() => set({ status: 'anonymous', user: null }));

  return {
    status: 'restoring',
    user: null,

    hydrate: async () => {
      try {
        const refreshed = await refreshSession();
        if (!refreshed) {
          set({ status: 'anonymous', user: null });
          return;
        }
        const user = await authApi.me();
        set({ status: 'authenticated', user });
      } catch {
        tokenStore.set(null);
        set({ status: 'anonymous', user: null });
      }
    },

    login: async (email, password) => {
      const response = await authApi.login(email, password);
      set({ status: 'authenticated', user: response.user });
    },

    logout: async () => {
      try {
        await authApi.logout();
      } finally {
        tokenStore.set(null);
        set({ status: 'anonymous', user: null });
      }
    },

    changePassword: async (currentPassword, newPassword) => {
      await authApi.changePassword(currentPassword, newPassword);
      // El backend revoca TODAS las familias al cambiar la contrasena: la sesion
      // actual deja de poder renovar, asi que se cierra en el cliente de forma explicita.
      tokenStore.set(null);
      set({ status: 'anonymous', user: null });
    },

    hasRole: (role) => get().user?.role === role,
  };
});