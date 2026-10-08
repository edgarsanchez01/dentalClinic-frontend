/**
 * Configuracion de entorno del frontend (Fase 1 - Fundacion).
 *
 * `VITE_*` queda incrustado en el bundle en build: solo valores publicos y no
 * secretos. Ninguna credencial viaja al cliente.
 */
const rawBaseUrl = import.meta.env.VITE_API_BASE_URL;

export const apiConfig = {
  /** Base URL del backend. Vacio = mismo origen (proxy de Vite en desarrollo). */
  baseUrl: rawBaseUrl ?? '',
} as const;

export type ApiConfig = typeof apiConfig;