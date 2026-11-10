import { describe, expect, it } from 'vitest';
import { DENTAL_SILHOUETTES } from './index';

/**
 * UX-05L: the seven resources share one contract. The crown outline lives in a single
 * `data-outline="crown"` path, while lighting and detail are separate `data-layer` groups so
 * clinical states can later hide or replace them without touching the geometry.
 */
const CROWN = /<path[^>]*\sdata-outline="crown"[^>]*\sd="(M[^"]+)"/;
const LAYERS = ['geometry', 'volume', 'detail'] as const;

function crownOf(markup: string): string | undefined {
  return CROWN.exec(markup)?.[1];
}

describe('siluetas dentales UX-05L', () => {
  it('expone cuatro permanentes y tres temporales, sin premolar temporal', () => {
    expect(DENTAL_SILHOUETTES.map(({ dentition, family }) => `${dentition}/${family}`)).toEqual([
      'PERMANENT/incisor',
      'PERMANENT/canine',
      'PERMANENT/premolar',
      'PERMANENT/molar',
      'TEMPORARY/incisor',
      'TEMPORARY/canine',
      'TEMPORARY/molar',
    ]);
  });

  it('usa siete trazados de corona distintos', () => {
    const outlines = DENTAL_SILHOUETTES.map(({ markup }) => crownOf(markup));
    expect(outlines.every(Boolean)).toBe(true);
    expect(new Set(outlines).size).toBe(7);
  });

  it('separa geometría, volumen y detalle, y declara gradientes y recorte', () => {
    for (const { markup } of DENTAL_SILHOUETTES) {
      for (const layer of LAYERS) expect(markup).toContain(`data-layer="${layer}"`);
      expect(markup).toContain('<linearGradient');
      expect(markup).toContain('<radialGradient');
      expect(markup).toContain('<clipPath');
      expect(markup).toContain('data-outline="crown"');
    }
  });

  it('no dibuja círculos, rectángulos ni contornos discontinuos', () => {
    for (const { markup } of DENTAL_SILHOUETTES) {
      expect(markup).not.toMatch(/<circle|<rect|<ellipse/);
      expect(markup).not.toContain('stroke-dasharray');
    }
  });

  it('mantiene el lienzo 44×44 y colorea por variables CSS, sin estados clínicos', () => {
    for (const { markup } of DENTAL_SILHOUETTES) {
      expect(markup).toContain('viewBox="0 0 44 44"');
      expect(markup).toContain('var(--tooth-fill');
      expect(markup).toContain('var(--tooth-outline');
      expect(markup).toContain('var(--tooth-groove');
      expect(markup).not.toMatch(/HEALTHY|CARIES|data-condition|condition-/);
    }
  });

  it('no usa negro ni trazos gruesos ajenos a la paleta marfil', () => {
    for (const { markup } of DENTAL_SILHOUETTES) {
      expect(markup).not.toMatch(/#000(?:000)?\b|black/i);
      expect(markup).toContain('stroke="var(--tooth-outline, #8a7f6e)"');
    }
  });

  it('no repite identificadores entre recursos para permitir la incrustación inline', () => {
    const ids = DENTAL_SILHOUETTES.flatMap(({ markup }) =>
      Array.from(markup.matchAll(/\sid="([^"]+)"/g), (match) => match[1]),
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
