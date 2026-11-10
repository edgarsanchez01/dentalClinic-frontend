/** Parámetros de navegación: solo formas cerradas, nunca fechas normalizadas silenciosamente. */
export function calendarDate(value: string | null): string | null {
  if (!value || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function routeId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function instantParameter(value: string | null): string | null {
  if (!value || !calendarDate(value.slice(0, 10))
      || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

/** Los destinos recordados no pueden sacar del SPA ni volver a una ruta de autenticación. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')
      || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return '/';
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || !/^\/(?:appointments(?:\/[1-9]\d*)?|collections(?:\/[1-9]\d*)?|patients(?:\/[1-9]\d*)?|finances(?:\/(?:new|reports|[1-9]\d*))?|users|clinic|scheduling|services|notifications|reviews|change-password|schedule)?$/.test(url.pathname)) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/'; }
}

export function localDayBoundary(value: string, afterDay = false): string {
  if (!calendarDate(value)) throw new RangeError('Fecha inválida.');
  const date = new Date(`${value}T00:00:00`);
  if (afterDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export function localDayOf(value: string, exclusiveEnd = false): string {
  const date = new Date(Date.parse(value) - (exclusiveEnd ? 1 : 0));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
