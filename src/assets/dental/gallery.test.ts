import { describe, expect, it } from 'vitest';
import gallery from './gallery.html?raw';
import { DENTAL_SILHOUETTES } from './index';

function documentOfGallery() {
  return new DOMParser().parseFromString(gallery, 'text/html');
}

describe('galería aislada UX-05L', () => {
  it('muestra las siete piezas nuevas ampliadas y a 44/32 px', () => {
    const doc = documentOfGallery();
    const enlarged = doc.querySelectorAll('[aria-labelledby="ampliadas"] img');
    expect(enlarged).toHaveLength(7);
    for (const { id } of DENTAL_SILHOUETTES) {
      expect(doc.querySelector(`[aria-labelledby="ampliadas"] img[src="./${id}.svg"][width="176"]`)).not.toBeNull();
      for (const size of [44, 32]) {
        expect(doc.querySelector(`[aria-labelledby="tamano-real"] img[src="./${id}.svg"][width="${size}"][height="${size}"]`)).not.toBeNull();
      }
    }
  });

  it('compara cada recurso con su original a 104/44/32 px', () => {
    const doc = documentOfGallery();
    const section = doc.querySelector('[aria-labelledby="antes-despues"]')!;
    expect(section.querySelectorAll('tbody tr')).toHaveLength(7);
    for (const { id } of DENTAL_SILHOUETTES) {
      for (const size of [104, 44, 32]) {
        for (const directory of ['./', './legacy/']) {
          expect(section.querySelector(`img[src="${directory}${id}.svg"][width="${size}"][height="${size}"]`)).not.toBeNull();
        }
      }
    }
  });

  it('conserva ambas denticiones y el orden FDI sin premolares temporales', () => {
    const doc = documentOfGallery();
    expect(doc.querySelectorAll('[aria-labelledby="familias"] img')).toHaveLength(7);
    const strips = doc.querySelectorAll('.strip');
    expect(Array.from(strips[0].querySelectorAll('.cell span'), (cell) => cell.textContent)).toEqual(
      ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'],
    );
    expect(Array.from(strips[1].querySelectorAll('.cell span'), (cell) => cell.textContent)).toEqual(
      ['55', '54', '53', '52', '51', '61', '62', '63', '64', '65'],
    );
    expect(gallery).not.toContain('temporary-premolar.svg');
  });

  it('carga únicamente los catorce SVG locales, sin scripts ni conexión a la aplicación', () => {
    const doc = documentOfGallery();
    const sources = new Set(Array.from(doc.images, (image) => image.getAttribute('src')));
    expect(sources).toEqual(new Set(DENTAL_SILHOUETTES.flatMap(({ id }) => [`./${id}.svg`, `./legacy/${id}.svg`])));
    expect(doc.querySelector('script, iframe, form')).toBeNull();
  });
});
