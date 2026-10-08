import { apiFetch, tokenStore } from './http';

export type Role = 'OWNER' | 'DENTIST' | 'RECEPTIONIST' | 'PATIENT';

/** Perfil publico de la sesion (`GET /api/auth/me`). Nunca incluye hash ni token. */
export interface UserDto {
  id: number;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
  /** Solo aparece si el usuario tiene un `Patient` asociado (P-08); no se infiere. */
  patientId?: number;
  /** Solo aparece si el usuario tiene un `Dentist` asociado (A-12); gate de acciones de trayectoria. */
  dentistId?: number | undefined;
}

/** Alta publica de paciente (`POST /api/auth/register`). El rol nunca viaja en el cuerpo. */
export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  birthDate?: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: string;
  accessTokenExpiresAt: string;
  user: UserDto;
}

export interface TokensResponse {
  accessToken: string;
  tokenType: string;
  accessTokenExpiresAt: string;
}

/**
 * Endpoints del modulo de identidad (Architecture.md 14). Ninguna funcion persiste
 * el access token: lo guarda `tokenStore` en memoria. `login` y `refresh` son los
 * unicos que lo actualizan.
 */
export const authApi = {
  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await apiFetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      auth: false,
      body: { email, password },
    });
    tokenStore.set(response.accessToken);
    return response;
  },

  /** Consumo de invitacion: no abre sesion, solo activa la cuenta. */
  activate(token: string, password: string): Promise<void> {
    return apiFetch<void>('/api/auth/activate', {
      method: 'POST',
      auth: false,
      body: { token, password },
    });
  },

  /**
   * Registro publico (RF-IA-05/06): crea `User(PATIENT)` + `Patient` en una transaccion. No abre
   * sesion; el paciente entra por /login de forma explicita.
   */
  register(input: RegisterInput): Promise<UserDto> {
    return apiFetch<UserDto>('/api/auth/register', {
      method: 'POST',
      auth: false,
      body: input,
    });
  },

  /** Siempre neutro (202), exista o no la cuenta. */
  requestPasswordReset(email: string): Promise<void> {
    return apiFetch<void>('/api/auth/password/forgot', {
      method: 'POST',
      auth: false,
      body: { email },
    });
  },

  resetPassword(token: string, newPassword: string): Promise<void> {
    return apiFetch<void>('/api/auth/password/reset', {
      method: 'POST',
      auth: false,
      body: { token, newPassword },
    });
  },

  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return apiFetch<void>('/api/auth/password/change', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
  },

  me(): Promise<UserDto> {
    return apiFetch<UserDto>('/api/auth/me');
  },

  /** Cierra la sesion solo en el servidor; el estado local lo limpia el store. */
  logout(): Promise<void> {
    return apiFetch<void>('/api/auth/logout', { method: 'POST', auth: false });
  },
};