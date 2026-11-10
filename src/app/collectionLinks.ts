import { safeReturnTo } from './deepLinks';

/** Only the collection queue, never a write route or an external destination. */
export function collectionReturn(value: unknown): string | null {
  const target = safeReturnTo(value);
  return target === '/collections' || target.startsWith('/collections?') ? target : null;
}
