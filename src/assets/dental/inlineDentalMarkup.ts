import type { DentalSilhouette } from './index';

/**
 * Only accepts the bundled SVG inventory, never API/user markup. Keep its geometry and
 * layers verbatim; remove the document wrapper and namespace every local reference for
 * repeated teeth and simultaneous current/historical charts. No DOM parser at render time.
 */
export function inlineDentalMarkup(resource: DentalSilhouette, instanceId: string): string {
  const prefix = `tooth-${instanceId.replace(/[^a-zA-Z0-9_-]/g, '_')}-`;
  return resource.markup
    .replace(/^<svg\b[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[^<]*<\/title>/, '')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/\bid="([^"]+)"/g, (_, id: string) => `id="${prefix}${id}"`)
    .replace(/\bhref="#([^"]+)"/g, (_, id: string) => `href="#${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${prefix}${id})`)
    .replace(/<use(?=[^>]*stroke="var\(--tooth-outline,)/,
      '<use class="dc-crown-outline" vector-effect="non-scaling-stroke"');
}
