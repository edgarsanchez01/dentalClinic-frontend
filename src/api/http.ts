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
  code?: string;
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
let sessionRequests = new AbortController();

/** Invalida tambien respuestas tardias de transportes que ignoran abort. */
export function cancelSessionRequests(): void {
  sessionRequests.abort();
  sessionRequests = new AbortController();
  refreshInFlight = null;
}

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
  /** Optativo para recuperacion financiera: sin cache HTTP ni reenvio de POST tras refresh. */
  cache?: RequestCache;
  retryAfterRefresh?: boolean;
  /** Límite de transporte optativo; abortar nunca demuestra rollback del servidor. */
  signal?: AbortSignal;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Si es `false`, no adjunta el access token ni intenta refresh (endpoints publicos). */
  auth?: boolean;
  headers?: Record<string, string>;
  /** Adaptadores optativos para valores decimales exactos; no alteran autenticación ni reintentos. */
  parseResponse?: (text: string) => unknown;
  serializeBody?: (body: unknown) => string;
}

export async function apiFetch<T>(
  path: string,
  { method = 'GET', body, auth = true, headers, parseResponse, serializeBody, signal, cache, retryAfterRefresh }: RequestOptions = {},
): Promise<T> {
  const opts: RequestOptions & { method: NonNullable<RequestOptions['method']>; auth: boolean } = { method, auth };
  if (body !== undefined) opts.body = body;
  if (headers) opts.headers = headers;
  if (parseResponse) opts.parseResponse = parseResponse;
  if (serializeBody) opts.serializeBody = serializeBody;
  if (cache !== undefined) opts.cache = cache;
  if (retryAfterRefresh !== undefined) opts.retryAfterRefresh = retryAfterRefresh;
  return execute<T>(path, opts, true, signal ? AbortSignal.any([sessionRequests.signal, signal]) : sessionRequests.signal);
}

async function execute<T>(
  path: string,
  options: RequestOptions & { method: NonNullable<RequestOptions['method']>; auth: boolean },
  allowRefresh: boolean,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
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
    signal,
    method: options.method,
    headers,
    credentials: 'include',
  };
  if (options.cache !== undefined) init.cache = options.cache;
  if (options.body !== undefined) {
    init.body = options.serializeBody ? options.serializeBody(options.body) : JSON.stringify(options.body);
  }

  const response = await fetch(`${apiConfig.baseUrl}${path}`, init);
  signal.throwIfAborted();

  if (response.status === 401 && options.auth) {
    if (allowRefresh) {
      let refreshed = false;
      try {
        refreshed = await refreshSession();
      } catch {
        // Un fallo de renovacion invalida la sesion, no deja su cache visible.
      }
      signal.throwIfAborted();
      if (refreshed) {
        if (options.retryAfterRefresh !== false) return execute<T>(path, options, false, signal);
        throw await parseError(response, path); // El usuario consulta/reanuda; nunca reenviar el POST financiero.
      }
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
  signal.throwIfAborted();
  return (text.length === 0 ? undefined : options.parseResponse ? options.parseResponse(text) : JSON.parse(text)) as T;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Rota el refresh token. Un unico refresh concurrente: si varias peticiones reciben
 * 401 a la vez, todas esperan al mismo intento en lugar de rotar N veces (lo que el
 * backend interpretaria como reutilizacion y revocaria la familia).
 */
export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    const pending = performRefresh(sessionRequests.signal).finally(() => {
      if (refreshInFlight === pending) refreshInFlight = null;
    });
    refreshInFlight = pending;
  }
  return refreshInFlight;
}

async function performRefresh(signal: AbortSignal): Promise<boolean> {
  const csrf = readCookie(CSRF_COOKIE);
  const response = await fetch(`${apiConfig.baseUrl}/api/auth/refresh`, {
    signal,
    method: 'POST',
    credentials: 'include',
    headers: csrf ? { [CSRF_HEADER]: csrf } : {},
  });
  signal.throwIfAborted();
  if (!response.ok) {
    if (response.status !== 401 && response.status !== 403) throw await parseError(response, '/api/auth/refresh');
    return false;
  }
  const data = (await response.json()) as { accessToken: string };
  signal.throwIfAborted();
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
