/**
 * Utilidades de agrupacion para entradas clinicas append-only (Fase 1B.2).
 *
 * Una cadena se compone de una raiz (`correctsRecordId` ausente) y cero o mas correcciones que
 * apuntan a esa raiz. El backend resuelve toda correccion a su raiz, por lo que `correctsRecordId`
 * siempre referencia el id de la raiz de la cadena.
 */
export interface ChainEntry {
  id: number;
  correctsRecordId?: number;
  correctionReason?: string;
  createdAt: string;
}

/**
 * Agrupa una lista plana de entradas (raices + correcciones) en cadenas. Las correcciones se
 * reordenan por (createdAt, id) para que la version vigente sea determinista.
 */
export function groupChains<T extends ChainEntry>(entries: T[]): Array<{ root: T; corrections: T[] }> {
  const byPosition = (a: T, b: T) => (a.createdAt === b.createdAt ? a.id - b.id : a.createdAt < b.createdAt ? -1 : 1);
  const roots = entries.filter((entry) => entry.correctsRecordId === undefined);
  const correctionsByRoot = new Map<number, T[]>();
  for (const entry of entries) {
    if (entry.correctsRecordId !== undefined) {
      correctionsByRoot.set(entry.correctsRecordId, [...(correctionsByRoot.get(entry.correctsRecordId) ?? []), entry]);
    }
  }
  return roots.map((root) => ({ root, corrections: (correctionsByRoot.get(root.id) ?? []).slice().sort(byPosition) }));
}

/** Resuelve la version vigente de una cadena: ultima correccion o la raiz si no hay correcciones. */
export function currentEntry<T extends ChainEntry>(root: T, corrections: T[]): T {
  return corrections.length > 0 ? corrections[corrections.length - 1] : root;
}
