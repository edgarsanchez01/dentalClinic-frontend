import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Dentition, ToothCondition } from '../../api/odontogram';
import { DENTAL_SILHOUETTES, type DentalFamily } from '../../assets/dental';
import { inlineDentalMarkup } from '../../assets/dental/inlineDentalMarkup';
import type { ChartTooth } from './dentalChartModel';
import { archLayout, conditionChipClass, conditionLabel, dentitionLabel, quadrantLabelOf } from './odontogramUi';
import './dental-arcades.css';

/** Conservative crowns, not anatomical scans, diagnoses or surface-location maps. */
function familyOf(fdi: number): DentalFamily {
  const position = fdi % 10;
  const temporary = Math.floor(fdi / 10) >= 5;
  return position <= 2 ? 'incisor' : position === 3 ? 'canine' : !temporary && position <= 5 ? 'premolar' : 'molar';
}

const conditionSymbols: Partial<Record<ToothCondition, string>> = {
  FRACTURED: 'M28 12 L21 18 L28 22 L20 30',
  RESTORED: 'M19 16 H29 V27 H19 Z',
  ROOT_CANAL: 'M21 14 V30 M27 14 V30',
  CROWN: 'M16 18 L19 11 L24 16 L29 11 L32 18',
  IMPLANT: 'M24 13 V30 M19 18 H29 M19 23 H29 M19 28 H29',
  MISSING: 'M14 31 L34 9',
  EXTRACTED: 'M14 10 L34 31 M34 10 L14 31',
  SEALED: 'M17 19 H31 M17 24 H31',
  OTHER: 'M24 17 A6 6 0 1 0 24 29 A6 6 0 1 0 24 17',
};

export function ToothSilhouette({ fdi, condition }: { fdi: number; condition?: ToothCondition | null | undefined }) {
  const instanceId = useId();
  const temporary = Math.floor(fdi / 10) >= 5;
  const family = familyOf(fdi);
  const dentition = temporary ? 'TEMPORARY' : 'PERMANENT';
  const resource = DENTAL_SILHOUETTES.find(item => item.family === family && item.dentition === dentition)!;
  const markup = useMemo(() => inlineDentalMarkup(resource, instanceId), [resource, instanceId]);
  const upper = isUpperArch(fdi);
  const mark = condition ? conditionSymbols[condition] : undefined;
  return <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" focusable="false"
    className={`dc-tooth-symbol ${condition ? conditionChipClass(condition) : 'dc-tooth-unrecorded'}`}
    data-family={family} data-dentition={dentition} data-condition={condition ?? 'UNREGISTERED'} data-resource={resource.id}>
    {/* Trusted local SVG only. Clinical glyphs remain outside the rotated anatomical layer. */}
    <g data-anatomy="ux05m" transform={`${upper ? 'rotate(180 22 22) ' : ''}translate(22 22) scale(1.12) translate(-22 -22)`}
      dangerouslySetInnerHTML={{ __html: markup }} />
    {condition === 'CARIES'
      ? <circle className="dc-condition-mark dc-condition-dot" vectorEffect="non-scaling-stroke" cx="22" cy="24" r="5.5" />
      : mark ? <g transform="translate(-2 2)"><path className="dc-condition-mark" vectorEffect="non-scaling-stroke" d={mark} /></g> : null}
  </svg>;
}

// UX-05J: two compact arches. Sixteen 44×44 targets per permanent arch (704 px), with the
// FDI outside the crown. Ten temporary pieces keep the same 704 px frame and a wider pitch.
const MAP_WIDTH = 704;
const MAP_HEIGHT = 238;
const PERMANENT_PITCH = 44;
const TEMPORARY_PITCH = 56;

function curveY(index: number, count: number, base: number, amplitude: number) {
  const distance = Math.abs(index - (count - 1) / 2) / ((count - 1) / 2);
  return base + amplitude * (1 - distance * distance);
}

function archCoordinates(fdis: number[], pitch: number, upper: boolean): ReadonlyArray<readonly [number, number, number]> {
  const startX = (MAP_WIDTH - pitch * (fdis.length - 1)) / 2;
  const amplitude = fdis.length > 10 ? 14 : 12;
  const base = upper ? (fdis.length > 10 ? 52 : 54) : (fdis.length > 10 ? 174 : 172);
  return fdis.map((fdi, index) => [fdi, startX + pitch * index,
    curveY(index, fdis.length, base, upper ? amplitude : -amplitude)]);
}

const permanentLayout = archLayout('PERMANENT');
const permanentCoordinates = [
  ...archCoordinates(permanentLayout.upper.flatMap(row => row.teeth), PERMANENT_PITCH, true),
  ...archCoordinates(permanentLayout.lower.flatMap(row => row.teeth), PERMANENT_PITCH, false),
];
const temporaryLayout = archLayout('TEMPORARY');
const temporaryCoordinates = [
  ...archCoordinates(temporaryLayout.upper.flatMap(row => row.teeth), TEMPORARY_PITCH, true),
  ...archCoordinates(temporaryLayout.lower.flatMap(row => row.teeth), TEMPORARY_PITCH, false),
];

function isUpperArch(fdi: number) {
  const quadrant = Math.floor(fdi / 10);
  return quadrant === 1 || quadrant === 2 || quadrant === 5 || quadrant === 6;
}

/** Subtle splay so posterior pieces follow the arch; the interactive box stays axis-aligned. */
function leanOf(fdi: number, x: number) {
  const position = fdi % 10;
  const temporary = Math.floor(fdi / 10) >= 5;
  const degree = temporary
    ? ({ 5: 3, 4: 2, 3: 1 } as Record<number, number>)[position] ?? 0
    : ({ 8: 5, 7: 4, 6: 3, 5: 2, 4: 1 } as Record<number, number>)[position] ?? 0;
  const side = x < MAP_WIDTH / 2 ? -1 : 1;
  return (isUpperArch(fdi) ? side : -side) * degree;
}

/** One set of native tooth buttons for all roles, widths and current/historical presentations. */
export function DentalArcades({ dentition, teeth, selectedFdi, onSelect, historical = false }: {
  dentition: Dentition; teeth: ChartTooth[]; selectedFdi?: number | null; onSelect: (fdi: number) => void; historical?: boolean;
}) {
  const id = useId();
  const selectedButton = useRef<HTMLButtonElement>(null);
  const layout = archLayout(dentition);
  const quadrants = [...layout.upper, ...layout.lower];
  const byFdi = new Map(teeth.map(tooth => [tooth.fdi, tooth]));
  const coordinateByFdi = new Map((dentition === 'TEMPORARY' ? temporaryCoordinates : permanentCoordinates).map(([fdi, x, y]) => [fdi, { x, y }]));
  const positions = [...layout.upper.flatMap(row => row.teeth), ...layout.lower.flatMap(row => row.teeth)].map(fdi => {
    const coordinate = coordinateByFdi.get(fdi);
    if (!coordinate) throw new Error(`Sin coordenada dental para la pieza ${fdi}.`);
    return { fdi, ...coordinate };
  });
  function toothLabel(fdi: number) {
    const tooth = byFdi.get(fdi);
    return `Pieza ${fdi} ${quadrantLabelOf(fdi)} ${dentitionLabel(dentition)}: ${tooth?.condition ? `condición ${conditionLabel(tooth.condition)}${tooth.condition === 'HEALTHY' ? ' confirmado' : ''}` : tooth?.conditionText ?? (historical ? 'No reconstruible' : 'sin registro')}`;
  }
  const selectedQuadrant = selectedFdi === null || selectedFdi === undefined ? undefined : quadrants.findIndex(q => q.teeth.includes(selectedFdi));
  const [chosenQuadrant, setChosenQuadrant] = useState<{ dentition: Dentition; index: number } | null>(null);
  const shownQuadrant = chosenQuadrant?.dentition === dentition ? chosenQuadrant.index : selectedQuadrant !== undefined && selectedQuadrant >= 0 ? selectedQuadrant : 0;
  // Anchor selection to the rendered crown (including scale, rotation and mobile placement),
  // not to the button/viewBox centre. Neither the tooth nor its FDI needs to move.
  useLayoutEffect(() => {
    const button = selectedButton.current;
    const crown = button?.querySelector<SVGGraphicsElement>('.dc-crown-outline');
    const symbol = button?.querySelector('svg');
    if (!button || !crown || !symbol) return;
    function measure() {
      const bounds = crown!.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const target = button!.getBoundingClientRect();
      const label = button!.querySelector('.dc-fdi')!.getBoundingClientRect();
      button!.style.setProperty('--tooth-selection-x', `${bounds.x + bounds.width / 2 - target.x - button!.clientLeft}px`);
      button!.style.setProperty('--tooth-selection-y', `${bounds.y + bounds.height / 2 - target.y - button!.clientTop}px`);
      button!.style.setProperty('--tooth-selection-width', `${bounds.width}px`);
      button!.style.setProperty('--tooth-selection-height', `${bounds.height}px`);
      button!.style.setProperty('--tooth-selection-line-y', `${Math.max(bounds.bottom, label.bottom) + 2 - target.y - button!.clientTop}px`);
    }
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(button);
    observer.observe(symbol);
    return () => observer.disconnect();
  }, [selectedFdi, dentition, shownQuadrant]);
  return <div className="dc-dental-anatomy" data-dental-renderer="shared">
    <div className="dc-dental-orientation"><span>Derecha del paciente</span><span>Izquierda del paciente</span></div>
    <div className="dc-quadrant-controls">
      <label htmlFor={`${id}-quadrant`}>Cuadrante</label><select id={`${id}-quadrant`} value={shownQuadrant} onChange={event => setChosenQuadrant({ dentition, index: Number(event.target.value) })}>
        {quadrants.map((q, index) => <option value={index} key={q.quadrantLabel}>{q.quadrantLabel}</option>)}
      </select>
      <p>Cuadrante: {quadrants[shownQuadrant].quadrantLabel} · {dentitionLabel(dentition)}</p>
    </div>
      <div className="dc-full-arcades" role="group" aria-label="Arcadas dentales">
        <span className="dc-arch-name dc-arch-upper">Arcada superior</span><span className="dc-arch-name dc-arch-lower">Arcada inferior</span>
        {positions.map(({ fdi, x, y }) => <button key={fdi} ref={selectedFdi === fdi ? selectedButton : undefined} type="button" aria-label={toothLabel(fdi)} aria-pressed={selectedFdi === fdi} title={toothLabel(fdi)} className="dc-dental-piece" data-fdi={fdi} data-arch={isUpperArch(fdi) ? 'upper' : 'lower'} data-quadrant-active={quadrants[shownQuadrant].teeth.includes(fdi)} data-dental-knowledge={byFdi.get(fdi)?.condition ? 'recorded' : historical && byFdi.get(fdi)?.conditionText !== 'Sin registro previo' ? 'unknown' : 'unregistered'} style={{ left: `${x / MAP_WIDTH * 100}%`, top: `${y / MAP_HEIGHT * 100}%`, ['--tooth-lean' as string]: `${leanOf(fdi, x)}deg` } as CSSProperties} onClick={() => onSelect(fdi)}>
          <ToothSilhouette fdi={fdi} condition={byFdi.get(fdi)?.condition} /><span className="dc-fdi">{fdi}</span>
          {historical && !byFdi.get(fdi)?.condition && byFdi.get(fdi)?.conditionText !== 'Sin registro previo' ? <span className="dc-dental-unknown" aria-hidden="true">?</span> : null}
        </button>)}
      </div>
    {selectedFdi ? <p className="dc-selected-tooth" role="status">Pieza {selectedFdi} · {byFdi.get(selectedFdi)?.condition ? conditionLabel(byFdi.get(selectedFdi)!.condition!) : byFdi.get(selectedFdi)?.conditionText ?? (historical ? 'No reconstruible' : 'Sin registro')}</p> : null}
  </div>;
}
