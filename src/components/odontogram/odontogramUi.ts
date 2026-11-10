import type { Dentition, ToothCondition, ToothRecordDto, ToothSurface, HistorySource, OdontogramEventDto } from '../../api/odontogram';

/**
 * Anatomia y etiquetas del odontograma, en un modulo sin componentes (§13.3).
 *
 * Convencion FDI (ISO 3950), vista desde la perspectiva frontal del profesional: la
 * derecha del paciente queda a la izquierda del espectador en ambas arcadas, con las
 * piezas frontales (11, 21, 31, 41, ...) al centro.
 *  - Cuadrantes permanentes: 1 superior derecho, 2 superior izquierdo, 3 inferior
 *    izquierdo y 4 inferior derecho.
 *  - Cuadrantes temporales: 5 superior derecho, 6 superior izquierdo, 7 inferior
 *    izquierdo y 8 inferior derecho.
 *  - Disposicion (izquierda a derecha del espectador): maxilar `[18..11] | [21..28]`,
 *    mandibular `[48..41] | [31..38]`; temporal `[55..51] | [61..65]` y
 *    `[85..81] | [71..75]`.
 *
 * CORRECCION FDI (2026-10-14): una version anterior tomaba como «estandar FDI» la notacion
 * invertida (cuadrante 3 = inferior derecho, 4 = inferior izquierdo), lo que espejaba la
 * arcada mandibular y rotulaba mal los cuadrantes 3/4/7/8. Design System §14.2 y la norma
 * FDI/ISO 3950 son correctos: 3/7 = inferior izquierdo, 4/8 = inferior derecho. Este
 * modulo solo deriva geometria y texto; las condiciones viajan SOLO desde el backend.
 */
export type OdontogramView = 'chart' | 'list';

/** Validez FDI: cuadrantes 1-4 con posicion 1-8; cuadrantes 5-8 con posicion 1-5 (ToothNotation). */
export function isValidFdi(toothFdi: number): boolean {
  const quadrant = Math.floor(toothFdi / 10);
  const position = toothFdi % 10;
  if (quadrant >= 1 && quadrant <= 4) return position >= 1 && position <= 8;
  if (quadrant >= 5 && quadrant <= 8) return position >= 1 && position <= 5;
  return false;
}

/** Denticion derivada del cuadrante FDI (1-4 permanente, 5-8 temporal). */
export function dentitionOf(toothFdi: number): Dentition {
  if (!isValidFdi(toothFdi)) {
    throw new Error(`La pieza dental ${toothFdi} no es una notación FDI válida.`);
  }
  return Math.floor(toothFdi / 10) <= 4 ? 'PERMANENT' : 'TEMPORARY';
}

const ANTERIOR: ToothSurface[] = ['MESIAL', 'DISTAL', 'VESTIBULAR', 'LINGUAL', 'INCISAL'];
const POSTERIOR: ToothSurface[] = ['MESIAL', 'DISTAL', 'VESTIBULAR', 'LINGUAL', 'OCCLUSAL'];

/**
 * Superficies validas por grupo de pieza (espejo del dominio backend): posicion FDI 1-3
 * anteriores con INCISAL; 4-8 posteriores con OCCLUSAL.
 */
export function allowedSurfacesFor(toothFdi: number): ToothSurface[] {
  if (!isValidFdi(toothFdi)) {
    throw new Error(`La pieza dental ${toothFdi} no es una notación FDI válida.`);
  }
  return toothFdi % 10 <= 3 ? ANTERIOR : POSTERIOR;
}

/** Cierre oclusal/incisal: unica superficie en banda superior del detalle. */
export function closingSurfaceFor(toothFdi: number): ToothSurface {
  return toothFdi % 10 <= 3 ? 'INCISAL' : 'OCCLUSAL';
}

export interface ArchRow {
  /** Etiqueta del cuadrante (14.2: «Superior derecho», etc.). */
  quadrantLabel: string;
  /** Piezas del cuadrante en orden visual, del fondo hacia el centro. */
  teeth: number[];
}

/** Filas de piezas de una denticion: dos cuadrantes por arcada. */
export function archLayout(dentition: Dentition): { upper: ArchRow[]; lower: ArchRow[] } {
  if (dentition === 'TEMPORARY') {
    return {
      upper: [
        { quadrantLabel: 'Superior derecho', teeth: [55, 54, 53, 52, 51] },
        { quadrantLabel: 'Superior izquierdo', teeth: [61, 62, 63, 64, 65] },
      ],
      lower: [
        { quadrantLabel: 'Inferior derecho', teeth: [85, 84, 83, 82, 81] },
        { quadrantLabel: 'Inferior izquierdo', teeth: [71, 72, 73, 74, 75] },
      ],
    };
  }
  return {
    upper: [
      { quadrantLabel: 'Superior derecho', teeth: [18, 17, 16, 15, 14, 13, 12, 11] },
      { quadrantLabel: 'Superior izquierdo', teeth: [21, 22, 23, 24, 25, 26, 27, 28] },
    ],
    lower: [
      { quadrantLabel: 'Inferior derecho', teeth: [48, 47, 46, 45, 44, 43, 42, 41] },
      { quadrantLabel: 'Inferior izquierdo', teeth: [31, 32, 33, 34, 35, 36, 37, 38] },
    ],
  };
}

/** Orden canonico de condiciones para leyenda y listados. */
export const CONDITION_ORDER: ToothCondition[] = [
  'HEALTHY',
  'CARIES',
  'FRACTURED',
  'RESTORED',
  'ROOT_CANAL',
  'CROWN',
  'IMPLANT',
  'MISSING',
  'EXTRACTED',
  'SEALED',
  'OTHER',
];

const CONDITION_LABELS: Record<ToothCondition, string> = {
  HEALTHY: 'Sano',
  CARIES: 'Caries',
  FRACTURED: 'Fractura',
  RESTORED: 'Restauración',
  ROOT_CANAL: 'Endodoncia',
  CROWN: 'Corona',
  IMPLANT: 'Implante',
  MISSING: 'Ausente',
  EXTRACTED: 'Extraída',
  SEALED: 'Sellado',
  OTHER: 'Otra',
};

export function conditionLabel(condition: ToothCondition): string {
  return CONDITION_LABELS[condition];
}

const SURFACE_LABELS: Record<ToothSurface, string> = {
  MESIAL: 'Mesial',
  DISTAL: 'Distal',
  VESTIBULAR: 'Vestibular',
  LINGUAL: 'Lingual',
  OCCLUSAL: 'Oclusal',
  INCISAL: 'Incisal',
};

export function surfaceLabel(surface: ToothSurface): string {
  return SURFACE_LABELS[surface];
}

export function dentitionLabel(dentition: Dentition): string {
  return dentition === 'PERMANENT' ? 'Permanente' : 'Temporal';
}

/** Cuadrante de una pieza valida como etiqueta de ubicacion («Superior derecho»). */
export function quadrantLabelOf(toothFdi: number): string {
  if (!isValidFdi(toothFdi)) {
    throw new Error(`La pieza dental ${toothFdi} no es una notación FDI válida.`);
  }
  const quadrant = Math.floor(toothFdi / 10);
  // Superior: cuadrantes 1-2 y 5-6; Inferior: 3-4 y 7-8 (FDI).
  // Derecho: cuadrantes 1, 4, 5 y 8; izquierdo: 2, 3, 6 y 7.
  const arch = (quadrant - 1) % 4 >= 2 ? 'Inferior' : 'Superior';
  const side = quadrant % 4 === 1 || quadrant % 4 === 0 ? 'derecho' : 'izquierdo';
  return `${arch} ${side}`;
}

/** Condición anterior legible: `null`/`undefined` significan «Sin registro», no un vacío. */
export function previousConditionLabel(condition: ToothCondition | null | undefined): string {
  return condition ? conditionLabel(condition) : 'Sin registro';
}

/** Tipo de evento del historial (RF-OD-04): sin condición anterior es el registro inicial. */
export function historyEventTypeLabel(previous: ToothCondition | null | undefined): string {
  return previous ? 'Actualización' : 'Registro inicial';
}

export type ToothHistoryEvent = OdontogramEventDto & { key: string };
export const HISTORY_SOURCE_RANK: Record<HistorySource, number> = {
  CONDITION_TOOTH: 1, NOTES_TOOTH: 2, TREATMENT_LINK: 3, CONDITION_SURFACE: 4, NOTES_SURFACE: 5,
};

/** Date is used only for the whole-second epoch; the entire fraction survives in bigint. */
export function instantNanoseconds(instant: string): bigint {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(instant);
  if (!match) throw new Error('El instante necesita fecha, hora y zona explícita.');
  const milliseconds = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(milliseconds)) throw new Error('El instante no es válido.');
  return BigInt(milliseconds) * 1_000_000n + BigInt((match[2] ?? '').padEnd(9, '0'));
}

/** Global orderKey DESC, including events from different tables with the same ID/time. */
export function orderedHistoryEvents(events: readonly OdontogramEventDto[]): ToothHistoryEvent[] {
  return events.map((event) => ({ ...event, key: `${event.source}-${event.id}` })).sort((a, b) => {
    const timeA = instantNanoseconds(a.changedAt), timeB = instantNanoseconds(b.changedAt);
    if (timeA !== timeB) return timeA > timeB ? -1 : 1;
    const rank = HISTORY_SOURCE_RANK[b.source] - HISTORY_SOURCE_RANK[a.source];
    if (rank !== 0) return rank;
    return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;
  });
}

/** Explicit UTC picker: never interpret a clinical query in the browser's implicit zone. */
export function utcInputInstant(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/.test(value))
    throw new Error('Selecciona una fecha y hora para consultar.');
  const result = `${value.length === 16 ? `${value}:00` : value}Z`;
  instantNanoseconds(result);
  return result;
}

export function historyTimestamp(instant: string, timeZone = 'UTC'): string {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(instant)?.[1];
  const formatted = new Date(instant).toLocaleString('es-ES', { timeZone, dateStyle: 'medium', timeStyle: 'medium' });
  return `${formatted}${fraction ? ` · .${fraction}` : ''} (${timeZone})`;
}

/**
 * Combina el historial de la pieza y el de sus superficies en una sola cronología,
 * Adaptador de compatibilidad: solo condiciones embebidas, nunca inventa notas ni vínculos.
 * La fuente completa E2 se obtiene de /history. Ambos adaptadores usan el orden global real.
 */
export function toothHistoryEvents(record: ToothRecordDto | undefined): ToothHistoryEvent[] {
  if (!record) return [];
  const events: OdontogramEventDto[] = [
    ...record.history.map((entry) => ({
      id: entry.id,
      toothFdi: record.toothFdi,
      source: 'CONDITION_TOOTH' as const,
      kind: 'CONDITION' as const,
      surface: null,
      previousCondition: entry.previousCondition ?? null,
      newCondition: entry.newCondition,
      previousNotes: null, newNotes: null, treatmentId: null, changeKind: null, occurrence: null,
      actorUserId: entry.actorUserId,
      actorName: entry.actorName,
      changedAt: entry.changedAt,
    })),
    ...record.surfaces.flatMap((surface) =>
      surface.history.map((entry) => ({
        id: entry.id,
        toothFdi: record.toothFdi,
        source: 'CONDITION_SURFACE' as const,
        kind: 'CONDITION' as const,
        surface: surface.surface,
        previousCondition: entry.previousCondition ?? null,
        newCondition: entry.newCondition,
        previousNotes: null, newNotes: null, treatmentId: null, changeKind: null, occurrence: null,
        actorUserId: entry.actorUserId,
        actorName: entry.actorName,
        changedAt: entry.changedAt,
      })),
    ),
  ];
  return orderedHistoryEvents(events);
}

/** §13.3: motivo Y texto, nunca solo color (el chip siempre lleva etiqueta). */
export function conditionChipClass(condition: ToothCondition): string {
  switch (condition) {
    case 'HEALTHY':
      return 'bg-condition-healthy text-condition-healthy-ink';
    case 'CARIES':
      return 'bg-condition-caries text-condition-caries-ink';
    case 'FRACTURED':
      return 'bg-condition-fractured text-condition-fractured-ink';
    case 'RESTORED':
      return 'bg-condition-restored text-condition-restored-ink';
    case 'ROOT_CANAL':
      return 'bg-condition-root-canal text-condition-root-canal-ink';
    case 'CROWN':
      return 'bg-condition-crown text-condition-crown-ink';
    case 'IMPLANT':
      return 'bg-condition-implant text-condition-implant-ink';
    case 'MISSING':
      return 'bg-condition-missing text-condition-missing-ink';
    case 'EXTRACTED':
      return 'bg-condition-extracted text-condition-extracted-ink';
    case 'SEALED':
      return 'bg-condition-sealed text-condition-sealed-ink';
    case 'OTHER':
      return 'bg-condition-other text-condition-other-ink';
  }
}
