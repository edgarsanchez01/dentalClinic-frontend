import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const tokens = readFileSync('src/styles/tokens.css', 'utf8');

describe('tokens base del Design System v1.1', () => {
  it('declara el cuerpo de la app en 14px, no el de landing', () => {
    expect(tokens).toContain('--text-body-app: 0.875rem');
    expect(tokens).toContain('font-size: var(--text-body-app)');
  });

  it('declara el ancho maximo de 1280px de la app y el de landing preparado', () => {
    expect(tokens).toContain('--max-width-app: 1280px');
    expect(tokens).toContain('--max-width-landing: 1200px');
  });

  it('usa 18px de control y 24px de card en el contexto app', () => {
    expect(tokens).toContain('--radius-control: 18px');
    expect(tokens).toContain('--radius-card: 24px');
    expect(tokens).toContain('--radius-landing-control: 12px');
    expect(tokens).toContain('--radius-landing-card: 12px');
  });

  it('mantiene la marca configurable y no fija el color de la clinica', () => {
    // `--primary` resuelve desde `--primary-default`; nunca hay un hex de marca compilado.
    expect(tokens).toContain('--primary: var(--primary-default);');
    expect(tokens).toMatch(/--primary:\s*var\(--primary-default\)/);
    expect(tokens).not.toMatch(/--primary:\s*#[0-9a-f]{3,8}\s*;/i);
  });

  it('no adopta los colores de las referencias visuales como branding', () => {
    // El naranja de landing.md y el rojo de components.md no aparecen.
    expect(tokens.toLowerCase()).not.toContain('#ff5900');
    expect(tokens.toLowerCase()).not.toContain('#e7000b');
  });

  it('mantiene la tipografia IBM Plex sin CDN', () => {
    expect(tokens).toContain('IBM Plex Sans');
    expect(tokens).toContain('IBM Plex Mono');
    expect(tokens).toContain('@fontsource/ibm-plex-sans');
    expect(tokens).not.toMatch(/fonts\.googleapis|cdn\./);
  });

  it('expone el anillo de foco accesible', () => {
    expect(tokens).toContain('--focus-ring-width: 2px');
    expect(tokens).toContain('outline: var(--focus-ring-width) solid var(--ring)');
  });
});