/** Aritmetica de vista previa/validacion exacta; los estados y saldos proceden siempre del GET. */
export const MAX_CENTS = 99999999999999999n;

export function normalizeMoney(value: string): string | null {
  const text = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [integer = '', decimal] = text.split('.');
  const whole = integer.replace(/^0+(?=\d)/, '');
  if (whole.length > 15) return null;
  return whole + (decimal === undefined ? '' : `.${decimal}`);
}

export function cents(value: string): bigint {
  // PostgreSQL devuelve escala tecnica 4: solo se quitan ceros, nunca se redondea.
  const text = value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const normalized = normalizeMoney(text);
  if (normalized === null) throw new Error('Importe financiero no valido.');
  const [whole = '0', fraction = ''] = normalized.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export function moneyFromCents(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

export function formatMoney(value: string): string {
  const amount = cents(value);
  return `$${new Intl.NumberFormat('es-MX').format(amount / 100n)}.${String(amount % 100n).padStart(2, '0')} MXN`;
}

/**
 * Importes que admiten signo (p. ej. el cobro neto o las reversas de un reporte, que pueden ser
 * negativos). `formatMoney` sigue siendo estricto y de solo magnitud para saldos y precios.
 */
export function formatSignedMoney(value: string): string {
  const text = value.trim();
  const negative = text.startsWith('-');
  const amount = cents(negative ? text.slice(1) : text);
  const formatted = `$${new Intl.NumberFormat('es-MX').format(amount / 100n)}.${String(amount % 100n).padStart(2, '0')} MXN`;
  return negative ? `-${formatted}` : formatted;
}

export function positiveId(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
