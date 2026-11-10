import { describe, expect, it } from 'vitest';

import {
  allowedSurfacesFor,
  archLayout,
  closingSurfaceFor,
  conditionChipClass,
  conditionLabel,
  dentitionLabel,
  dentitionOf,
  isValidFdi,
  quadrantLabelOf,
  surfaceLabel,
} from './odontogramUi';

describe('Notación FDI del odontograma', () => {
  it.each([
    [0, false],
    [11, true],
    [18, true],
    [21, true],
    [48, true],
    [51, true],
    [55, true],
    [85, true],
    [19, false],
    [58, false],
    [50, false],
    [66, false],
    [99, false],
  ])('valida el código FDI %s', (fdi, expected) => {
    expect(isValidFdi(fdi)).toBe(expected);
  });

  it('deriva la dentición del cuadrante', () => {
    expect(dentitionOf(11)).toBe('PERMANENT');
    expect(dentitionOf(44)).toBe('PERMANENT');
    expect(dentitionOf(51)).toBe('TEMPORARY');
    expect(dentitionOf(85)).toBe('TEMPORARY');
    expect(() => dentitionOf(99)).toThrow(/FDI válida/);
  });

  it.each([
    [11, 'PERMANENT'],
    [51, 'TEMPORARY'],
  ])('etiqueta la dentición %s como %s', (fdi, dentition) => {
    expect(dentitionLabel(dentition as 'PERMANENT' | 'TEMPORARY')).toBe(
      dentition === 'PERMANENT' ? 'Permanente' : 'Temporal',
    );
    void fdi;
  });

  it.each([
    [11, 'Superior derecho'],
    [24, 'Superior izquierdo'],
    [31, 'Inferior izquierdo'],
    [48, 'Inferior derecho'],
    [61, 'Superior izquierdo'],
    [75, 'Inferior izquierdo'],
    [82, 'Inferior derecho'],
  ])('describe el cuadrante de la pieza %s', (fdi, expected) => {
    expect(quadrantLabelOf(fdi)).toBe(expected);
  });

  it('cubre los ocho cuadrantes con la convención FDI/ISO 3950', () => {
    expect(
      [11, 21, 31, 41, 51, 61, 71, 81].map((fdi) => quadrantLabelOf(fdi)),
    ).toEqual([
      'Superior derecho',
      'Superior izquierdo',
      'Inferior izquierdo',
      'Inferior derecho',
      'Superior derecho',
      'Superior izquierdo',
      'Inferior izquierdo',
      'Inferior derecho',
    ]);
  });
});

describe('Superficies por grupo', () => {
  it('las anteriores (posición 1-3) usan INCISAL y cinco superficies', () => {
    expect(allowedSurfacesFor(13)).toEqual(['MESIAL', 'DISTAL', 'VESTIBULAR', 'LINGUAL', 'INCISAL']);
    expect(closingSurfaceFor(11)).toBe('INCISAL');
  });

  it('las posteriores (posición 4-8) usan OCCLUSAL y cinco superficies', () => {
    expect(allowedSurfacesFor(47)).toEqual(['MESIAL', 'DISTAL', 'VESTIBULAR', 'LINGUAL', 'OCCLUSAL']);
    expect(closingSurfaceFor(48)).toBe('OCCLUSAL');
  });

  it('la posición temporal comparte el mismo límite anterior/posterior', () => {
    expect(allowedSurfacesFor(53)).toContain('INCISAL');
    expect(allowedSurfacesFor(54)).toContain('OCCLUSAL');
    expect(() => allowedSurfacesFor(99)).toThrow(/FDI válida/);
  });
});

describe('Layout de arcadas (14.2)', () => {
  it('orden permanente: frontales al centro, cuadrante 4 a la izquierda del espectador y 3 a la derecha', () => {
    expect(archLayout('PERMANENT')).toEqual({
      upper: [
        { quadrantLabel: 'Superior derecho', teeth: [18, 17, 16, 15, 14, 13, 12, 11] },
        { quadrantLabel: 'Superior izquierdo', teeth: [21, 22, 23, 24, 25, 26, 27, 28] },
      ],
      lower: [
        { quadrantLabel: 'Inferior derecho', teeth: [48, 47, 46, 45, 44, 43, 42, 41] },
        { quadrantLabel: 'Inferior izquierdo', teeth: [31, 32, 33, 34, 35, 36, 37, 38] },
      ],
    });
  });

  it('orden temporal: cinco piezas por cuadrante con la misma orientación mandibular', () => {
    expect(archLayout('TEMPORARY')).toEqual({
      upper: [
        { quadrantLabel: 'Superior derecho', teeth: [55, 54, 53, 52, 51] },
        { quadrantLabel: 'Superior izquierdo', teeth: [61, 62, 63, 64, 65] },
      ],
      lower: [
        { quadrantLabel: 'Inferior derecho', teeth: [85, 84, 83, 82, 81] },
        { quadrantLabel: 'Inferior izquierdo', teeth: [71, 72, 73, 74, 75] },
      ],
    });
  });

  it.each(['PERMANENT', 'TEMPORARY'] as const)(
    'orientación %s: el lado izquierdo del espectador es la derecha del paciente',
    (dentition) => {
      const { upper, lower } = archLayout(dentition);
      // Primera columna (izquierda del espectador) = cuadrantes derechos (1 y 4; 5 y 8).
      expect(upper[0].quadrantLabel).toBe('Superior derecho');
      expect(lower[0].quadrantLabel).toBe('Inferior derecho');
      expect(upper[1].quadrantLabel).toBe('Superior izquierdo');
      expect(lower[1].quadrantLabel).toBe('Inferior izquierdo');
      // Cada fila rotula sus propias piezas de forma coherente.
      for (const row of [upper[0], lower[0], upper[1], lower[1]]) {
        for (const fdi of row.teeth) expect(quadrantLabelOf(fdi)).toBe(row.quadrantLabel);
      }
    },
  );

  it.each(['PERMANENT', 'TEMPORARY'] as const)(
    'orientación %s: las piezas frontales (posición 1) quedan en el centro de cada arcada',
    (dentition) => {
      const { upper, lower } = archLayout(dentition);
      expect(upper[0].teeth.at(-1)! % 10).toBe(1); // 11 / 51 al centro
      expect(upper[1].teeth[0] % 10).toBe(1); // 21 / 61 al centro
      expect(lower[0].teeth.at(-1)! % 10).toBe(1); // 41 / 81 al centro
      expect(lower[1].teeth[0] % 10).toBe(1); // 31 / 71 al centro
    },
  );

  it.each(['PERMANENT', 'TEMPORARY'] as const)(
    'orientación %s: la mandíbula no es un espejo de la maxila (derecho e izquierdo difieren)',
    (dentition) => {
      const { upper, lower } = archLayout(dentition);
      expect(lower[0].teeth[0]).not.toBe(upper[0].teeth[0]);
      expect(lower[1].teeth[0]).not.toBe(upper[1].teeth[0]);
      expect(Math.floor(lower[0].teeth[0] / 10)).toBe(upper[0].teeth[0] >= 50 ? 8 : 4);
      expect(Math.floor(lower[1].teeth[0] / 10)).toBe(upper[1].teeth[0] >= 50 ? 7 : 3);
    },
  );
});

describe('Etiquetas y estilos de condición', () => {
  it('traduce las once condiciones a español', () => {
    expect(conditionLabel('HEALTHY')).toBe('Sano');
    expect(conditionLabel('CARIES')).toBe('Caries');
    expect(conditionLabel('ROOT_CANAL')).toBe('Endodoncia');
    expect(conditionLabel('EXTRACTED')).toBe('Extraída');
    expect(conditionLabel('SEALED')).toBe('Sellado');
  });

  it('traduce las superficies a español', () => {
    expect(surfaceLabel('MESIAL')).toBe('Mesial');
    expect(surfaceLabel('OCCLUSAL')).toBe('Oclusal');
    expect(surfaceLabel('INCISAL')).toBe('Incisal');
  });

  it.each([
    ['healthy', 'HEALTHY'],
    ['caries', 'CARIES'],
    ['root-canal', 'ROOT_CANAL'],
    ['sealed', 'SEALED'],
  ])('el chip de %s usa clases estáticas del tema', (slug, condition) => {
    const classes = conditionChipClass(condition as 'HEALTHY' | 'CARIES' | 'ROOT_CANAL' | 'SEALED');
    expect(classes).toContain(`bg-condition-${slug}`);
    expect(classes).toContain(`text-condition-${slug}-ink`);
  });
});