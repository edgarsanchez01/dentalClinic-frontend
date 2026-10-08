import { apiConfig } from '../lib/config';

/**
 * Cliente HTTP central (Architecture.md 14.4).
 *
 * Reglas de Fase 2:
 *  - El access token vive SOLO en memoria (`tokenStore`); nunca en localStorage ni
 *    sessionStorage, para que un XSS no pueda robarlo de forma persistente.
 *  - El refresh token vive en una cookie `HttpOnly` que este codigo no puede leer.
 *    Por eso cada peticion que depende de la sesion usa `credentials: 'include'`.
 *  - Las operaciones que dependen de cookie (`refresh`, `logout`) exigen el token
 *    CSRF en la cabecera `X-XSRF-TOKEN`, leido de la cookie `XSRF-TOKEN`.
 *  - Ante un 401 en una ruta autenticada se intenta UN refresh y se reintenta la
 *    peticion una sola vez; si el refresh falla, la sesion se considera cerrada.
 */

export interface ApiErrorBody {
  status: number;
  error: string;
  message: string;
  path: string;
  timestamp: string;
  fieldErrors?: Record<string, string>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;
  readonly fieldErrors: Record<string, string>;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    this.fieldErrors = body?.fieldErrors ?? {};
  }
}

/** Access token en memoria. No se serializa ni se persiste. */
let accessToken: string | null = null;

export const tokenStore = {
  get: (): string | null => accessToken,
  set: (token: string | null): void => {
    accessToken = token;
  },
};

let unauthenticatedHandler: (() => void) | null = null;

/** La capa de sesion registra aqui como reaccionar cuando el refresh falla. */
export function setUnauthenticatedHandler(handler: () => void): void {
  unauthenticatedHandler = handler;
}

function notifyUnauthenticated(): void {
  tokenStore.set(null);
  unauthenticatedHandler?.();
}

const CSRF_COOKIE = 'XSRF-TOKEN';
const CSRF_HEADER = 'X-XSRF-TOKEN';

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function parseError(response: Response, path: string): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  return new ApiError(response.status, body, `${path} devolvio ${response.status}`);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Si es `false`, no adjunta el access token ni intenta refresh (endpoints publicos). */
  auth?: boolean;
  headers?: Record<string, string>;
}

export async function apiFetch<T>(
  path: string,
  { method = 'GET', body, auth = true, headers }: RequestOptions = {},
): Promise<T> {
  const opts: { method: "GET"|"POST"|"PATCH"|"PUT"|"DELETE"; auth: boolean; body?: unknown; headers?: Record<string,string> } = { method, auth };
  if (body !== undefined) opts.body = body;
  if (headers) opts.headers = headers;
  return execute<T>(path, opts, true);
}

async function execute<T>(
  path: string,
  options: { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; auth: boolean; body?: unknown; headers?: Record<string, string> },
  allowRefresh: boolean,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.headers) {
    Object.assign(headers, options.headers);
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.auth && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  if (options.method !== 'GET') {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) {
      headers[CSRF_HEADER] = csrf;
    }
  }

  const init: RequestInit = {
    method: options.method,
    headers,
    credentials: 'include',
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${apiConfig.baseUrl}${path}`, init);

  if (response.status === 401 && options.auth && allowRefresh) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return execute<T>(path, options, false);
    }
    notifyUnauthenticated();
  }

  if (!response.ok) {
    throw await parseError(response, path);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  return (text.length === 0 ? undefined : JSON.parse(text)) as T;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Rota el refresh token. Un unico refresh concurrente: si varias peticiones reciben
 * 401 a la vez, todas esperan al mismo intento en lugar de rotar N veces (lo que el
 * backend interpretaria como reutilizacion y revocaria la familia).
 */
export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function performRefresh(): Promise<boolean> {
  const csrf = readCookie(CSRF_COOKIE);
  const response = await fetch(`${apiConfig.baseUrl}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: csrf ? { [CSRF_HEADER]: csrf } : {},
  });
  if (!response.ok) {
    return false;
  }
  const data = (await response.json()) as { accessToken: string };
  tokenStore.set(data.accessToken);
  return true;
}

export interface HealthStatus {
  status: string;
}

/** Consulta tecnica de la Fundacion (`/actuator/health`), sin sesion. */
export async function getHealth(): Promise<HealthStatus> {
  const response = await fetch(`${apiConfig.baseUrl}/actuator/health`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new ApiError(response.status, null, `GET /actuator/health devolvio ${response.status}`);
  }
  return (await response.json()) as HealthStatus;
}