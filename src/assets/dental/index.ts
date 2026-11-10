import permanentIncisor from './permanent-incisor.svg?raw';
import permanentCanine from './permanent-canine.svg?raw';
import permanentPremolar from './permanent-premolar.svg?raw';
import permanentMolar from './permanent-molar.svg?raw';
import temporaryIncisor from './temporary-incisor.svg?raw';
import temporaryCanine from './temporary-canine.svg?raw';
import temporaryMolar from './temporary-molar.svg?raw';

/**
 * UX-05L/05M: anatomical, softly shaded crown resources. Each SVG separates the crown geometry
 * (`data-layer="geometry"` + `data-outline="crown"`) from its lighting (`data-layer="volume"`)
 * and grooves (`data-layer="detail"`). DentalArcades uses this inventory inline, with unique
 * per-instance IDs and clinical colour/glyphs applied by its existing renderer, not the asset.
 */
export type DentalFamily = 'incisor' | 'canine' | 'premolar' | 'molar';
export type DentalDentition = 'PERMANENT' | 'TEMPORARY';

export interface DentalSilhouette {
  readonly id: string;
  readonly family: DentalFamily;
  readonly dentition: DentalDentition;
  readonly label: string;
  readonly viewBox: '0 0 44 44';
  readonly markup: string;
}

export const DENTAL_SILHOUETTES: readonly DentalSilhouette[] = [
  {
    id: 'permanent-incisor',
    family: 'incisor',
    dentition: 'PERMANENT',
    label: 'Incisivo permanente',
    viewBox: '0 0 44 44',
    markup: permanentIncisor,
  },
  {
    id: 'permanent-canine',
    family: 'canine',
    dentition: 'PERMANENT',
    label: 'Canino permanente',
    viewBox: '0 0 44 44',
    markup: permanentCanine,
  },
  {
    id: 'permanent-premolar',
    family: 'premolar',
    dentition: 'PERMANENT',
    label: 'Premolar permanente',
    viewBox: '0 0 44 44',
    markup: permanentPremolar,
  },
  {
    id: 'permanent-molar',
    family: 'molar',
    dentition: 'PERMANENT',
    label: 'Molar permanente',
    viewBox: '0 0 44 44',
    markup: permanentMolar,
  },
  {
    id: 'temporary-incisor',
    family: 'incisor',
    dentition: 'TEMPORARY',
    label: 'Incisivo temporal',
    viewBox: '0 0 44 44',
    markup: temporaryIncisor,
  },
  {
    id: 'temporary-canine',
    family: 'canine',
    dentition: 'TEMPORARY',
    label: 'Canino temporal',
    viewBox: '0 0 44 44',
    markup: temporaryCanine,
  },
  {
    id: 'temporary-molar',
    family: 'molar',
    dentition: 'TEMPORARY',
    label: 'Molar temporal',
    viewBox: '0 0 44 44',
    markup: temporaryMolar,
  },
];
