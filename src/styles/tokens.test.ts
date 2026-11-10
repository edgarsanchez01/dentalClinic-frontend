import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const tokens = readFileSync('src/styles/tokens.css', 'utf8');

describe('tokens base del Design System v1.1', () => {
  it('post-F7 publica la misma paleta en ambos shells, no en islas de chrome OWNER', () => {
    const editorial = readFileSync('src/styles/clinical-editorial.css', 'utf8');
    for (const rule of editorial.split('}').filter(rule => rule.includes('--auth-petrol:') || rule.includes('--primary:') || rule.includes('--surface-paper:'))) {
      const selector = rule.split('{')[0];
      expect(selector).toContain('.owner-shell');
      expect(selector).toContain('.reception-shell');
      expect(selector).not.toContain('.owner-chrome');
      expect(selector).not.toContain(':root');
    }
    const chrome = readFileSync('src/components/layout/reception.css', 'utf8');
    expect(chrome).toContain(':is(.reception-shell, .owner-shell) :focus-visible');
    expect(readFileSync('src/components/owner/owner.css', 'utf8')).not.toContain('.owner-chrome :focus-visible');
  });
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

  it('declara la paleta de condiciones del odontograma (14.3) y su puente a Tailwind', () => {
    // Cada condicion tiene fondo (`-subtle`) y texto (`-ink`), nunca color solo.
    for (const name of ['healthy', 'caries', 'fractured', 'restored', 'root-canal', 'crown', 'implant', 'missing', 'extracted', 'sealed', 'other']) {
      expect(tokens).toContain(`--condition-${name}-subtle`);
      expect(tokens).toContain(`--color-condition-${name}: var(--condition-${name}-subtle)`);
      expect(tokens).toContain(`--color-condition-${name}-ink: var(--condition-${name}-ink)`);
    }
  });
});
